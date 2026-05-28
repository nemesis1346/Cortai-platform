# Mosquitto (DE-01) — MQTT broker with mTLS

This folder contains the Mosquitto broker configuration used for **DE-01**:

- Broker runs on the EC2 **via Docker** and is managed by `systemd` (`cortai-mqtt.service`).
- Client connections require **mTLS** on port `8883`.
- Clients may publish/subscribe only to:
  - `cortai/{org}/{property}/edge/{device_id}/{type}`
  - Where `device_id` must match the client-certificate identity (CN/SAN).

## Required files on the server (not committed)

Create these on the EC2 at:

`/etc/cortai/mosquitto/certs/`

- `ca.crt` — CA certificate that signs **edge device client certs**
- `server.crt` — broker server certificate (can be signed by the same CA)
- `server.key` — broker server private key

Recommended permissions:

- `server.key`: `chmod 600`, owned by `root:root`
- directory: `chmod 700`

## How ACLs work

We set `use_identity_as_username true`. With mTLS enabled, Mosquitto maps the client cert identity to `username`.

ACLs use the device registry to restrict topics.

### Why we *don’t* use wildcards for tenant isolation

The old rule:

- `pattern readwrite cortai/+/+/edge/%u/+`

…only pinned the `{device_id}` segment. `{org}` and `{property}` were wildcards, so any device that could
authenticate as `edge-0007` could publish into *any* org’s namespace:

- `cortai/*/*/edge/edge-0007/*`

That breaks multi-tenant isolation at the broker.

### Current approach (generated per-device ACL)

During deploy we generate `deploy/mosquitto/aclfile` from `platform.devices`:

- Devices are pinned to their **org slug** in the topic.
- If a device is bound to a `property_id`, it is also pinned to that **property slug**.

Generation command:

```bash
cd apps/cortai-api
uv run python -m app.scripts.generate_mosquitto_acl --out deploy/mosquitto/aclfile
```

The deploy script runs this automatically before restarting `cortai-mqtt`.

## Local test (from a machine with mosquitto-clients)

Publish:

```bash
mosquitto_pub -h <broker-host> -p 8883 --cafile ca.crt \
  --cert edge-0007.crt --key edge-0007.key \
  -t cortai/lionston/tpsv/edge/edge-0007/health \
  -m '{"device_id":"edge-0007","ts":"2026-05-19T12:00:00Z","type":"health","schema_version":"1.0","payload":{"status":"ok"}}'
```

Try publishing as `edge-0007` to `.../edge/edge-9999/...` and it should be denied.

