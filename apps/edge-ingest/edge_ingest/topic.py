from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class EdgeTopic:
    org: str
    property: str
    device_id: str
    msg_type: str


def parse_edge_topic(topic: str) -> EdgeTopic:
    """
    Parse `cortai/{org}/{property}/edge/{device_id}/{type}`.
    """
    parts = topic.split("/")
    if len(parts) != 6:
        raise ValueError("Invalid topic format")
    if parts[0] != "cortai" or parts[3] != "edge":
        raise ValueError("Invalid topic prefix")
    org, prop, device_id, msg_type = parts[1], parts[2], parts[4], parts[5]
    if not org or not prop or not device_id or not msg_type:
        raise ValueError("Topic contains empty segment")
    return EdgeTopic(org=org, property=prop, device_id=device_id, msg_type=msg_type)

