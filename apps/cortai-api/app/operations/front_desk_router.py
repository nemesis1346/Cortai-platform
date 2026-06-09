from __future__ import annotations

import json
import uuid
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Query
from fastapi.encoders import jsonable_encoder
from sqlalchemy import text

from app.auth.dependencies import PrincipalDep
from app.db import SessionDep
from app.operations.front_desk_schemas import (
    FrontDeskArrivals,
    FrontDeskCheckInRequest,
    FrontDeskCheckInResult,
    FrontDeskCheckOutResult,
    FrontDeskDepartures,
    FrontDeskInHotel,
    FrontDeskQueue,
    FrontDeskStats,
    FrontDeskQueueJoinRequest,
    FrontDeskQueueJoinResult,
    FrontDeskQueueServeRequest,
    FrontDeskQueueServeResult,
    FrontDeskWalkInRequest,
    FrontDeskWalkInResult,
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


@router.get("/queue", response_model=FrontDeskQueue)
async def list_queue(
    principal: PrincipalDep,
    session: SessionDep,
    property_id: uuid.UUID = Query(...),
) -> FrontDeskQueue:
    """
    Current front-desk queue: open queue_joined events for this property.
    """
    rows = (
        await session.execute(
            text(
                """
                select
                  e.id as event_id,
                  e.reservation_id,
                  e.queue_position,
                  e.started_at,
                  g.first_name as guest__first_name,
                  g.last_name as guest__last_name,
                  g.vip as guest__vip
                from ops.front_desk_events e
                join ops.guests g on g.id = e.guest_id
                where e.org_id = :org_id
                  and e.property_id = :property_id
                  and e.kind = 'queue_joined'
                  and e.ended_at is null
                order by e.queue_position asc nulls last, e.started_at asc, e.id asc
                """
            ),
            {"org_id": str(principal.org_id), "property_id": str(property_id)},
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

    return FrontDeskQueue(items=items)


@router.post("/check-in/{reservation_id}", response_model=FrontDeskCheckInResult)
async def check_in_reservation(
    reservation_id: uuid.UUID,
    payload: FrontDeskCheckInRequest,
    principal: PrincipalDep,
    session: SessionDep,
) -> FrontDeskCheckInResult:
    """
    Check-in: assign room, set reservation checked_in, update room occupancy, create key request, emit WS event.
    """
    now = datetime.now(UTC)

    # Load reservation (scoped to org) and ensure it's eligible.
    res = (
        await session.execute(
            text(
                """
                select id, org_id, property_id, guest_id, room_id, status, check_in_at, check_out_at
                from ops.reservations
                where id = :id and org_id = :org_id
                """
            ),
            {"id": str(reservation_id), "org_id": str(principal.org_id)},
        )
    ).mappings().first()
    if res is None:
        from fastapi import HTTPException, status  # local import to keep router import light

        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reservation not found")

    if str(res["status"]) in {"checked_in", "checked_out", "cancelled", "no_show"}:
        from fastapi import HTTPException, status  # noqa: PLC0415

        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reservation is not eligible for check-in")

    # Validate room belongs to org/property.
    room = (
        await session.execute(
            text(
                """
                select id, org_id, property_id, status
                from ops.rooms
                where id = :room_id and org_id = :org_id and property_id = :property_id
                """
            ),
            {
                "room_id": str(payload.room_id),
                "org_id": str(principal.org_id),
                "property_id": str(res["property_id"]),
            },
        )
    ).mappings().first()
    if room is None:
        from fastapi import HTTPException, status  # noqa: PLC0415

        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    # Update reservation.
    await session.execute(
        text(
            """
            update ops.reservations
            set room_id = :room_id,
                status = 'checked_in',
                updated_at = now()
            where id = :id and org_id = :org_id
            """
        ),
        {"id": str(reservation_id), "org_id": str(principal.org_id), "room_id": str(payload.room_id)},
    )

    # Update room occupancy and current reservation pointer.
    await session.execute(
        text(
            """
            update ops.rooms
            set status = 'occupied',
                current_reservation_id = :reservation_id,
                updated_at = now()
            where id = :room_id and org_id = :org_id
            """
        ),
        {"room_id": str(payload.room_id), "org_id": str(principal.org_id), "reservation_id": str(reservation_id)},
    )

    # Record a front desk event.
    await session.execute(
        text(
            """
            insert into ops.front_desk_events (
              id, org_id, property_id, kind, guest_id, reservation_id,
              queue_position, started_at, ended_at, created_at, updated_at
            )
            values (
              :id, :org_id, :property_id, 'checked_in', :guest_id, :reservation_id,
              null, :now, :now, :now, :now
            )
            """
        ),
        {
            "id": str(uuid.uuid4()),
            "org_id": str(principal.org_id),
            "property_id": str(res["property_id"]),
            "guest_id": str(res["guest_id"]),
            "reservation_id": str(reservation_id),
            "now": now,
        },
    )

    # Create key request in action queue.
    await session.execute(
        text(
            """
            insert into ops.action_queue (
              id, org_id, property_id, type, source, room_id, guest_id, title,
              status, severity, assigned_to_user_id, sla_due_at, completed_at, parent_incident_id,
              created_at, updated_at
            )
            values (
              :id, :org_id, :property_id, 'request', 'front_desk', :room_id, :guest_id, :title,
              'pending', 'low', null, null, null, null,
              :now, :now
            )
            """
        ),
        {
            "id": str(uuid.uuid4()),
            "org_id": str(principal.org_id),
            "property_id": str(res["property_id"]),
            "room_id": str(payload.room_id),
            "guest_id": str(res["guest_id"]),
            "title": f"Key request for room {payload.room_id}",
            "now": now,
        },
    )

    # Live event for UI.
    event = {
        "type": "front_desk.event",
        "org_id": str(principal.org_id),
        "property_id": str(res["property_id"]),
        "kind": "checked_in",
        "reservation_id": str(reservation_id),
        "room_id": str(payload.room_id),
        "_server_published_at": now.isoformat(),
        "_server_published_at_ms": int(now.timestamp() * 1000),
    }
    await session.execute(
        text("select pg_notify('cortai_live', :payload)"),
        {"payload": json.dumps(jsonable_encoder(event))},
    )

    await session.commit()
    return FrontDeskCheckInResult(reservation_id=reservation_id, room_id=payload.room_id, status="checked_in")


@router.post("/check-out/{reservation_id}", response_model=FrontDeskCheckOutResult)
async def check_out_reservation(
    reservation_id: uuid.UUID,
    principal: PrincipalDep,
    session: SessionDep,
) -> FrontDeskCheckOutResult:
    """
    Check-out: mark reservation checked_out, clear room occupancy, emit WS event.

    V1: "closes folio" is represented as reservation status change + action queue follow-up can be added later.
    """
    now = datetime.now(UTC)

    # Load reservation (scoped to org) and ensure it's eligible.
    res = (
        await session.execute(
            text(
                """
                select id, org_id, property_id, guest_id, room_id, status
                from ops.reservations
                where id = :id and org_id = :org_id
                """
            ),
            {"id": str(reservation_id), "org_id": str(principal.org_id)},
        )
    ).mappings().first()
    if res is None:
        from fastapi import HTTPException, status  # local import to keep router import light

        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reservation not found")

    if str(res["status"]) != "checked_in":
        from fastapi import HTTPException, status  # noqa: PLC0415

        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reservation is not eligible for check-out")

    if res["room_id"] is None:
        from fastapi import HTTPException, status  # noqa: PLC0415

        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reservation has no assigned room")

    room_id = uuid.UUID(str(res["room_id"]))

    # Mark reservation checked_out.
    await session.execute(
        text(
            """
            update ops.reservations
            set status = 'checked_out',
                updated_at = now()
            where id = :id and org_id = :org_id
            """
        ),
        {"id": str(reservation_id), "org_id": str(principal.org_id)},
    )

    # Clear room occupancy pointer (best-effort, only if it still points to this reservation).
    await session.execute(
        text(
            """
            update ops.rooms
            set status = 'vacant_dirty',
                current_reservation_id = null,
                updated_at = now()
            where id = :room_id and org_id = :org_id
              and (current_reservation_id is null or current_reservation_id = :reservation_id)
            """
        ),
        {"room_id": str(room_id), "org_id": str(principal.org_id), "reservation_id": str(reservation_id)},
    )

    # Record a front desk event.
    await session.execute(
        text(
            """
            insert into ops.front_desk_events (
              id, org_id, property_id, kind, guest_id, reservation_id,
              queue_position, started_at, ended_at, created_at, updated_at
            )
            values (
              :id, :org_id, :property_id, 'checked_out', :guest_id, :reservation_id,
              null, :now, :now, :now, :now
            )
            """
        ),
        {
            "id": str(uuid.uuid4()),
            "org_id": str(principal.org_id),
            "property_id": str(res["property_id"]),
            "guest_id": str(res["guest_id"]),
            "reservation_id": str(reservation_id),
            "now": now,
        },
    )

    # Live event for UI.
    event = {
        "type": "front_desk.event",
        "org_id": str(principal.org_id),
        "property_id": str(res["property_id"]),
        "kind": "checked_out",
        "reservation_id": str(reservation_id),
        "room_id": str(room_id),
        "_server_published_at": now.isoformat(),
        "_server_published_at_ms": int(now.timestamp() * 1000),
    }
    await session.execute(
        text("select pg_notify('cortai_live', :payload)"),
        {"payload": json.dumps(jsonable_encoder(event))},
    )

    await session.commit()
    return FrontDeskCheckOutResult(reservation_id=reservation_id, room_id=room_id, status="checked_out")


@router.post("/walk-in", response_model=FrontDeskWalkInResult)
async def walk_in(
    payload: FrontDeskWalkInRequest,
    principal: PrincipalDep,
    session: SessionDep,
) -> FrontDeskWalkInResult:
    """
    Walk-in: create guest + reservation + check-in in one shot.

    V1: minimal guest profile + immediate room assignment.
    """
    from fastapi import HTTPException, status  # local import to keep router import light

    now = datetime.now(UTC)

    # Validate room belongs to org/property and is usable.
    room = (
        await session.execute(
            text(
                """
                select id, org_id, property_id, status
                from ops.rooms
                where id = :room_id and org_id = :org_id and property_id = :property_id
                """
            ),
            {
                "room_id": str(payload.room_id),
                "org_id": str(principal.org_id),
                "property_id": str(payload.property_id),
            },
        )
    ).mappings().first()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    if str(room["status"]) in {"occupied", "out_of_order"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Room is not eligible for walk-in")

    guest_id = uuid.uuid4()
    reservation_id = uuid.uuid4()
    check_out_at = payload.effective_check_out_at(now=now)

    # Create guest.
    await session.execute(
        text(
            """
            insert into ops.guests (id, org_id, first_name, last_name, vip, language, created_at, updated_at)
            values (:id, :org_id, :first_name, :last_name, :vip, :language, :now, :now)
            """
        ),
        {
            "id": str(guest_id),
            "org_id": str(principal.org_id),
            "first_name": payload.guest.first_name.strip(),
            "last_name": payload.guest.last_name.strip(),
            "vip": bool(payload.guest.vip),
            "language": payload.guest.language.strip() or "en",
            "now": now,
        },
    )

    # Create reservation in checked_in state with room assigned.
    await session.execute(
        text(
            """
            insert into ops.reservations (
              id, org_id, guest_id, property_id, room_id, status,
              check_in_at, check_out_at, rate_cents, group_id, source,
              created_at, updated_at
            )
            values (
              :id, :org_id, :guest_id, :property_id, :room_id, 'checked_in',
              :check_in_at, :check_out_at, null, null, 'walk_in',
              :now, :now
            )
            """
        ),
        {
            "id": str(reservation_id),
            "org_id": str(principal.org_id),
            "guest_id": str(guest_id),
            "property_id": str(payload.property_id),
            "room_id": str(payload.room_id),
            "check_in_at": now,
            "check_out_at": check_out_at,
            "now": now,
        },
    )

    # Update room occupancy and current reservation pointer.
    await session.execute(
        text(
            """
            update ops.rooms
            set status = 'occupied',
                current_reservation_id = :reservation_id,
                updated_at = now()
            where id = :room_id and org_id = :org_id
            """
        ),
        {
            "room_id": str(payload.room_id),
            "org_id": str(principal.org_id),
            "reservation_id": str(reservation_id),
        },
    )

    # Record a walk-in event (front desk).
    await session.execute(
        text(
            """
            insert into ops.front_desk_events (
              id, org_id, property_id, kind, guest_id, reservation_id,
              queue_position, started_at, ended_at, created_at, updated_at
            )
            values (
              :id, :org_id, :property_id, 'walk_in', :guest_id, :reservation_id,
              null, :now, :now, :now, :now
            )
            """
        ),
        {
            "id": str(uuid.uuid4()),
            "org_id": str(principal.org_id),
            "property_id": str(payload.property_id),
            "guest_id": str(guest_id),
            "reservation_id": str(reservation_id),
            "now": now,
        },
    )

    # Also record check-in event for metrics parity with normal check-in.
    await session.execute(
        text(
            """
            insert into ops.front_desk_events (
              id, org_id, property_id, kind, guest_id, reservation_id,
              queue_position, started_at, ended_at, created_at, updated_at
            )
            values (
              :id, :org_id, :property_id, 'checked_in', :guest_id, :reservation_id,
              null, :now, :now, :now, :now
            )
            """
        ),
        {
            "id": str(uuid.uuid4()),
            "org_id": str(principal.org_id),
            "property_id": str(payload.property_id),
            "guest_id": str(guest_id),
            "reservation_id": str(reservation_id),
            "now": now,
        },
    )

    # Create key request in action queue.
    await session.execute(
        text(
            """
            insert into ops.action_queue (
              id, org_id, property_id, type, source, room_id, guest_id, title,
              status, severity, assigned_to_user_id, sla_due_at, completed_at, parent_incident_id,
              created_at, updated_at
            )
            values (
              :id, :org_id, :property_id, 'request', 'front_desk', :room_id, :guest_id, :title,
              'pending', 'low', null, null, null, null,
              :now, :now
            )
            """
        ),
        {
            "id": str(uuid.uuid4()),
            "org_id": str(principal.org_id),
            "property_id": str(payload.property_id),
            "room_id": str(payload.room_id),
            "guest_id": str(guest_id),
            "title": f"Key request for room {payload.room_id}",
            "now": now,
        },
    )

    # Live event for UI.
    event = {
        "type": "front_desk.event",
        "org_id": str(principal.org_id),
        "property_id": str(payload.property_id),
        "kind": "walk_in",
        "reservation_id": str(reservation_id),
        "room_id": str(payload.room_id),
        "guest_id": str(guest_id),
        "_server_published_at": now.isoformat(),
        "_server_published_at_ms": int(now.timestamp() * 1000),
    }
    await session.execute(
        text("select pg_notify('cortai_live', :payload)"),
        {"payload": json.dumps(jsonable_encoder(event))},
    )

    await session.commit()
    return FrontDeskWalkInResult(
        reservation_id=reservation_id,
        guest_id=guest_id,
        room_id=payload.room_id,
        status="checked_in",
    )


@router.post("/queue/join", response_model=FrontDeskQueueJoinResult)
async def queue_join(
    payload: FrontDeskQueueJoinRequest,
    principal: PrincipalDep,
    session: SessionDep,
) -> FrontDeskQueueJoinResult:
    """
    Queue join: guest physically arrives.

    Creates an open-ended front desk event with kind=queue_joined and ended_at NULL.
    Emits a live event so UIs can refresh.
    """
    from fastapi import HTTPException, status  # local import to keep router import light

    now = datetime.now(UTC)

    # Reservation must exist in this org/property.
    res = (
        await session.execute(
            text(
                """
                select id, org_id, property_id, guest_id, status
                from ops.reservations
                where id = :id and org_id = :org_id and property_id = :property_id
                """
            ),
            {
                "id": str(payload.reservation_id),
                "org_id": str(principal.org_id),
                "property_id": str(payload.property_id),
            },
        )
    ).mappings().first()
    if res is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reservation not found")

    if str(res["status"]) in {"checked_in", "checked_out", "cancelled", "no_show"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reservation is not eligible to join the queue")

    # Idempotent: if already in queue (today) return existing position.
    existing = (
        await session.execute(
            text(
                """
                select id, queue_position
                from ops.front_desk_events
                where org_id = :org_id
                  and property_id = :property_id
                  and kind = 'queue_joined'
                  and reservation_id = :reservation_id
                  and ended_at is null
                order by started_at desc
                limit 1
                """
            ),
            {
                "org_id": str(principal.org_id),
                "property_id": str(payload.property_id),
                "reservation_id": str(payload.reservation_id),
            },
        )
    ).mappings().first()
    if existing is not None:
        event_id = uuid.UUID(str(existing["id"]))
        pos = int(existing["queue_position"] or 1)
        return FrontDeskQueueJoinResult(
            event_id=event_id,
            queue_position=pos,
            reservation_id=payload.reservation_id,
        )

    # Determine the next queue position for currently-open queue items.
    next_pos = int(
        (
            await session.scalar(
                text(
                    """
                    select coalesce(max(queue_position), 0)::int + 1
                    from ops.front_desk_events
                    where org_id = :org_id
                      and property_id = :property_id
                      and kind = 'queue_joined'
                      and ended_at is null
                    """
                ),
                {"org_id": str(principal.org_id), "property_id": str(payload.property_id)},
            )
        )
        or 1
    )

    event_id = uuid.uuid4()
    await session.execute(
        text(
            """
            insert into ops.front_desk_events (
              id, org_id, property_id, kind, guest_id, reservation_id,
              queue_position, started_at, ended_at, created_at, updated_at
            )
            values (
              :id, :org_id, :property_id, 'queue_joined', :guest_id, :reservation_id,
              :pos, :now, null, :now, :now
            )
            """
        ),
        {
            "id": str(event_id),
            "org_id": str(principal.org_id),
            "property_id": str(payload.property_id),
            "guest_id": str(res["guest_id"]),
            "reservation_id": str(payload.reservation_id),
            "pos": next_pos,
            "now": now,
        },
    )

    event = {
        "type": "front_desk.event",
        "org_id": str(principal.org_id),
        "property_id": str(payload.property_id),
        "kind": "queue_joined",
        "reservation_id": str(payload.reservation_id),
        "queue_position": next_pos,
        "_server_published_at": now.isoformat(),
        "_server_published_at_ms": int(now.timestamp() * 1000),
    }
    await session.execute(
        text("select pg_notify('cortai_live', :payload)"),
        {"payload": json.dumps(jsonable_encoder(event))},
    )

    await session.commit()
    return FrontDeskQueueJoinResult(
        event_id=event_id,
        queue_position=next_pos,
        reservation_id=payload.reservation_id,
    )


@router.post("/queue/serve", response_model=FrontDeskQueueServeResult)
async def queue_serve(
    payload: FrontDeskQueueServeRequest,
    principal: PrincipalDep,
    session: SessionDep,
) -> FrontDeskQueueServeResult:
    """
    Queue serve: clerk picks up next open queue item (FIFO by queue_position then started_at).

    Closes the queue_joined event and records a served event for metrics.
    Emits a live event so UIs can refresh.
    """
    from fastapi import HTTPException, status  # local import to keep router import light

    now = datetime.now(UTC)

    # Find the next open queue_joined event for this property.
    next_row = (
        await session.execute(
            text(
                """
                select id, reservation_id, guest_id, queue_position
                from ops.front_desk_events
                where org_id = :org_id
                  and property_id = :property_id
                  and kind = 'queue_joined'
                  and ended_at is null
                order by queue_position asc nulls last, started_at asc, id asc
                limit 1
                """
            ),
            {"org_id": str(principal.org_id), "property_id": str(payload.property_id)},
        )
    ).mappings().first()
    if next_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Queue is empty")

    queue_join_event_id = uuid.UUID(str(next_row["id"]))
    reservation_id = uuid.UUID(str(next_row["reservation_id"]))
    guest_id = next_row["guest_id"]
    queue_position = int(next_row["queue_position"] or 1)

    # Close the queue_joined event.
    await session.execute(
        text(
            """
            update ops.front_desk_events
            set ended_at = :now,
                updated_at = :now
            where id = :id and org_id = :org_id
              and kind = 'queue_joined'
              and ended_at is null
            """
        ),
        {"id": str(queue_join_event_id), "org_id": str(principal.org_id), "now": now},
    )

    # Record a served event.
    served_event_id = uuid.uuid4()
    await session.execute(
        text(
            """
            insert into ops.front_desk_events (
              id, org_id, property_id, kind, guest_id, reservation_id,
              queue_position, started_at, ended_at, created_at, updated_at
            )
            values (
              :id, :org_id, :property_id, 'served', :guest_id, :reservation_id,
              :pos, :now, :now, :now, :now
            )
            """
        ),
        {
            "id": str(served_event_id),
            "org_id": str(principal.org_id),
            "property_id": str(payload.property_id),
            "guest_id": str(guest_id) if guest_id is not None else None,
            "reservation_id": str(reservation_id),
            "pos": queue_position,
            "now": now,
        },
    )

    event = {
        "type": "front_desk.event",
        "org_id": str(principal.org_id),
        "property_id": str(payload.property_id),
        "kind": "served",
        "reservation_id": str(reservation_id),
        "queue_position": queue_position,
        "_server_published_at": now.isoformat(),
        "_server_published_at_ms": int(now.timestamp() * 1000),
    }
    await session.execute(
        text("select pg_notify('cortai_live', :payload)"),
        {"payload": json.dumps(jsonable_encoder(event))},
    )

    await session.commit()
    return FrontDeskQueueServeResult(
        served_event_id=served_event_id,
        queue_join_event_id=queue_join_event_id,
        reservation_id=reservation_id,
        queue_position=queue_position,
    )

