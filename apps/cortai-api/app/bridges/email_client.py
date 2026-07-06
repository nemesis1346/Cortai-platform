"""NOTIF-02 — templated email bridge.

EMAIL_BRIDGE_MODE=mock  → append JSON record to EMAIL_SINK_PATH (default /tmp/cortai_email_sink.jsonl)
EMAIL_BRIDGE_MODE=real  → render Jinja2 template and send via AWS SES

Public API
----------
  await send_email(to="...", template_name="incident_assigned", locale="en", context={...})

  read_sink()   → list[dict]  (mock mode — for test assertions)
  clear_sink()               (mock mode — reset between tests)

Templates live at:  app/templates/email/{locale}/{template_name}.html
If a locale template is missing, falls back to "en".
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.config import get_settings

log = logging.getLogger(__name__)

_TEMPLATES_ROOT = Path(__file__).parent.parent / "templates" / "email"

_SUBJECTS: dict[str, dict[str, str]] = {
    "en": {
        "incident_assigned": "You have been assigned to an incident",
        "password_changed": "Your Cortai password has been changed",
        "shift_handover_summary": "Shift handover summary",
    },
    "fr": {
        "incident_assigned": "Un incident vous a été assigné",
        "password_changed": "Votre mot de passe Cortai a été modifié",
        "shift_handover_summary": "Résumé de passation de quart",
    },
}


def _subject(template_name: str, locale: str) -> str:
    lang = "fr" if locale.startswith("fr") else "en"
    return _SUBJECTS.get(lang, _SUBJECTS["en"]).get(
        template_name, template_name.replace("_", " ").title()
    )


def _render_template(template_name: str, locale: str, context: dict[str, Any]) -> str:
    try:
        from jinja2 import Environment, FileSystemLoader, select_autoescape
    except ImportError as exc:
        raise RuntimeError("jinja2 is required for email rendering — add it to dependencies") from exc

    env = Environment(
        loader=FileSystemLoader(str(_TEMPLATES_ROOT)),
        autoescape=select_autoescape(["html"]),
    )
    lang = "fr" if locale.startswith("fr") else "en"
    try:
        template = env.get_template(f"{lang}/{template_name}.html")
    except Exception:
        template = env.get_template(f"en/{template_name}.html")
    return template.render(**context)


async def send_email(
    *,
    to: str,
    template_name: str,
    locale: str,
    context: dict[str, Any],
) -> None:
    """Send a templated email. Raises on real-mode misconfiguration; logs on mock."""
    settings = get_settings()
    mode = settings.email_bridge_mode.lower().strip()
    subject = _subject(template_name, locale)

    if mode == "mock":
        record = {
            "ts": datetime.now(UTC).isoformat(),
            "to": to,
            "template": template_name,
            "locale": locale,
            "subject": subject,
            "context": context,
        }
        try:
            with open(settings.email_sink_path, "a") as f:
                f.write(json.dumps(record) + "\n")
        except OSError:
            log.exception("email_client.mock: failed to write to sink %s", settings.email_sink_path)
        log.info("email_client.mock to=%s template=%s locale=%s", to, template_name, locale)
        return

    if mode != "real":
        raise ValueError(f"Invalid EMAIL_BRIDGE_MODE: {mode!r}")

    if not settings.email_from:
        raise RuntimeError("EMAIL_FROM is required for real email sending")
    if not settings.email_ses_region:
        raise RuntimeError("EMAIL_SES_REGION is required for real email sending")

    html_body = _render_template(template_name, locale, context)

    try:
        import boto3
    except ImportError as exc:
        raise RuntimeError("boto3 is required for real email sending") from exc

    ses = boto3.client("ses", region_name=settings.email_ses_region)
    ses.send_email(
        Source=settings.email_from,
        Destination={"ToAddresses": [to]},
        Message={
            "Subject": {"Data": subject},
            "Body": {"Html": {"Data": html_body}},
        },
    )
    log.info("email_client.sent to=%s template=%s locale=%s", to, template_name, locale)


def read_sink() -> list[dict[str, Any]]:
    """Return all records written to the mock sink. For use in tests."""
    settings = get_settings()
    path = Path(settings.email_sink_path)
    if not path.exists():
        return []
    records = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if line:
            records.append(json.loads(line))
    return records


def clear_sink() -> None:
    """Truncate the mock sink. Call in test teardown."""
    settings = get_settings()
    path = Path(settings.email_sink_path)
    if path.exists():
        path.unlink()