from __future__ import annotations

import pytest

from app.edge.schema_validation import EdgeEnvelopeValidationError, validate_edge_envelope


def test_validate_edge_envelope_accepts_valid_message() -> None:
    validate_edge_envelope(
        {
            "device_id": "edge-0007",
            "ts": "2026-05-19T18:19:00Z",
            "type": "health",
            "schema_version": "1.0",
            "payload": {"ok": True},
        }
    )


def test_validate_edge_envelope_rejects_invalid_message() -> None:
    with pytest.raises(EdgeEnvelopeValidationError) as exc:
        validate_edge_envelope(
            {
                "device_id": "",
                "ts": "not-a-date",
                "type": "nope",
                "schema_version": "v1",
                "payload": "not-an-object",
                "extra": 1,
            }
        )

    # High-signal checks: we got multiple errors and a stable shape.
    assert len(exc.value.errors) >= 3
    assert all("message" in e for e in exc.value.errors)

