from __future__ import annotations

import pytest


def _apply_check(
    *,
    registered_org_id: str,
    registered_property_id: str | None,
    resolved_topic_org_id: str,
    resolved_topic_property_id: str,
) -> None:
    # Mirrors the enforcement logic in edge_ingest.main
    if registered_org_id != resolved_topic_org_id:
        raise ValueError("topic org mismatch")
    if registered_property_id is not None and registered_property_id != resolved_topic_property_id:
        raise ValueError("topic property mismatch")


def test_rejects_topic_org_mismatch() -> None:
    with pytest.raises(ValueError, match="org mismatch"):
        _apply_check(
            registered_org_id="orgA",
            registered_property_id=None,
            resolved_topic_org_id="orgB",
            resolved_topic_property_id="prop1",
        )


def test_rejects_topic_property_mismatch_when_device_bound_to_property() -> None:
    with pytest.raises(ValueError, match="property mismatch"):
        _apply_check(
            registered_org_id="orgA",
            registered_property_id="prop1",
            resolved_topic_org_id="orgA",
            resolved_topic_property_id="prop2",
        )


def test_allows_any_property_when_device_not_bound_to_property() -> None:
    _apply_check(
        registered_org_id="orgA",
        registered_property_id=None,
        resolved_topic_org_id="orgA",
        resolved_topic_property_id="prop2",
    )

