from __future__ import annotations

import structlog
from fastapi import HTTPException, status

from app.config import get_settings

logger = structlog.get_logger(__name__)


async def send_escalation_email(*, subject: str, body_text: str) -> None:
    settings = get_settings()
    mode = settings.email_mode.lower().strip()
    if mode == "mock":
        logger.info(
            "notify.email.mock",
            subject=subject,
            to=settings.email_escalations_to,
        )
        return
    if mode != "real":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Invalid EMAIL_MODE"
        )

    if not settings.email_from or not settings.email_escalations_to:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="EMAIL_FROM or EMAIL_ESCALATIONS_TO not set",
        )
    if not settings.email_ses_region:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="EMAIL_SES_REGION not set"
        )

    try:
        import boto3
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="boto3 not installed"
        ) from exc

    ses = boto3.client("ses", region_name=settings.email_ses_region)
    ses.send_email(
        Source=settings.email_from,
        Destination={"ToAddresses": [settings.email_escalations_to]},
        Message={
            "Subject": {"Data": subject},
            "Body": {"Text": {"Data": body_text}},
        },
    )

