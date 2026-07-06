# Cortai Platform — Bridge Contracts

Bridges are thin adapter modules in `apps/cortai-api/app/bridges/` that abstract
external services behind a `mock | real` switch. The API never calls an external
system directly — it always goes through a bridge function.

**Why bridges?** Local dev and CI have no external infrastructure. Setting the
relevant env var to `mock` makes every bridge return deterministic fixture data,
enabling fast local iteration and reliable test suites without network access.

---

## Bridge pattern

Every bridge function:

1. Reads the relevant `*_mode` setting from `app/config.py`.
2. In `mock` mode — returns a fixture (IoT/AI) or writes to a sink file (email).
3. In `real` mode — validates required env vars are set, then calls the external
   service. Raises HTTP 500 with a clear message if config is missing.
4. **Never raises** for reasons outside its control (network, downstream 5xx) without
   propagating a meaningful HTTP status to the caller.

---

## IoT Bridge

**File:** `app/bridges/iot_client.py`  
**Mode env var:** `BRIDGES_MODE=mock|real` (default: `mock`)  
**Real endpoint env var:** `IOT_BRIDGE_BASE_URL=https://iot.internal`

Fixtures live in `app/bridges/_fixtures/iot_*.json`.

### Endpoints consumed

| Bridge function | HTTP call | Fixture file |
|---|---|---|
| `get_elevators(request)` | `GET /api/iot/v1/elevators` | `iot_elevators.json` |
| `get_sensors(request)` | `GET /api/iot/v1/sensors` | `iot_sensors.json` |
| `get_device_readings(request, device_id, params_override)` | `GET /api/iot/v1/devices/{device_id}/readings` | `iot_device_readings.json` |
| `get_room_iot(request, room_id)` | `GET /api/operations/rooms/{room_id}/iot` | `iot_room_iot.json` |
| `get_hvac_rooms(request)` | `GET /api/iot/v1/hvac/rooms` | `iot_hvac_rooms.json` |
| `post_hvac_room_control(request, room_id, payload)` | `POST /api/iot/v1/hvac/rooms/{room_id}/control` | `iot_hvac_room_control.json` |
| `get_hvac_command_ack(request, room_id, command_id)` | `GET /api/iot/v1/hvac/rooms/{room_id}/commands/{command_id}` | `iot_hvac_command_ack.json` |
| `get_edge_events(request, params_override)` | `GET /api/iot/v1/edge-events` | `iot_edge_events_hvac_fault.json` (type=hvac_fault), `[]` otherwise |
| `get_fb_breakfast_status(request)` | `GET /api/iot/v1/fb/breakfast/status` | `iot_fb_breakfast_status.json` |
| `get_fb_restaurant_tables(request)` | `GET /api/iot/v1/fb/restaurant/tables` | `iot_fb_restaurant_tables.json` |
| `get_pool_capacity(request)` | `GET /api/iot/v1/pool/capacity` | `iot_pool_capacity.json` |
| `get_pool_spa_status(request)` | `GET /api/iot/v1/pool/spa/status` | `iot_pool_spa_status.json` |
| `get_fitness_capacity(request)` | `GET /api/iot/v1/fitness/capacity` | `iot_fitness_capacity.json` |
| `get_fitness_equipment(request)` | `GET /api/iot/v1/fitness/equipment` | `iot_fitness_equipment.json` |
| `get_meeting_booking_attendance(request, booking_id)` | `GET /api/iot/v1/meetings/bookings/{booking_id}/attendance` | `iot_meetings_booking_attendance.json` |

### Auth forwarding

The bridge forwards the caller's session cookie (`Cookie` header) to the IoT
service. The IoT service is expected to validate it independently.

### Timeouts

All IoT calls use `httpx.Timeout(connect=5s, read=10s)`. Adjust per-call if a
specific endpoint is known to be slow (e.g. HVAC commands can take up to 30 s
for a full round-trip acknowledgement).

---

## AI Bridge

**File:** `app/bridges/ai_client.py`  
**Mode env var:** `BRIDGES_MODE=mock|real` (shared with IoT, default: `mock`)  
**Real endpoint env var:** `AI_BRIDGE_BASE_URL=https://ai.internal`

Fixtures live in `app/bridges/_fixtures/ai_*.{en,fr}.json` (locale-aware).

### Endpoints consumed

| Bridge function | HTTP call | Fixture files |
|---|---|---|
| `get_operations_insights(request)` | `GET /api/ai/v1/operations/insights` | `ai_operations_insights.{en\|fr}.json` |
| `post_incident_triage(request, incident)` | `POST /api/ai/v1/incidents/{id}/triage` | `ai_incident_triage.{en\|fr}.json` |

### Locale selection

The locale is read from `?locale=` query param. Requests without a locale default
to `en`. The mock returns the matching `.{locale}.json` fixture; the real bridge
passes the locale param through to the upstream service unchanged.

### Timeouts

- Operations insights: `httpx.Timeout(connect=5s, read=10s)`
- Incident triage: `httpx.Timeout(connect=5s, read=15s)` (LLM inference is slower)

---

## Email Bridge

**File:** `app/bridges/email_client.py`  
**Mode env var:** `EMAIL_BRIDGE_MODE=mock|real` (default: `mock`)

This bridge is **separate** from the legacy `app/notify/email.py` escalation
sender. New code should use `email_client.py`. The legacy sender will be
migrated in a future task.

### Public API

```python
await send_email(
    to="user@example.com",
    template_name="incident_assigned",   # see Templates below
    locale="en",                         # "en" or "fr"; falls back to "en"
    context={...},                       # see per-template context below
)
```

### Mock mode

Records are appended as JSON lines to `EMAIL_SINK_PATH`
(default: `/tmp/cortai_email_sink.jsonl`). Each record:

```json
{
  "ts": "2026-07-06T14:00:00+00:00",
  "to": "user@example.com",
  "template": "incident_assigned",
  "locale": "en",
  "subject": "You have been assigned to an incident",
  "context": { ... }
}
```

Test helpers:

```python
from app.bridges.email_client import read_sink, clear_sink

records = read_sink()   # list[dict] — assert on template/subject/context
clear_sink()            # truncate before each test
```

### Real mode

Required env vars:

| Var | Description |
|---|---|
| `EMAIL_FROM` | Verified SES sender address |
| `EMAIL_SES_REGION` | AWS region, e.g. `ca-central-1` |

AWS credentials are sourced from the standard boto3 credential chain
(`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, instance profile, etc.).

### Templates

Templates live in `app/templates/email/{en,fr}/{template_name}.html`.
If a locale-specific template is missing, the bridge falls back to `en`.

#### `incident_assigned`

Sent when a user is assigned to an incident.

| Context variable | Type | Required | Description |
|---|---|---|---|
| `assigned_to_name` | str | Yes | Recipient's display name |
| `property_name` | str | Yes | Property where the incident occurred |
| `incident_title` | str | Yes | Short incident description |
| `incident_id` | str | Yes | Incident UUID or short ID |
| `priority` | str | No | e.g. `High`, `Medium` |
| `assigned_by` | str | No | Name of the assigning user |
| `url` | str \| None | No | Deep link to the incident in the dashboard |

#### `password_changed`

Sent to a user when their password is changed (by themselves or an admin).

| Context variable | Type | Required | Description |
|---|---|---|---|
| `user_name` | str | Yes | Recipient's display name |
| `user_email` | str | Yes | The account email address |
| `changed_at` | str | Yes | Human-readable timestamp, e.g. `2026-07-06 14:00 UTC` |
| `changed_by` | str | No | Name of the user who made the change, if different from recipient |

#### `shift_handover_summary`

Sent to the incoming shift worker at handover.

| Context variable | Type | Required | Description |
|---|---|---|---|
| `from_name` | str | Yes | Outgoing shift worker's name |
| `to_name` | str | Yes | Incoming shift worker's name (recipient) |
| `property_name` | str | Yes | Property name |
| `shift_start` | str | Yes | Start of the outgoing shift, formatted string |
| `shift_end` | str | Yes | End of the outgoing shift, formatted string |
| `open_incidents` | list[dict] | No | Each item: `{id, title, priority?}` |
| `notes` | str | No | Free-text handover notes |

---

## Adding a new bridge

1. Add a function to the appropriate `app/bridges/*.py` (or create a new file).
2. Add a fixture in `app/bridges/_fixtures/` for mock mode.
3. Add any new env vars to `app/config.py` with safe defaults.
4. Document the new endpoint in this file under the relevant bridge section.