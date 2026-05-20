import pytest

from edge_ingest.topic import parse_edge_topic


def test_parse_edge_topic_ok() -> None:
    t = parse_edge_topic("cortai/orgA/propB/edge/edge-0007/health")
    assert t.org == "orgA"
    assert t.property == "propB"
    assert t.device_id == "edge-0007"
    assert t.msg_type == "health"


@pytest.mark.parametrize(
    "topic",
    [
        "",
        "cortai/a/b",
        "wrong/a/b/edge/x/health",
        "cortai/a/b/notedge/x/health",
        "cortai/a/b/edge//health",
    ],
)
def test_parse_edge_topic_invalid(topic: str) -> None:
    with pytest.raises(ValueError):
        parse_edge_topic(topic)

