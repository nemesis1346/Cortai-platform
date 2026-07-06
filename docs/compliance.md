# Cortai Platform — Compliance & Security Reference

This document is the authoritative record of security controls, audit guarantees,
and data-retention policies in the Cortai V1 API. Update it when controls change.

---

## 1. Audit Logging

### What is captured

`AuditLogMiddleware` intercepts every mutating request (`POST`, `PATCH`, `DELETE`)
on `/api/admin/*` and `/api/operations/*` and writes one row to `audit.change_log`.

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Unique log entry identifier |
| `org_id` | UUID | Tenant the action belongs to (NOT NULL) |
| `user_id` | UUID | User who acted (nullable — NULL if user later deleted) |
| `action` | text | HTTP method lowercased: `post`, `patch`, `delete` |
| `entity_type` | text | Logical entity name, e.g. `admin_property`, `auth_login` |
| `entity_id` | UUID | Affected entity UUID |
| `before_json` | jsonb | Full entity snapshot before mutation |
| `after_json` | jsonb | Full entity snapshot after mutation (or event detail) |
| `ts` | timestamptz | Event timestamp |
| `ip` | text | Client IP (X-Forwarded-For preferred) |
| `user_agent` | text | Browser / client UA string |

### Authentication events

Login successes and failures are recorded separately (not by the audit middleware)
with `entity_type = 'auth_login'`. `after_json` shape:
```json
{ "result": "success" | "failure", "email": "user@example.com" }
```

Failures where the organisation slug does not exist are not recorded — there is
no `org_id` to attribute them to.

### Immutability guarantee

`audit.change_log` has a database-level trigger (`trg_audit_change_log_immutable`)
that raises an exception on any `UPDATE` or `DELETE`. Rows are write-once. No
application code, admin user, or API endpoint can overwrite or remove a log entry.

### Row-level security

RLS is enabled and **forced** on `audit.change_log`. Every query is automatically
scoped to the current tenant via the `app.current_org_id` session variable set by
`TenantContextMiddleware`. A user cannot read another tenant's audit rows even with
a raw SQL connection using the application role.

---

## 2. Data Retention (PHIPA / PIPEDA)

Migration `20260703_0029` converts `audit.change_log` to a TimescaleDB hypertable
with a 7-year retention policy.

| Setting | Value | Rationale |
|---|---|---|
| Hypertable chunk interval | 1 month | Balances chunk count vs. query performance |
| Compression | **Disabled** | TimescaleDB columnstore compression is incompatible with PostgreSQL RLS; security takes precedence |
| Retention | **7 years** | Meets PHIPA minimum (Ontario) and PIPEDA guidance |

Chunks older than 7 years are dropped automatically by TimescaleDB's background
retention job. No manual purge is required.

### Verifying the policy on a running instance

```sql
-- Confirm the hypertable exists
SELECT * FROM timescaledb_information.hypertables
WHERE hypertable_name = 'change_log';

-- Show attached policies (retention job should appear)
SELECT * FROM timescaledb_information.jobs
WHERE hypertable_name = 'change_log';

-- Show current chunks
SELECT chunk_name, range_start, range_end
FROM timescaledb_information.chunks
WHERE hypertable_name = 'change_log'
ORDER BY range_start DESC;
```

---

## 3. Audit Export

`GET /api/admin/audit/export` (role: **IT_ADMIN** only) streams `audit.change_log`
for a requested date range without buffering the full dataset in memory.

| Parameter | Required | Description |
|---|---|---|
| `from` | Yes | ISO-8601 start datetime (inclusive) |
| `to` | Yes | ISO-8601 end datetime (exclusive) |
| `format` | No | `jsonl` (default), `json`, `csv` |

Maximum range: **366 days** per request. For multi-year exports issue multiple
requests in yearly bands.

Example:
```
GET /api/admin/audit/export?from=2026-01-01T00:00:00Z&to=2027-01-01T00:00:00Z&format=csv
```

The response streams as a `Content-Disposition: attachment` to avoid buffering
large datasets in the browser.

---

## 4. Password Policy (SEC-02)

All passwords must satisfy **policy version 1**:

| Rule | Requirement |
|---|---|
| Minimum length | 12 characters |
| Uppercase | At least 1 |
| Lowercase | At least 1 |
| Digit | At least 1 |
| Symbol | At least 1 non-alphanumeric character |

Enforcement is applied in `app/auth/password_policy.py:validate_password()` and
called from the admin users router on every create and password-update operation.
Violations return **HTTP 422** with a human-readable detail listing every failing
rule simultaneously.

### Policy versioning

The `users` table has a `password_policy_version` (SMALLINT, default 1) column.
When the policy is strengthened, increment `CURRENT_POLICY_VERSION` in
`password_policy.py` and bump the default — users whose stored version is below
the current value can be identified and forced to re-enroll without code changes.

### IT_ADMIN rotation

IT_ADMIN passwords expire after **180 days**. `GET /api/auth/me` returns
`"password_rotation_due": true` when `now() - password_changed_at > 180 days`
for an IT_ADMIN account. The dashboard surfaces an amber banner with a link to
the user management page. There is no hard lock-out — the check is advisory.

---

## 5. Brute-Force Protection (SEC-01)

A **Redis sliding-window rate limiter** is applied to `/api/auth/login` and
`/api/auth/refresh` as a FastAPI dependency.

| Parameter | Value |
|---|---|
| Window | 5 minutes |
| Limit | 10 requests per IP per window |
| Algorithm | Lua-atomic ZSET (millisecond timestamps as score+member) |
| Response on block | HTTP 429 with `Retry-After: N` header |
| Fail behaviour | **Fail-open** — if Redis is unavailable all requests are allowed |

The **first lockout per IP per window** is written to `audit.change_log` with
`entity_type = 'auth.brute_force_lockout'`. Subsequent 429s in the same window
are not re-logged to avoid flooding the audit table.

---

## 6. Session Invalidation (SEC-03)

Every JWT contains a `jti` (UUID4) claim and the standard `iat` (issued-at)
timestamp.

When a user's password is changed via `PATCH /api/admin/users/{id}`, the API
writes `revoke_before:{user_id} = now()` to Redis with TTL = `jwt_ttl_seconds`
(default 12 hours). On every subsequent authenticated request,
`TenantContextMiddleware` checks whether `token.iat < revoke_before[user_id]`
and returns **HTTP 401 "Session invalidated. Please log in again."** if true.

This immediately invalidates all sessions across all devices without requiring
a server-side session store. The Redis key self-cleans once all pre-change tokens
have naturally expired, leaving no orphaned state.

**Fail-open**: if Redis is unavailable the check is skipped and the request is
allowed through (same as the rate limiter).

---

## 7. JWT Configuration

| Setting | Env var | Default |
|---|---|---|
| Algorithm | — | RS256 |
| TTL | `JWT_TTL_SECONDS` | 43200 (12 h) |
| Delivery | — | httpOnly cookie `cortai_access_token` |
| Issuer | `JWT_ISSUER` | `cortai-api` |
| Audience | `JWT_AUDIENCE` | `cortai-platform` |

Tokens are delivered exclusively as httpOnly cookies to prevent JavaScript
access. The `Secure` flag is set in all environments except `local`.