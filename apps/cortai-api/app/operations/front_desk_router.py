from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Query
from sqlalchemy import text

from app.auth.dependencies import PrincipalDep
from app.db import SessionDep
from app.operations.front_desk_schemas import (
    FrontDeskArrivals,
    FrontDeskDepartures,
    FrontDeskInHotel,
    FrontDeskStats,
)

router = APIRouter(prefix="/front-desk", tags=["operations-front-desk"])


@router.get("/stats", response_model=FrontDeskStats)
async def get_front_desk_stats(
    principal: PrincipalDep,
    session: SessionDep,
    property_id: uuid.UUID | None = Query(default=None),
) -> FrontDeskStats:
    now = datetime.now(UTC)
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_day = start_of_day + timedelta(days=1)

    # Served today: count of served events ending today.
    served_today = int(
        (
            await session.scalar(
                text(
                    """
                    select count(*)::int
                    from ops.front_desk_events
                    where org_id = :org_id
                      and property_id = coalesce(:property_id, property_id)
                      and kind = 'served'
                      and ended_at is not null
                      and ended_at >= :sod and ended_at < :eod
                    """
                ),
                {
                    "org_id": principal.org_id,
                    "property_id": property_id,
                    "sod": start_of_day,
                    "eod": end_of_day,
                },
            )
        )
        or 0
    )

    # In queue now: queue_joined events not yet ended.
    in_queue_now = int(
        (
            await session.scalar(
                text(
                    """
                    select count(*)::int
                    from ops.front_desk_events
                    where org_id = :org_id
                      and property_id = coalesce(:property_id, property_id)
                      and kind = 'queue_joined'
                      and started_at >= :sod and started_at < :eod
                      and ended_at is null
                    """
                ),
                {
                    "org_id": principal.org_id,
                    "property_id": property_id,
                    "sod": start_of_day,
                    "eod": end_of_day,
                },
            )
        )
        or 0
    )

    # Average queue time today: queue_joined durations.
    queue_avg_seconds = float(
        (
            await session.scalar(
                text(
                    """
                    select coalesce(avg(extract(epoch from (ended_at - started_at))), 0)::float
                    from ops.front_desk_events
                    where org_id = :org_id
                      and property_id = coalesce(:property_id, property_id)
                      and kind = 'queue_joined'
                      and ended_at is not null
                      and started_at >= :sod and started_at < :eod
                    """
                ),
                {
                    "org_id": principal.org_id,
                    "property_id": property_id,
                    "sod": start_of_day,
                    "eod": end_of_day,
                },
            )
        )
        or 0.0
    )

    # Average check-in time today: checked_in durations.
    checkin_avg_seconds = float(
        (
            await session.scalar(
                text(
                    """
                    select coalesce(avg(extract(epoch from (ended_at - started_at))), 0)::float
                    from ops.front_desk_events
                    where org_id = :org_id
                      and property_id = coalesce(:property_id, property_id)
                      and kind = 'checked_in'
                      and ended_at is not null
                      and started_at >= :sod and started_at < :eod
                    """
                ),
                {
                    "org_id": principal.org_id,
                    "property_id": property_id,
                    "sod": start_of_day,
                    "eod": end_of_day,
                },
            )
        )
        or 0.0
    )

    return FrontDeskStats(
        served_today=served_today,
        in_queue_now=in_queue_now,
        queue_avg_seconds=queue_avg_seconds,
        checkin_avg_seconds=checkin_avg_seconds,
    )


@router.get("/arrivals", response_model=FrontDeskArrivals)
async def list_arrivals(
    principal: PrincipalDep,
    session: SessionDep,
    property_id: uuid.UUID = Query(...),
    date: date | None = Query(default=None),  # noqa: A002
) -> FrontDeskArrivals:
    """
    Arrivals list for a given date.

    V1 behavior: date window is computed in UTC.
    """
    target = date or datetime.now(UTC).date()
    start = datetime(target.year, target.month, target.day, tzinfo=UTC)
    end = start + timedelta(days=1)

    rows = (
        await session.execute(
            text(
                """
                select
                  r.id as reservation_id,
                  r.property_id,
                  r.status,
                  r.check_in_at,
                  r.check_out_at,
                  g.first_name as guest__first_name,
                  g.last_name as guest__last_name,
                  g.vip as guest__vip,
                  r.room_id,
                  rm.room_number
                from ops.reservations r
                join ops.guests g on g.id = r.guest_id
                left join ops.rooms rm on rm.id = r.room_id
                where r.org_id = :org_id
                  and r.property_id = :property_id
                  and r.check_in_at >= :start and r.check_in_at < :end
                  and r.status not in ('cancelled','no_show')
                order by g.vip desc, r.check_in_at asc, r.id asc
                """
            ),
            {
                "org_id": str(principal.org_id),
                "property_id": str(property_id),
                "start": start,
                "end": end,
            },
        )
    ).mappings().all()

    items = []
    for r in rows:
        rr = dict(r)
        guest = {
            "first_name": rr.pop("guest__first_name"),
            "last_name": rr.pop("guest__last_name"),
            "vip": rr.pop("guest__vip"),
        }
        rr["guest"] = guest
        items.append(rr)

    return FrontDeskArrivals(date=target, items=items)


@router.get("/departures", response_model=FrontDeskDepartures)
async def list_departures(
    principal: PrincipalDep,
    session: SessionDep,
    property_id: uuid.UUID = Query(...),
    date: date | None = Query(default=None),  # noqa: A002
) -> FrontDeskDepartures:
    """
    Departures list for a given date.

    V1 behavior: date window is computed in UTC.
    """
    target = date or datetime.now(UTC).date()
    start = datetime(target.year, target.month, target.day, tzinfo=UTC)
    end = start + timedelta(days=1)

    rows = (
        await session.execute(
            text(
                """
                select
                  r.id as reservation_id,
                  r.property_id,
                  r.status,
                  r.check_in_at,
                  r.check_out_at,
                  g.first_name as guest__first_name,
                  g.last_name as guest__last_name,
                  g.vip as guest__vip,
                  r.room_id,
                  rm.room_number
                from ops.reservations r
                join ops.guests g on g.id = r.guest_id
                left join ops.rooms rm on rm.id = r.room_id
                where r.org_id = :org_id
                  and r.property_id = :property_id
                  and r.check_out_at >= :start and r.check_out_at < :end
                  and r.status not in ('cancelled','no_show')
                order by g.vip desc, r.check_out_at asc, r.id asc
                """
            ),
            {
                "org_id": str(principal.org_id),
                "property_id": str(property_id),
                "start": start,
                "end": end,
            },
        )
    ).mappings().all()

    items = []
    for r in rows:
        rr = dict(r)
        guest = {
            "first_name": rr.pop("guest__first_name"),
            "last_name": rr.pop("guest__last_name"),
            "vip": rr.pop("guest__vip"),
        }
        rr["guest"] = guest
        items.append(rr)

    return FrontDeskDepartures(date=target, items=items)


@router.get("/in-hotel", response_model=FrontDeskInHotel)
async def list_in_hotel(
    principal: PrincipalDep,
    session: SessionDep,
    property_id: uuid.UUID = Query(...),
) -> FrontDeskInHotel:
    """
    In-hotel guests: checked-in reservations active "now".
    """
    now = datetime.now(UTC)
    rows = (
        await session.execute(
            text(
                """
                select
                  r.id as reservation_id,
                  r.property_id,
                  r.status,
                  r.check_in_at,
                  r.check_out_at,
                  g.first_name as guest__first_name,
                  g.last_name as guest__last_name,
                  g.vip as guest__vip,
                  r.room_id,
                  rm.room_number
                from ops.reservations r
                join ops.guests g on g.id = r.guest_id
                left join ops.rooms rm on rm.id = r.room_id
                where r.org_id = :org_id
                  and r.property_id = :property_id
                  and r.status = 'checked_in'
                  and r.check_in_at <= :now
                  and r.check_out_at > :now
                order by g.vip desc, r.check_in_at desc, r.id asc
                """
            ),
            {
                "org_id": str(principal.org_id),
                "property_id": str(property_id),
                "now": now,
            },
        )
    ).mappings().all()

    items = []
    for r in rows:
        rr = dict(r)
        guest = {
            "first_name": rr.pop("guest__first_name"),
            "last_name": rr.pop("guest__last_name"),
            "vip": rr.pop("guest__vip"),
        }
        rr["guest"] = guest
        items.append(rr)

    return FrontDeskInHotel(items=items)

