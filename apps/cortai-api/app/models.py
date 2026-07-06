import enum
import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, Enum, ForeignKey, SmallInteger, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class UserRole(enum.StrEnum):
    IT_ADMIN = "IT_ADMIN"
    SERVICE_PROVIDER_ADMIN = "SERVICE_PROVIDER_ADMIN"
    HOTEL_ADMIN = "HOTEL_ADMIN"
    STAFF = "STAFF"


class UserStatus(enum.StrEnum):
    ACTIVE = "ACTIVE"
    INVITED = "INVITED"
    DISABLED = "DISABLED"


class PropertyStatus(enum.StrEnum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )


class Organization(TimestampMixin, Base):
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)

    users: Mapped[list["User"]] = relationship(back_populates="organization")


class User(TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("org_id", "email", name="uq_users_org_email"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(180), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, name="user_role"), nullable=False)
    status: Mapped[UserStatus] = mapped_column(
        Enum(UserStatus, name="user_status"), default=UserStatus.INVITED, nullable=False
    )
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    password_policy_version: Mapped[int] = mapped_column(SmallInteger(), nullable=False, default=1)
    password_changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )

    organization: Mapped[Organization] = relationship(back_populates="users")


class Property(TimestampMixin, Base):
    __tablename__ = "properties"
    __table_args__ = (UniqueConstraint("org_id", "slug", name="uq_properties_org_slug"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )

    name: Mapped[str] = mapped_column(String(180), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), nullable=False)

    marsha_property_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    address: Mapped[str | None] = mapped_column(sa.Text(), nullable=True)  # type: ignore[name-defined]
    room_count: Mapped[int | None] = mapped_column(sa.Integer(), nullable=True)  # type: ignore[name-defined]
    status: Mapped[PropertyStatus] = mapped_column(
        Enum(PropertyStatus, name="property_status"), default=PropertyStatus.ACTIVE, nullable=False
    )
