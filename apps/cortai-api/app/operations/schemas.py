from pydantic import BaseModel, Field


class OccupancyRooms(BaseModel):
    used: int = Field(ge=0)
    total: int = Field(ge=0)


class ArrivalsToday(BaseModel):
    count: int = Field(ge=0)
    arrived: int = Field(ge=0)


class DeparturesToday(BaseModel):
    count: int = Field(ge=0)
    departed: int = Field(ge=0)


class OperationsKpis(BaseModel):
    occupancy_pct: float = Field(ge=0, le=100)
    occupancy_rooms: OccupancyRooms

    guests_in_hotel: int = Field(ge=0)
    guests_total_capacity: int = Field(ge=0)

    staff_on_site: int = Field(ge=0)
    staff_on_duty: int = Field(ge=0)

    arrivals_today: ArrivalsToday
    departures_today: DeparturesToday

    rooms_ready: int = Field(ge=0)
    rooms_cleaning: int = Field(ge=0)

