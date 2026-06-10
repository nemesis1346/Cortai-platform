from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlalchemy import text

from app.auth.dependencies import PrincipalDep
from app.bridges import iot_client
from app.db import SessionDep
from app.operations.meetings_schemas import (
    MeetingBookingCreate,
    MeetingBookingList,
    MeetingBookingRead,
    MeetingBookingUpdate,
    MeetingRoomCreate,
    MeetingRoomList,
    MeetingRoomRead,
    MeetingRoomUpdate,
)

router = APIRouter(prefix="/meetings", tags=["operations-meetings"])


@router.get("/rooms", response_model=MeetingRoomList)
async def list_meeting_rooms(
    principal: PrincipalDep,
    session: SessionDep,
    property_id: uuid.UUID = Query(...),
) -> MeetingRoomList:
    exists = await session.scalar(
        text("select 1 from properties where id = :id and org_id = :org_id"),
        {"id": str(property_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    rows = (
        await session.execute(
            text(
                """
                select
                  id, org_id, property_id,
                  name, capacity, equipment,
                  created_at, updated_at
                from ops.meeting_rooms
                where org_id = :org_id and property_id = :property_id
                order by name asc, id asc
                """
            ),
            {"org_id": str(principal.org_id), "property_id": str(property_id)},
        )
    ).mappings().all()
    return MeetingRoomList(items=[MeetingRoomRead(**dict(r)) for r in rows])


@router.post("/rooms", response_model=MeetingRoomRead, status_code=status.HTTP_201_CREATED)
async def create_meeting_room(
    payload: MeetingRoomCreate,
    principal: PrincipalDep,
    session: SessionDep,
) -> MeetingRoomRead:
    exists = await session.scalar(
        text("select 1 from properties where id = :id and org_id = :org_id"),
        {"id": str(payload.property_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    row = (
        await session.execute(
            text(
                """
                insert into ops.meeting_rooms (
                  id, org_id, property_id,
                  name, capacity, equipment,
                  created_at, updated_at
                )
                values (
                  gen_random_uuid(), :org_id, :property_id,
                  :name, :capacity, :equipment,
                  now(), now()
                )
                returning
                  id, org_id, property_id,
                  name, capacity, equipment,
                  created_at, updated_at
                """
            ),
            {
                "org_id": str(principal.org_id),
                "property_id": str(payload.property_id),
                "name": payload.name,
                "capacity": payload.capacity,
                "equipment": payload.equipment,
            },
        )
    ).mappings().one()
    await session.commit()
    return MeetingRoomRead(**dict(row))


@router.patch("/rooms/{room_id}", response_model=MeetingRoomRead)
async def update_meeting_room(
    room_id: uuid.UUID,
    payload: MeetingRoomUpdate,
    principal: PrincipalDep,
    session: SessionDep,
) -> MeetingRoomRead:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")

    current = (
        await session.execute(
            text(
                """
                select id
                from ops.meeting_rooms
                where id = :id and org_id = :org_id
                """
            ),
            {"id": str(room_id), "org_id": str(principal.org_id)},
        )
    ).mappings().first()
    if current is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    sets: list[str] = []
    params: dict[str, object] = {"id": str(room_id), "org_id": str(principal.org_id)}
    for k, v in data.items():
        sets.append(f"{k} = :{k}")  # noqa: S608
        params[k] = v
    sets.append("updated_at = now()")

    row = (
        await session.execute(
            text(
                f"""
                update ops.meeting_rooms
                set {", ".join(sets)}
                where id = :id and org_id = :org_id
                returning
                  id, org_id, property_id,
                  name, capacity, equipment,
                  created_at, updated_at
                """  # noqa: S608
            ),
            params,
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    await session.commit()
    return MeetingRoomRead(**dict(row))


@router.delete("/rooms/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_meeting_room(
    room_id: uuid.UUID,
    principal: PrincipalDep,
    session: SessionDep,
) -> None:
    deleted = await session.execute(
        text("delete from ops.meeting_rooms where id = :id and org_id = :org_id"),
        {"id": str(room_id), "org_id": str(principal.org_id)},
    )
    if (deleted.rowcount or 0) == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    await session.commit()
    return None


@router.get("/bookings", response_model=MeetingBookingList)
async def list_meeting_bookings(
    principal: PrincipalDep,
    session: SessionDep,
    property_id: uuid.UUID = Query(...),
    meeting_room_id: uuid.UUID | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> MeetingBookingList:
    exists = await session.scalar(
        text("select 1 from properties where id = :id and org_id = :org_id"),
        {"id": str(property_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    where = ["org_id = :org_id", "property_id = :property_id"]
    params: dict[str, object] = {"org_id": str(principal.org_id), "property_id": str(property_id)}
    if meeting_room_id is not None:
        where.append("meeting_room_id = :meeting_room_id")
        params["meeting_room_id"] = str(meeting_room_id)

    total = await session.scalar(
        text(
            f"""
            select count(*)
            from ops.meeting_bookings
            where {" and ".join(where)}
            """  # noqa: S608
        ),
        params,
    )

    rows = (
        await session.execute(
            text(
                f"""
                select
                  id, org_id, property_id, meeting_room_id, organizer_guest_id_or_user_id,
                  title, attendees_count, starts_at, ends_at, setup_status,
                  created_at, updated_at
                from ops.meeting_bookings
                where {" and ".join(where)}
                order by starts_at desc, id desc
                offset :offset limit :limit
                """  # noqa: S608
            ),
            {**params, "offset": (page - 1) * page_size, "limit": page_size},
        )
    ).mappings().all()

    return MeetingBookingList(
        items=[MeetingBookingRead(**dict(r)) for r in rows],
        total=int(total or 0),
        page=page,
        page_size=page_size,
    )


@router.post("/bookings", response_model=MeetingBookingRead, status_code=status.HTTP_201_CREATED)
async def create_meeting_booking(
    payload: MeetingBookingCreate,
    principal: PrincipalDep,
    session: SessionDep,
) -> MeetingBookingRead:
    exists = await session.scalar(
        text("select 1 from properties where id = :id and org_id = :org_id"),
        {"id": str(payload.property_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")
    if payload.ends_at <= payload.starts_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ends_at must be after starts_at")

    room_ok = await session.scalar(
        text(
            """
            select 1
            from ops.meeting_rooms
            where id = :id and org_id = :org_id and property_id = :property_id
            """
        ),
        {"id": str(payload.meeting_room_id), "org_id": str(principal.org_id), "property_id": str(payload.property_id)},
    )
    if room_ok is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting room not found")

    row = (
        await session.execute(
            text(
                """
                insert into ops.meeting_bookings (
                  id, org_id, property_id, meeting_room_id, organizer_guest_id_or_user_id,
                  title, attendees_count, starts_at, ends_at, setup_status,
                  created_at, updated_at
                )
                values (
                  gen_random_uuid(), :org_id, :property_id, :meeting_room_id, :organizer,
                  :title, :attendees_count, :starts_at, :ends_at, :setup_status,
                  now(), now()
                )
                returning
                  id, org_id, property_id, meeting_room_id, organizer_guest_id_or_user_id,
                  title, attendees_count, starts_at, ends_at, setup_status,
                  created_at, updated_at
                """
            ),
            {
                "org_id": str(principal.org_id),
                "property_id": str(payload.property_id),
                "meeting_room_id": str(payload.meeting_room_id),
                "organizer": str(payload.organizer_guest_id_or_user_id) if payload.organizer_guest_id_or_user_id else None,
                "title": payload.title,
                "attendees_count": payload.attendees_count,
                "starts_at": payload.starts_at,
                "ends_at": payload.ends_at,
                "setup_status": payload.setup_status,
            },
        )
    ).mappings().one()
    await session.commit()
    return MeetingBookingRead(**dict(row))


@router.patch("/bookings/{booking_id}", response_model=MeetingBookingRead)
async def update_meeting_booking(
    booking_id: uuid.UUID,
    payload: MeetingBookingUpdate,
    principal: PrincipalDep,
    session: SessionDep,
) -> MeetingBookingRead:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")

    current = (
        await session.execute(
            text(
                """
                select id, property_id, meeting_room_id, starts_at, ends_at
                from ops.meeting_bookings
                where id = :id and org_id = :org_id
                """
            ),
            {"id": str(booking_id), "org_id": str(principal.org_id)},
        )
    ).mappings().first()
    if current is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")

    starts_at = data.get("starts_at", current["starts_at"])
    ends_at = data.get("ends_at", current["ends_at"])
    if ends_at <= starts_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ends_at must be after starts_at")

    if payload.meeting_room_id is not None:
        room_ok = await session.scalar(
            text(
                """
                select 1
                from ops.meeting_rooms
                where id = :id and org_id = :org_id and property_id = :property_id
                """
            ),
            {
                "id": str(payload.meeting_room_id),
                "org_id": str(principal.org_id),
                "property_id": str(current["property_id"]),
            },
        )
        if room_ok is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting room not found")

    sets: list[str] = []
    params: dict[str, object] = {"id": str(booking_id), "org_id": str(principal.org_id)}
    for k, v in data.items():
        sets.append(f"{k} = :{k}")  # noqa: S608
        params[k] = str(v) if isinstance(v, uuid.UUID) else v
    sets.append("updated_at = now()")

    row = (
        await session.execute(
            text(
                f"""
                update ops.meeting_bookings
                set {", ".join(sets)}
                where id = :id and org_id = :org_id
                returning
                  id, org_id, property_id, meeting_room_id, organizer_guest_id_or_user_id,
                  title, attendees_count, starts_at, ends_at, setup_status,
                  created_at, updated_at
                """  # noqa: S608
            ),
            params,
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")

    await session.commit()
    return MeetingBookingRead(**dict(row))


@router.get("/bookings/{booking_id}/attendance")
async def get_meeting_booking_attendance(
    request: Request,
    booking_id: uuid.UUID,
    principal: PrincipalDep,
    session: SessionDep,
) -> object:
    """
    Proxy attendance count from IoT bridge (door counter).
    """

    exists = await session.scalar(
        text("select 1 from ops.meeting_bookings where id = :id and org_id = :org_id"),
        {"id": str(booking_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")

    return await iot_client.get_meeting_booking_attendance(request=request, booking_id=booking_id)

