"""seed three production-ready form definitions

Revision ID: 20260702_0028
Revises: 20260702_0027
Create Date: 2026-07-02
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op

revision: str = "20260702_0028"
down_revision: str = "20260702_0027"
branch_labels = None
depends_on = None

# ── Form definitions ───────────────────────────────────────────────────────────

_FORMS: list[dict] = [
    {
        "slug": "pre-arrival-check",
        "title_en": "Pre-Arrival Check",
        "title_fr": "Vérification Pré-Arrivée",
        "schema_json": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "title": "Pre-Arrival Check",
            "required": ["arrival_date", "room_number", "guest_count"],
            "properties": {
                "arrival_date": {
                    "type": "string",
                    "format": "date",
                    "title": "Arrival Date",
                },
                "departure_date": {
                    "type": "string",
                    "format": "date",
                    "title": "Departure Date",
                },
                "room_number": {
                    "type": "string",
                    "title": "Room Number",
                    "minLength": 1,
                    "maxLength": 10,
                },
                "guest_count": {
                    "type": "integer",
                    "title": "Number of Guests",
                    "minimum": 1,
                    "maximum": 20,
                },
                "special_requests": {
                    "type": "string",
                    "title": "Special Requests",
                    "maxLength": 1000,
                    "description": "Dietary requirements, accessibility needs, preferences…",
                },
                "early_checkin": {
                    "type": "boolean",
                    "title": "Early Check-in Requested",
                },
                "late_checkout": {
                    "type": "boolean",
                    "title": "Late Check-out Requested",
                },
            },
        },
        "ui_hints_json": {
            "order": [
                "arrival_date",
                "departure_date",
                "room_number",
                "guest_count",
                "early_checkin",
                "late_checkout",
                "special_requests",
            ],
            "labels": {
                "arrival_date": "Arrival Date",
                "departure_date": "Departure Date",
                "room_number": "Room Number",
                "guest_count": "Number of Guests",
                "special_requests": "Special Requests",
                "early_checkin": "Early Check-in",
                "late_checkout": "Late Check-out",
            },
            "labels_fr": {
                "arrival_date": "Date d'arrivée",
                "departure_date": "Date de départ",
                "room_number": "Numéro de chambre",
                "guest_count": "Nombre d'invités",
                "special_requests": "Demandes spéciales",
                "early_checkin": "Enregistrement anticipé",
                "late_checkout": "Départ tardif",
            },
            "placeholders": {
                "room_number": "e.g. 204",
                "special_requests": "Any special requirements…",
            },
        },
    },
    {
        "slug": "maintenance-request",
        "title_en": "Maintenance Request",
        "title_fr": "Demande de Maintenance",
        "schema_json": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "title": "Maintenance Request",
            "required": ["location", "category", "description", "priority"],
            "properties": {
                "location": {
                    "type": "string",
                    "title": "Location",
                    "minLength": 1,
                    "maxLength": 100,
                    "description": "Room, floor, or area",
                },
                "category": {
                    "type": "string",
                    "title": "Category",
                    "enum": [
                        "plumbing",
                        "electrical",
                        "hvac",
                        "furniture",
                        "it_network",
                        "other",
                    ],
                },
                "priority": {
                    "type": "string",
                    "title": "Priority",
                    "enum": ["low", "medium", "high", "urgent"],
                },
                "description": {
                    "type": "string",
                    "title": "Description",
                    "minLength": 10,
                    "maxLength": 2000,
                    "description": "Describe the issue in detail",
                },
                "reported_by": {
                    "type": "string",
                    "title": "Reported By",
                    "maxLength": 100,
                },
                "guest_present": {
                    "type": "boolean",
                    "title": "Guest Currently in Room",
                },
                "photos_attached": {
                    "type": "boolean",
                    "title": "Photos Attached Separately",
                },
            },
        },
        "ui_hints_json": {
            "order": [
                "location",
                "category",
                "priority",
                "description",
                "guest_present",
                "reported_by",
                "photos_attached",
            ],
            "labels": {
                "location": "Location",
                "category": "Category",
                "priority": "Priority",
                "description": "Issue Description",
                "reported_by": "Reported By",
                "guest_present": "Guest Currently in Room",
                "photos_attached": "Photos Attached Separately",
            },
            "labels_fr": {
                "location": "Emplacement",
                "category": "Catégorie",
                "priority": "Priorité",
                "description": "Description du problème",
                "reported_by": "Signalé par",
                "guest_present": "Client actuellement dans la chambre",
                "photos_attached": "Photos jointes séparément",
            },
            "placeholders": {
                "location": "e.g. Room 312, 3rd floor corridor",
                "description": "Describe the issue…",
                "reported_by": "Staff name",
            },
        },
    },
    {
        "slug": "guest-complaint",
        "title_en": "Guest Complaint",
        "title_fr": "Réclamation Client",
        "schema_json": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "title": "Guest Complaint",
            "required": ["guest_name", "complaint_type", "description"],
            "properties": {
                "guest_name": {
                    "type": "string",
                    "title": "Guest Name",
                    "minLength": 1,
                    "maxLength": 120,
                },
                "room_number": {
                    "type": "string",
                    "title": "Room Number",
                    "maxLength": 10,
                },
                "complaint_type": {
                    "type": "string",
                    "title": "Complaint Type",
                    "enum": [
                        "noise",
                        "cleanliness",
                        "staff_behaviour",
                        "amenities",
                        "billing",
                        "food_beverage",
                        "other",
                    ],
                },
                "description": {
                    "type": "string",
                    "title": "Description",
                    "minLength": 10,
                    "maxLength": 3000,
                    "description": "Full account of the complaint",
                },
                "occurred_at": {
                    "type": "string",
                    "format": "date-time",
                    "title": "When Did It Occur",
                },
                "compensation_requested": {
                    "type": "boolean",
                    "title": "Guest Requesting Compensation",
                },
                "severity": {
                    "type": "string",
                    "title": "Severity",
                    "enum": ["minor", "moderate", "serious", "critical"],
                },
                "follow_up_required": {
                    "type": "boolean",
                    "title": "Follow-up Required",
                },
            },
        },
        "ui_hints_json": {
            "order": [
                "guest_name",
                "room_number",
                "complaint_type",
                "severity",
                "occurred_at",
                "description",
                "compensation_requested",
                "follow_up_required",
            ],
            "labels": {
                "guest_name": "Guest Name",
                "room_number": "Room Number",
                "complaint_type": "Complaint Type",
                "description": "Complaint Description",
                "occurred_at": "Date & Time of Incident",
                "compensation_requested": "Compensation Requested",
                "severity": "Severity",
                "follow_up_required": "Follow-up Required",
            },
            "labels_fr": {
                "guest_name": "Nom du client",
                "room_number": "Numéro de chambre",
                "complaint_type": "Type de réclamation",
                "description": "Description de la réclamation",
                "occurred_at": "Date et heure de l'incident",
                "compensation_requested": "Compensation demandée",
                "severity": "Gravité",
                "follow_up_required": "Suivi requis",
            },
            "placeholders": {
                "guest_name": "Full name as on reservation",
                "room_number": "e.g. 512",
                "description": "Describe the complaint in full…",
            },
        },
    },
]


def upgrade() -> None:
    conn = op.get_bind()
    # Seed all three forms for every existing organisation, skip if already seeded
    for form in _FORMS:
        conn.execute(
            sa.text(
                """
                INSERT INTO platform.form_definitions
                    (org_id, slug, title_en, title_fr, schema_json, ui_hints_json,
                     version, status, published_at)
                SELECT
                    id,
                    :slug,
                    :title_en,
                    :title_fr,
                    CAST(:schema_json AS jsonb),
                    CAST(:ui_hints_json AS jsonb),
                    1,
                    'published',
                    now()
                FROM organizations
                ON CONFLICT (org_id, slug, version) DO NOTHING
                """
            ),
            {
                "slug": form["slug"],
                "title_en": form["title_en"],
                "title_fr": form["title_fr"],
                "schema_json": json.dumps(form["schema_json"]),
                "ui_hints_json": json.dumps(form["ui_hints_json"]),
            },
        )


def downgrade() -> None:
    conn = op.get_bind()
    slugs = [f["slug"] for f in _FORMS]
    conn.execute(
        sa.text(
            "DELETE FROM platform.form_definitions WHERE slug = ANY(:slugs) AND version = 1"
        ),
        {"slugs": slugs},
    )