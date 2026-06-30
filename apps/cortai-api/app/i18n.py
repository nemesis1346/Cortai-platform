from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

_STRINGS: dict[str, dict[str, str]] = {
    "en": {
        # ── common ──────────────────────────────────────────────────────────
        "operations.common.no_fields_to_update": "No fields to update",
        "operations.common.property_not_found": "Property not found",
        "operations.common.room_not_found": "Room not found",
        "operations.common.guest_not_found": "Guest not found",
        # ── rooms ────────────────────────────────────────────────────────────
        "operations.rooms.status_cannot_be_null": "status cannot be null",
        "operations.rooms.status_invalid": "status can only be set to out_of_order or inspected",
        "operations.rooms.attendant_cannot_be_null": "attendant_user_id cannot be null",
        "operations.rooms.not_eligible_walk_in": "Room is not eligible for walk-in",
        # ── front desk ───────────────────────────────────────────────────────
        "operations.front_desk.reservation_not_found": "Reservation not found",
        "operations.front_desk.not_eligible_check_in": "Reservation is not eligible for check-in",
        "operations.front_desk.no_assigned_room": "Reservation has no assigned room",
        "operations.front_desk.not_eligible_check_out": "Reservation is not eligible for check-out",
        "operations.front_desk.not_eligible_queue": "Reservation is not eligible to join the queue",
        "operations.front_desk.queue_empty": "Queue is empty",
        # ── incidents ────────────────────────────────────────────────────────
        "operations.incidents.not_found": "Incident not found",
        "operations.incidents.assignee_not_found": "Assignee user not found",
        # ── action queue ─────────────────────────────────────────────────────
        "operations.action_queue.not_found": "Action queue item not found",
        "operations.action_queue.only_urgent": "Only urgent action queue items can be dispatched",
        # ── food & beverage ──────────────────────────────────────────────────
        "operations.fb.menu_item_not_found": "Menu item not found",
        "operations.fb.order_not_found": "Room service order not found",
        # ── fitness ──────────────────────────────────────────────────────────
        "operations.fitness.class_not_found": "Class not found",
        "operations.fitness.booked_exceeds_capacity": "booked cannot exceed capacity",
        # ── guest services ───────────────────────────────────────────────────
        "operations.guest_services.not_found": "Guest service request not found",
        # ── meetings ─────────────────────────────────────────────────────────
        "operations.meetings.room_not_found": "Meeting room not found",
        "operations.meetings.booking_not_found": "Booking not found",
        "operations.meetings.ends_before_starts": "ends_at must be after starts_at",
        # ── messaging ────────────────────────────────────────────────────────
        "operations.messaging.template_not_found": "Template not found",
        "operations.messaging.thread_not_found": "Thread not found",
        # ── shift handover ───────────────────────────────────────────────────
        "operations.shift_handover.not_found": "Shift handover not found",
        "operations.shift_handover.already_signed": "Shift handover is already signed and cannot be edited",
        # ── spa ──────────────────────────────────────────────────────────────
        "operations.spa.appointment_not_found": "Appointment not found",
        "operations.spa.therapist_not_found": "Therapist user not found",
    },
    "fr": {
        # ── common ──────────────────────────────────────────────────────────
        "operations.common.no_fields_to_update": "Aucun champ à mettre à jour",
        "operations.common.property_not_found": "Propriété introuvable",
        "operations.common.room_not_found": "Chambre introuvable",
        "operations.common.guest_not_found": "Client introuvable",
        # ── rooms ────────────────────────────────────────────────────────────
        "operations.rooms.status_cannot_be_null": "Le statut ne peut pas être nul",
        "operations.rooms.status_invalid": "Le statut ne peut être défini qu'à out_of_order ou inspected",
        "operations.rooms.attendant_cannot_be_null": "attendant_user_id ne peut pas être nul",
        "operations.rooms.not_eligible_walk_in": "La chambre n'est pas disponible pour une arrivée sans réservation",
        # ── front desk ───────────────────────────────────────────────────────
        "operations.front_desk.reservation_not_found": "Réservation introuvable",
        "operations.front_desk.not_eligible_check_in": "La réservation n'est pas éligible à l'enregistrement",
        "operations.front_desk.no_assigned_room": "La réservation n'a pas de chambre assignée",
        "operations.front_desk.not_eligible_check_out": "La réservation n'est pas éligible au départ",
        "operations.front_desk.not_eligible_queue": "La réservation n'est pas éligible pour rejoindre la file d'attente",
        "operations.front_desk.queue_empty": "La file d'attente est vide",
        # ── incidents ────────────────────────────────────────────────────────
        "operations.incidents.not_found": "Incident introuvable",
        "operations.incidents.assignee_not_found": "Utilisateur assigné introuvable",
        # ── action queue ─────────────────────────────────────────────────────
        "operations.action_queue.not_found": "Élément de file d'attente introuvable",
        "operations.action_queue.only_urgent": "Seuls les éléments urgents de la file d'attente peuvent être distribués",
        # ── food & beverage ──────────────────────────────────────────────────
        "operations.fb.menu_item_not_found": "Article du menu introuvable",
        "operations.fb.order_not_found": "Commande de service en chambre introuvable",
        # ── fitness ──────────────────────────────────────────────────────────
        "operations.fitness.class_not_found": "Cours introuvable",
        "operations.fitness.booked_exceeds_capacity": "Les réservations ne peuvent pas dépasser la capacité",
        # ── guest services ───────────────────────────────────────────────────
        "operations.guest_services.not_found": "Demande de service client introuvable",
        # ── meetings ─────────────────────────────────────────────────────────
        "operations.meetings.room_not_found": "Salle de réunion introuvable",
        "operations.meetings.booking_not_found": "Réservation de salle introuvable",
        "operations.meetings.ends_before_starts": "ends_at doit être postérieur à starts_at",
        # ── messaging ────────────────────────────────────────────────────────
        "operations.messaging.template_not_found": "Modèle introuvable",
        "operations.messaging.thread_not_found": "Fil de discussion introuvable",
        # ── shift handover ───────────────────────────────────────────────────
        "operations.shift_handover.not_found": "Passation de service introuvable",
        "operations.shift_handover.already_signed": "La passation de service est déjà signée et ne peut pas être modifiée",
        # ── spa ──────────────────────────────────────────────────────────────
        "operations.spa.appointment_not_found": "Rendez-vous introuvable",
        "operations.spa.therapist_not_found": "Thérapeute introuvable",
    },
}


def locale_from_request(request: Request) -> str:
    accept = request.headers.get("accept-language", "")
    return "fr" if accept.lower().startswith("fr") else "en"


LocaleDep = Annotated[str, Depends(locale_from_request)]


def t(code: str, locale: str) -> str:
    msg = _STRINGS.get(locale, {}).get(code)
    if msg is None:
        msg = _STRINGS["en"].get(code, code)
    return msg


def http_err(code: str, locale: str) -> dict[str, str]:
    return {"code": code, "message": t(code, locale)}