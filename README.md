# COrtai Platform

Week-one deployable shell for the COrtai V1 pilot:

- `apps/cortai-api` - FastAPI, async SQLAlchemy, Alembic, JWT auth, RLS, admin/users API.
- `apps/cortai-frontend` - Next.js 14, strict TypeScript, Tailwind tokens, next-intl, login/dashboard/admin users UI.
- `deploy` - Caddy, systemd, and rsync deployment templates for the single-EC2 V1 architecture.

Local services run through Docker only:

```bash
docker compose up -d postgres redis
```