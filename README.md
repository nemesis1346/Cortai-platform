# COrtai Platform

Week-one deployable shell for the COrtai V1 pilot:

- `apps/cortai-api` - FastAPI, async SQLAlchemy, Alembic, JWT auth, RLS, admin/users API.
- `apps/cortai-frontend` - Next.js 14, strict TypeScript, Tailwind tokens, next-intl, login/dashboard/admin users UI.
- `deploy` - Caddy, systemd, and rsync deployment templates for the single-EC2 V1 architecture.

## Staging DNS + HTTPS (required for Caddy / Let’s Encrypt)

Caddy can only provision HTTPS if the domain names resolve publicly. If the records are missing you’ll see `NXDOMAIN` and ACME will fail.

### Create these DNS records

In the DNS zone for `lionston.com`, create:

- **A** `api.cortai-staging.lionston.com` → **EC2 public IPv4** (currently `3.96.21.119`)
- **A** `app.cortai-staging.lionston.com` → **EC2 public IPv4** (currently `3.96.21.119`)

If you want these DNS records to stay valid across instance stop/start, assign an **AWS Elastic IP** to the instance and point the A records to that Elastic IP.

Recommended:

- **TTL**: 60–300 seconds while iterating (raise later if desired)
- **Proxy**: keep **DNS-only** (don’t proxy) until HTTPS is working end-to-end

### Verify DNS is live (must not be NXDOMAIN)

Run from your laptop (or any machine with public DNS):

```bash
dig +short api.cortai-staging.lionston.com A
dig +short app.cortai-staging.lionston.com A
```

Expected output is EC2 public IPv4 (for example `3.96.21.119`) for both.

### Verify ports are open

Let’s Encrypt needs to reach your server on:

- **TCP 80** (HTTP-01 challenge)
- **TCP 443** (HTTPS)

On AWS, ensure the EC2 Security Group allows inbound 80/443 from the internet.

### Provision HTTPS (after DNS resolves)

Once DNS resolves, redeploy so `deploy/Caddyfile` is installed and Caddy reloads:

```bash
./deploy/deploy.sh
```

Then confirm Caddy has issued certs:

```bash
curl -I https://api.cortai-staging.lionston.com/docs
curl -I https://app.cortai-staging.lionston.com
```

If issuance fails, check logs:

```bash
ssh ubuntu@ec2-3-96-21-119.ca-central-1.compute.amazonaws.com 'sudo journalctl -u caddy -n 200 --no-pager'
```

Local services run through Docker only:

```bash
docker compose up -d postgres redis
```