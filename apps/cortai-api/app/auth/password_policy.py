"""SEC-02 — password complexity policy.

Policy version 1:
  - Minimum 12 characters
  - At least one uppercase letter
  - At least one lowercase letter
  - At least one digit
  - At least one symbol (non-alphanumeric)

Bumping CURRENT_POLICY_VERSION triggers forced re-enrolment for users whose
password_policy_version < CURRENT_POLICY_VERSION.
"""

from __future__ import annotations

import re

from fastapi import HTTPException, status

CURRENT_POLICY_VERSION = 1

_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r".{12,}"), "at least 12 characters"),
    (re.compile(r"[A-Z]"), "at least one uppercase letter"),
    (re.compile(r"[a-z]"), "at least one lowercase letter"),
    (re.compile(r"\d"), "at least one digit"),
    (re.compile(r"[^A-Za-z0-9]"), "at least one symbol"),
]


def validate_password(password: str) -> None:
    """Raise HTTP 422 if password does not meet the current policy."""
    failures = [msg for pattern, msg in _RULES if not pattern.search(password)]
    if failures:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Password must contain: {', '.join(failures)}.",
        )