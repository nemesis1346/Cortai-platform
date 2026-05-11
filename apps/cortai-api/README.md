# COrtai API

FastAPI modular monolith for the V1 pilot.

## Setup

```bash
docker compose up -d postgres redis
cd apps/cortai-api
cp .env.example .env
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

Generate RS256 keys for local auth and paste them into `.env`:

```bash
openssl genrsa -out jwt-private.pem 2048
openssl rsa -in jwt-private.pem -pubout -out jwt-public.pem
```

## Structure

- `app/main.py` registers middleware and routers.
- `app/db.py` owns the async SQLAlchemy engine and request session dependency.
- `app/auth/` contains JWT login, refresh, dependencies, and password hashing.
- `app/middleware/tenant.py` decodes JWTs and makes the principal available per request.
- `app/modules/admin/users/` implements the week-one admin/users vertical slice.
- `alembic/versions/20260510_0001_initial.py` creates organizations, users, and users RLS.

## Commands

```bash
uv run ruff check .
uv run mypy .
uv run pytest
uv run alembic revision --autogenerate -m "message"
```

RLS is enforced with `app.current_org_id`; authenticated requests set it through
`select set_config('app.current_org_id', :org_id, true)`.

## Logging

The API emits structured JSON logs to stdout through `structlog`. The systemd
unit sends stdout/stderr to journald, so retention and rotation are managed by
the host journald policy.
