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

ACLs use `%u` (username) to restrict topics:

- `topic readwrite cortai/+/+/edge/%u/+`

So a device with cert identity `edge-0007` can only use:

- `cortai/*/*/edge/edge-0007/*`

## Local test (from a machine with mosquitto-clients)

Publish:

```bash
mosquitto_pub -h <broker-host> -p 8883 --cafile ca.crt \
  --cert edge-0007.crt --key edge-0007.key \
  -t cortai/lionston/tpsv/edge/edge-0007/health \
  -m '{"device_id":"edge-0007","ts":"2026-05-19T12:00:00Z","type":"health","schema_version":"1.0","payload":{"status":"ok"}}'
```

Try publishing as `edge-0007` to `.../edge/edge-9999/...` and it should be denied.

