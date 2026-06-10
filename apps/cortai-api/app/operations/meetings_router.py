from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import text

from app.auth.dependencies import PrincipalDep
from app.db import SessionDep
from app.operations.meetings_schemas import MeetingRoomCreate, MeetingRoomList, MeetingRoomRead, MeetingRoomUpdate

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

