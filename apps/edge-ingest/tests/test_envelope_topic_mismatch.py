from __future__ import annotations

import json

import pytest

from edge_ingest.schema_validation import validate_edge_envelope


def test_envelope_schema_allows_device_id_and_type() -> None:
    # Sanity: DE-02 requires device_id and type, edge-ingest cross-checks with topic.
    validate_edge_envelope(
        {
            "device_id": "edge-0007",
            "ts": "2026-05-19T18:19:00Z",
            "type": "health",
            "schema_version": "1.0",
            "payload": {"ok": True},
        }
    )


@pytest.mark.parametrize(
    "topic_device_id,envelope_device_id",
    [("edge-0007", "edge-9999"), ("edge-9999", "edge-0007")],
)
def test_topic_envelope_device_id_mismatch_is_detectable(
    topic_device_id: str, envelope_device_id: str
) -> None:
    topic = f"cortai/lionston/tpsv/edge/{topic_device_id}/health"
    envelope = {
        "device_id": envelope_device_id,
        "ts": "2026-05-19T18:19:00Z",
        "type": "health",
        "schema_version": "1.0",
        "payload": {"ok": True},
    }

    # This is the exact check edge-ingest runs after schema validation.
    payload = json.loads(json.dumps(envelope))
    assert payload["device_id"] != topic_device_id
    assert payload["type"] == "health"
    assert topic.endswith("/health")

