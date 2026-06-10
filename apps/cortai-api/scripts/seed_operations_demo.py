from __future__ import annotations

import argparse
import asyncio
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import SessionLocal, set_current_org


async def seed(*, org_id: uuid.UUID, property_id: uuid.UUID) -> None:
    now = datetime.now(UTC)
    tomorrow = (now + timedelta(days=1)).replace(minute=0, second=0, microsecond=0)

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))

        prop_ok = await session.scalar(
            text("select 1 from properties where id = :property_id and org_id = :org_id"),
            {"property_id": str(property_id), "org_id": str(org_id)},
        )
        if prop_ok is None:
            raise SystemExit(f"Property {property_id} was not found in org {org_id}")

        # Food & Breakfast: menu items (capacity/status come from bridge fixtures or real bridge).
        for service, name_en, name_fr, price_cents in [
            ("breakfast", "Continental Breakfast", "Petit-déjeuner continental", 1800),
            ("restaurant", "Seasonal Salad", "Salade de saison", 2400),
            ("room_service", "Club Sandwich", "Club sandwich", 2200),
        ]:
            exists = await session.scalar(
                text(
                    """
                    select 1 from ops.menu_items
                    where org_id = :org_id and service = :service and name_en = :name_en
                    """
                ),
                {"org_id": str(org_id), "service": service, "name_en": name_en},
            )
            if exists is None:
                await session.execute(
                    text(
                        """
                        insert into ops.menu_items (
                          id, org_id, service, name_en, name_fr, price_cents, allergens, available,
                          created_at, updated_at
                        )
                        values (
                          gen_random_uuid(), :org_id, :service, :name_en, :name_fr, :price_cents, '{}'::text[], true,
                          :now, :now
                        )
                        """
                    ),
                    {
                        "org_id": str(org_id),
                        "service": service,
                        "name_en": name_en,
                        "name_fr": name_fr,
                        "price_cents": price_cents,
                        "now": now,
                    },
                )

        # Demo guest for spa/fitness.
        guest_id = await session.scalar(
            text(
                """
                select id from ops.guests
                    where org_id = :org_id and first_name = 'Operations' and last_name = 'Demo'
                limit 1
                """
            ),
            {"org_id": str(org_id)},
        )
        if guest_id is None:
            guest_id = uuid.uuid4()
            await session.execute(
                text(
                    """
                    insert into ops.guests (
                      id, org_id, first_name, last_name, vip, language, phone_e164, email,
                      preferences_json, created_at, updated_at
                    )
                    values (:guest_id, :org_id, 'Operations', 'Demo', false, 'en', null, null, '{}'::jsonb, :now, :now)
                    """
                ),
                {"guest_id": str(guest_id), "org_id": str(org_id), "now": now},
            )

        # Food & Breakfast: room-service order board needs a property room.
        room_id = await session.scalar(
            text(
                """
                select id from ops.rooms
                where org_id = :org_id and property_id = :property_id and room_number = '900'
                limit 1
                """
            ),
            {"org_id": str(org_id), "property_id": str(property_id)},
        )
        if room_id is None:
            room_id = uuid.uuid4()
            await session.execute(
                text(
                    """
                    insert into ops.rooms (
                      id, org_id, property_id, room_number, floor, type, status, vip,
                      created_at, updated_at
                    )
                    values (
                      :room_id, :org_id, :property_id, '900', 9, 'suite', 'occupied', false,
                      :now, :now
                    )
                    """
                ),
                {"room_id": str(room_id), "org_id": str(org_id), "property_id": str(property_id), "now": now},
            )

        order_exists = await session.scalar(
            text(
                """
                select 1
                from ops.room_service_orders
                where org_id = :org_id and room_id = :room_id and status in ('received', 'preparing')
                limit 1
                """
            ),
            {"org_id": str(org_id), "room_id": str(room_id)},
        )
        if order_exists is None:
            await session.execute(
                text(
                    """
                    insert into ops.room_service_orders (
                      id, org_id, room_id, guest_id, items_json, status,
                      created_at, updated_at
                    )
                    values (
                      gen_random_uuid(), :org_id, :room_id, :guest_id,
                      '[{"name":"Club Sandwich","qty":1},{"name":"Sparkling Water","qty":2}]'::jsonb,
                      'received', :now, :now
                    )
                    """
                ),
                {"org_id": str(org_id), "room_id": str(room_id), "guest_id": str(guest_id), "now": now},
            )

        # Spa services + appointment.
        service_exists = await session.scalar(
            text("select 1 from ops.spa_services where org_id = :org_id and property_id = :property_id and name = 'Deep Tissue Massage'"),
            {"org_id": str(org_id), "property_id": str(property_id)},
        )
        if service_exists is None:
            await session.execute(
                text(
                    """
                    insert into ops.spa_services (
                      id, org_id, property_id, name, description, duration_minutes, price_cents, available, created_at, updated_at
                    )
                    values (
                      gen_random_uuid(), :org_id, :property_id, 'Deep Tissue Massage', 'Demo service', 60, 18000, true, :now, :now
                    )
                    """
                ),
                {"org_id": str(org_id), "property_id": str(property_id), "now": now},
            )

        spa_appt_exists = await session.scalar(
            text("select 1 from ops.spa_appointments where org_id = :org_id and property_id = :property_id and service = 'Deep Tissue Massage'"),
            {"org_id": str(org_id), "property_id": str(property_id)},
        )
        if spa_appt_exists is None:
            await session.execute(
                text(
                    """
                    insert into ops.spa_appointments (
                      id, org_id, property_id, guest_id, service, therapist_user_id,
                      starts_at, ends_at, status, created_at, updated_at
                    )
                    values (
                      gen_random_uuid(), :org_id, :property_id, :guest_id, 'Deep Tissue Massage', null,
                      :starts_at, :ends_at, 'booked', :now, :now
                    )
                    """
                ),
                {
                    "org_id": str(org_id),
                    "property_id": str(property_id),
                    "guest_id": str(guest_id),
                    "starts_at": tomorrow + timedelta(hours=2),
                    "ends_at": tomorrow + timedelta(hours=3),
                    "now": now,
                },
            )

        # Fitness classes + check-in.
        class_id = await session.scalar(
            text(
                """
                select id from ops.fitness_classes
                where org_id = :org_id and property_id = :property_id and name = 'Yoga Flow'
                limit 1
                """
            ),
            {"org_id": str(org_id), "property_id": str(property_id)},
        )
        if class_id is None:
            class_id = uuid.uuid4()
            await session.execute(
                text(
                    """
                    insert into ops.fitness_classes (
                      id, org_id, property_id, name, instructor_name, starts_at, ends_at,
                      capacity, booked, location, description, status, created_at, updated_at
                    )
                    values (
                      :class_id, :org_id, :property_id, 'Yoga Flow', 'Ava',
                      :starts_at, :ends_at, 20, 3, 'Studio A', 'Beginner friendly', 'scheduled', :now, :now
                    )
                    """
                ),
                {
                    "class_id": str(class_id),
                    "org_id": str(org_id),
                    "property_id": str(property_id),
                    "starts_at": tomorrow + timedelta(hours=4),
                    "ends_at": tomorrow + timedelta(hours=5),
                    "now": now,
                },
            )

        checkin_exists = await session.scalar(
            text(
                """
                select 1 from ops.fitness_checkins
                where org_id = :org_id and property_id = :property_id and guest_id = :guest_id and class_id = :class_id
                """
            ),
            {"org_id": str(org_id), "property_id": str(property_id), "guest_id": str(guest_id), "class_id": str(class_id)},
        )
        if checkin_exists is None:
            await session.execute(
                text(
                    """
                    insert into ops.fitness_checkins (
                      id, org_id, property_id, guest_id, class_id, checked_in_at, source, notes, created_at, updated_at
                    )
                    values (gen_random_uuid(), :org_id, :property_id, :guest_id, :class_id, :now, 'manual', 'Operations demo', :now, :now)
                    """
                ),
                {"org_id": str(org_id), "property_id": str(property_id), "guest_id": str(guest_id), "class_id": str(class_id), "now": now},
            )

        # Meetings rooms + booking.
        meeting_room_id = await session.scalar(
            text(
                """
                select id from ops.meeting_rooms
                where org_id = :org_id and property_id = :property_id and name = 'Ballroom A'
                limit 1
                """
            ),
            {"org_id": str(org_id), "property_id": str(property_id)},
        )
        if meeting_room_id is None:
            meeting_room_id = uuid.uuid4()
            await session.execute(
                text(
                    """
                    insert into ops.meeting_rooms (id, org_id, property_id, name, capacity, equipment, created_at, updated_at)
                    values (:room_id, :org_id, :property_id, 'Ballroom A', 120, array['projector','mic']::text[], :now, :now)
                    """
                ),
                {"room_id": str(meeting_room_id), "org_id": str(org_id), "property_id": str(property_id), "now": now},
            )

        booking_exists = await session.scalar(
            text(
                """
                select 1 from ops.meeting_bookings
                where org_id = :org_id and property_id = :property_id and title = 'Board meeting'
                """
            ),
            {"org_id": str(org_id), "property_id": str(property_id)},
        )
        if booking_exists is None:
            await session.execute(
                text(
                    """
                    insert into ops.meeting_bookings (
                      id, org_id, property_id, meeting_room_id, organizer_guest_id_or_user_id,
                      title, attendees_count, starts_at, ends_at, setup_status, created_at, updated_at
                    )
                    values (
                      gen_random_uuid(), :org_id, :property_id, :room_id, null,
                      'Board meeting', 10, :starts_at, :ends_at, 'setup', :now, :now
                    )
                    """
                ),
                {
                    "org_id": str(org_id),
                    "property_id": str(property_id),
                    "room_id": str(meeting_room_id),
                    "starts_at": tomorrow + timedelta(hours=6),
                    "ends_at": tomorrow + timedelta(hours=8),
                    "now": now,
                },
            )

        await session.commit()

    print("Operations demo seed complete")
    print(f"org_id={org_id}")
    print(f"property_id={property_id}")
    print(f"guest_id={guest_id}")
    print(f"room_id={room_id}")
    print(f"fitness_class_id={class_id}")
    print(f"meeting_room_id={meeting_room_id}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed operations demo data.")
    parser.add_argument("--org-id", required=True, type=uuid.UUID)
    parser.add_argument("--property-id", required=True, type=uuid.UUID)
    args = parser.parse_args()
    asyncio.run(seed(org_id=args.org_id, property_id=args.property_id))


if __name__ == "__main__":
    main()

