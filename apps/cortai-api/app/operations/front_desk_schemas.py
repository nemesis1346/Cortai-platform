import uuid
from datetime import datetime, date

from pydantic import BaseModel, Field


class FrontDeskStats(BaseModel):
    served_today: int = Field(ge=0)
    in_queue_now: int = Field(ge=0)
    queue_avg_seconds: float = Field(ge=0)
    checkin_avg_seconds: float = Field(ge=0)


class FrontDeskGuestSummary(BaseModel):
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(min_length=1, max_length=120)
    vip: bool


class FrontDeskArrivalItem(BaseModel):
    reservation_id: uuid.UUID
    property_id: uuid.UUID
    status: str

    check_in_at: datetime
    check_out_at: datetime

    guest: FrontDeskGuestSummary
    room_id: uuid.UUID | None = None
    room_number: str | None = None


class FrontDeskArrivals(BaseModel):
    date: date
    items: list[FrontDeskArrivalItem]


class FrontDeskDepartureItem(BaseModel):
    reservation_id: uuid.UUID
    property_id: uuid.UUID
    status: str

    check_in_at: datetime
    check_out_at: datetime

    guest: FrontDeskGuestSummary
    room_id: uuid.UUID | None = None
    room_number: str | None = None


class FrontDeskDepartures(BaseModel):
    date: date
    items: list[FrontDeskDepartureItem]


class FrontDeskInHotelItem(BaseModel):
    reservation_id: uuid.UUID
    property_id: uuid.UUID
    status: str

    check_in_at: datetime
    check_out_at: datetime

    guest: FrontDeskGuestSummary
    room_id: uuid.UUID | None = None
    room_number: str | None = None


class FrontDeskInHotel(BaseModel):
    items: list[FrontDeskInHotelItem]


class FrontDeskCheckInRequest(BaseModel):
    room_id: uuid.UUID


class FrontDeskCheckInResult(BaseModel):
    ok: bool = True
    reservation_id: uuid.UUID
    room_id: uuid.UUID
    status: str


class FrontDeskCheckOutResult(BaseModel):
    ok: bool = True
    reservation_id: uuid.UUID
    room_id: uuid.UUID
    status: str

