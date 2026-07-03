# Cortai Platform — Compliance Reference

## Audit Logging

### What is logged

Every mutating API call (`POST`, `PATCH`, `DELETE`) on `/api/admin/*` and
`/api/operations/*` is captured in `audit.change_log` by
`AuditLogMiddleware`. Each row records:

| Column | Description |
|---|---|
| `id` | UUID of the log entry |
| `org_id` | Tenant the action belongs to |
| `user_id` | User who performed the action (nullable — set to NULL if user later deleted) |
| `action` | HTTP method lowercased (`post`, `patch`, `delete`) |
| `entity_type` | Logical entity name (e.g. `admin_property`, `auth_login`) |
| `entity_id` | UUID of the affected entity |
| `before_json` | Full entity snapshot before the mutation |
| `after_json` | Full entity snapshot after the mutation (or login event detail) |
| `ts` | Timestamp with time zone |
| `ip` | Client IP (X-Forwarded-For preferred) |
| `user_agent` | Browser / client UA string |

### Authentication events

Login successes and failures are also recorded with
`entity_type = 'auth_login'`. Failures where the organisation slug does
not exist are not recorded (no `org_id` to attribute them to).
`after_json` shape: `{"result": "success" | "failure", "email": "..."}`.

### Immutability

`audit.change_log` has a database-level trigger
(`trg_audit_change_log_immutable`) that raises an exception on any
`UPDATE` or `DELETE` statement. Rows are write-once.

### Row-level security

RLS is enabled and forced on `audit.change_log`. Every query is
automatically scoped to the current tenant's `org_id` via the
`app.current_org_id` session variable set by `TenantContextMiddleware`.

---

## Retention Policy (PHIPA / PIPEDA)

Alembic migration `20260703_0029` configures TimescaleDB on
`audit.change_log`:

| Setting | Value | Rationale |
|---|---|---|
| Hypertable chunk interval | 1 month | Balances chunk count vs. compression ratio |
| Compression threshold | 7 days | Safe because the table is immutable; reduces storage by ~90 % |
| Compression segments | `org_id, entity_type` | Aligns with most audit queries |
| Compression order | `ts DESC` | Optimises recent-first scans |
| Retention | **7 years** | Meets PHIPA minimum (Ontario) and PIPEDA guidance |

Chunks older than 7 years are dropped automatically by TimescaleDB's
background retention job. No manual purge is required.

### Verifying the policy on a running instance

```sql
-- Show attached policies
SELECT * FROM timescaledb_information.jobs
WHERE hypertable_name = 'change_log';

-- Show current chunks and their compression status
SELECT chunk_name, range_start, range_end, is_compressed
FROM timescaledb_information.chunks
WHERE hypertable_name = 'change_log'
ORDER BY range_start DESC;
```

---

## Audit Export (PHIPA / PIPEDA access requests)

`GET /api/admin/audit/export` (IT_ADMIN role only) streams the full
`audit.change_log` for a requested date range.

| Parameter | Required | Description |
|---|---|---|
| `from` | Yes | ISO-8601 start datetime (inclusive) |
| `to` | Yes | ISO-8601 end datetime (exclusive) |
| `format` | No | `jsonl` (default), `json`, or `csv` |

Maximum range: 366 days per request. For multi-year exports, issue
multiple requests in yearly bands.

Example:
```
GET /api/admin/audit/export?from=2026-01-01T00:00:00Z&to=2027-01-01T00:00:00Z&format=csv
```

The response streams as an attachment (`Content-Disposition: attachment`)
to avoid buffering large datasets in the browser or server memory.