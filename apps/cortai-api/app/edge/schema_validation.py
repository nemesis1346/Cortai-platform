from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import structlog
from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError
from jsonschema.validators import validator_for

logger = structlog.get_logger(__name__)


class EdgeEnvelopeValidationError(Exception):
    def __init__(self, errors: list[dict[str, Any]]):
        super().__init__("Invalid edge message envelope")
        self.errors = errors


def _schemas_dir() -> Path:
    # apps/cortai-api/app/edge/schema_validation.py -> apps/cortai-api/schemas
    return Path(__file__).resolve().parents[2] / "schemas"


@lru_cache(maxsize=1)
def _envelope_validator() -> Draft202012Validator:
    schema_path = _schemas_dir() / "edge_message_envelope.schema.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))

    # Ensure we compile using the correct draft (and that "$schema" is respected).
    cls = validator_for(schema)
    cls.check_schema(schema)
    return Draft202012Validator(schema)


def validate_edge_envelope(message: Any) -> None:
    """
    Validate the DE-02 envelope. Raises EdgeEnvelopeValidationError on failure.

    `message` should be a decoded JSON object (typically `dict`).
    """
    v = _envelope_validator()
    errors: list[dict[str, Any]] = []

    for err in sorted(v.iter_errors(message), key=str):
        errors.append(
            {
                "path": "/".join(str(p) for p in err.absolute_path),
                "schema_path": "/".join(str(p) for p in err.absolute_schema_path),
                "message": err.message,
                "validator": err.validator,
            }
        )

    if errors:
        # Structured log entry for ingest worker to emit.
        logger.warning(
            "edge.envelope.invalid",
            error_count=len(errors),
            errors=errors,
        )
        raise EdgeEnvelopeValidationError(errors)

