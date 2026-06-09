from __future__ import annotations

import uuid
from dataclasses import dataclass

from fastapi import HTTPException, status

from app.config import get_settings


@dataclass(frozen=True)
class PresignedPut:
    url: str
    headers: dict[str, str]


def presign_put(*, key: str, content_type: str) -> PresignedPut:
    settings = get_settings()
    mode = settings.s3_mode.lower().strip()
    if mode == "mock":
        # Deterministic placeholder; used for local dev and CI.
        return PresignedPut(
            url=f"https://mock-s3.local/{settings.s3_bucket or 'bucket'}/{key}?signature=mock",
            headers={"content-type": content_type},
        )
    if mode != "real":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Invalid S3_MODE"
        )

    if not settings.s3_bucket:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="S3_BUCKET not set"
        )
    if not settings.s3_region:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="S3_REGION not set"
        )
    if not settings.aws_access_key_id or not settings.aws_secret_access_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="AWS credentials not set"
        )

    try:
        import boto3
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="boto3 not installed"
        ) from exc

    session = boto3.session.Session(
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
        region_name=settings.s3_region,
    )
    client = session.client("s3", endpoint_url=settings.s3_endpoint_url)
    url = client.generate_presigned_url(
        ClientMethod="put_object",
        Params={
            "Bucket": settings.s3_bucket,
            "Key": key,
            "ContentType": content_type,
        },
        ExpiresIn=int(settings.s3_presign_expires_s),
    )
    return PresignedPut(url=url, headers={"content-type": content_type})


def incident_attachment_key(
    *,
    org_id: uuid.UUID,
    incident_id: uuid.UUID,
    attachment_id: uuid.UUID,
    filename: str,
) -> str:
    safe = filename.strip().replace("\\", "_").replace("/", "_")
    safe = safe[:180] if safe else "file"
    return f"orgs/{org_id}/operations/incidents/{incident_id}/attachments/{attachment_id}-{safe}"

