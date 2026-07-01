import { test, expect, type Page } from "@playwright/test";

const appUrl = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${process.env.PORT || 3100}`;
const cookieDomain = new URL(appUrl).hostname;
const propertyId = "80b6c65b-554b-4ab0-aba0-f42bcd7ee610";

const AUTH_USER = {
  id: "00000000-0000-0000-0000-000000000001",
  org_id: "00000000-0000-0000-0000-000000000010",
  email: "admin@hotel-a.test",
  full_name: "Admin",
  role: "IT_ADMIN",
  status: "ACTIVE",
} as const;

async function mockShell(page: Page) {
  await page.context().addCookies([
    {
      name: "cortai_access_token",
      value: "test-token",
      domain: cookieDomain,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
    {
      name: "cortai_property_id",
      value: propertyId,
      domain: cookieDomain,
      path: "/",
      sameSite: "Lax",
    },
  ]);

  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(AUTH_USER) })
  );
  await page.route("**/api/properties", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{ id: propertyId, name: "Hotel A", slug: "hotel-a" }]),
    })
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

type GuestServiceType = "towels" | "pillows" | "amenities" | "late_checkout" | "wake_up" | "other";

type GuestServiceItem = {
  id: string;
  org_id: string;
  property_id: string;
  room_id: string | null;
  guest_id: string | null;
  action_queue_item_id: string | null;
  type: GuestServiceType;
  status: "pending" | "assigned" | "completed" | "cancelled";
  note: string | null;
  assigned_to_user_id: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type ShiftHandover = {
  id: string;
  org_id: string;
  property_id: string;
  shift_date: string;
  shift_label: "morning" | "afternoon" | "night";
  summary_md: string | null;
  checklist_json: Record<string, unknown>;
  signed_by_user_id: string | null;
  signed_at: string | null;
  carry_forward_from_id: string | null;
  created_at: string;
  updated_at: string;
};

// ── Test: create guest service request ────────────────────────────────────────

test("create guest service request", async ({ page }) => {
  await mockShell(page);

  const items: GuestServiceItem[] = [];
  const createdId = "00000000-0000-0000-0000-000000000201";

  await page.route("**/api/operations/guest-services**", async (route) => {
    const method = route.request().method();
    if (method === "POST") {
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      const created: GuestServiceItem = {
        id: createdId,
        org_id: AUTH_USER.org_id,
        property_id: propertyId,
        room_id: (payload.room_id as string | null) ?? null,
        guest_id: null,
        action_queue_item_id: null,
        type: (payload.type as GuestServiceType) ?? "towels",
        status: "pending",
        note: (payload.note as string | null) ?? null,
        assigned_to_user_id: null,
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      items.push(created);
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(created) });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items }),
    });
  });

  await page.goto("/en/dashboard/operations/guest-services");
  await expect(page.getByTestId("guest-services-page")).toBeVisible();

  // Open the create modal
  await page.getByTestId("guest-services-new").click();
  await expect(page.getByTestId("guest-services-modal")).toBeVisible();

  // Fill the form (type defaults to "towels"; note is optional)
  await page.getByTestId("modal-type-select").selectOption("towels");
  await page.locator('input[name="note"]').fill("Extra towels please");

  // Submit
  await page.getByTestId("modal-submit").click();

  // The created row must appear in the queue
  await expect(page.getByTestId(`request-row-${createdId}`)).toBeVisible();
});

// ── Test: sign off shift handover ─────────────────────────────────────────────

test("sign off shift handover", async ({ page }) => {
  await mockShell(page);

  const now = new Date().toISOString();
  const handoverId = "00000000-0000-0000-0000-000000000301";

  const handover: ShiftHandover = {
    id: handoverId,
    org_id: AUTH_USER.org_id,
    property_id: propertyId,
    shift_date: "2026-07-01",
    shift_label: "morning",
    summary_md: "All clear.",
    checklist_json: { open_items: [] },
    signed_by_user_id: null,
    signed_at: null,
    carry_forward_from_id: null,
    created_at: now,
    updated_at: now,
  };

  // The next handover that comes back after sign-off. Setting signed_at non-null
  // makes the sign-off button show "✓ Shift Signed Off" in the UI.
  const nextHandover: ShiftHandover = {
    id: "00000000-0000-0000-0000-000000000302",
    org_id: AUTH_USER.org_id,
    property_id: propertyId,
    shift_date: "2026-07-01",
    shift_label: "afternoon",
    summary_md: "",
    checklist_json: { open_items: [] },
    signed_by_user_id: AUTH_USER.id,
    signed_at: now,
    carry_forward_from_id: handoverId,
    created_at: now,
    updated_at: now,
  };

  await page.route("**/api/operations/shift-handover**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes("/current")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          property_id: propertyId,
          shift_date: "2026-07-01",
          shift_label: "morning",
          handover,
        }),
      });
      return;
    }
    if (method === "POST") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ signed: { ...handover, signed_at: now }, next: nextHandover }),
      });
      return;
    }
    // PATCH /shift-handover/{id} (save draft)
    if (method === "PATCH") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ...handover, updated_at: new Date().toISOString() }),
      });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify([]) });
  });

  await page.route("**/api/operations/kpis**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        occupancy_pct: 72,
        occupancy_rooms: { used: 72, total: 100 },
        guests_in_hotel: 110,
        guests_total_capacity: 150,
        staff_on_site: 12,
        staff_on_duty: 10,
        arrivals_today: { count: 5, arrived: 3 },
        departures_today: { count: 8, departed: 6 },
        rooms_ready: 90,
        rooms_cleaning: 5,
      }),
    })
  );

  await page.route("**/api/operations/incidents**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 100 }),
    })
  );

  await page.route("**/api/operations/guest-services**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [] }) })
  );

  await page.goto("/en/dashboard/operations/shift-handover");

  // Page loads and the sign-off panel is visible
  await expect(page.getByTestId("signoff-panel")).toBeVisible();

  const signOffBtn = page.getByTestId("shift-sign-off-2");
  await expect(signOffBtn).toBeVisible();
  await expect(signOffBtn).toContainText("Acknowledge & Sign Off");

  // Click sign-off; the mock returns a nextHandover with signed_at set,
  // so the component renders the "signed" state
  await signOffBtn.click();

  await expect(signOffBtn).toContainText("Shift Signed Off");
  await expect(signOffBtn).toBeDisabled();
});

// ── Test: set HVAC target temperature ─────────────────────────────────────────

test("set hvac target temp", async ({ page }) => {
  await mockShell(page);

  const roomId = "room-101-aaaa-bbbb-cccc-ddddeeeeffff";

  await page.route("**/api/operations/hvac/rooms**", async (route) => {
    if (route.request().url().includes("/control")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ command_id: "cmd-001", expected_ack_within_s: 10 }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          room_id: roomId,
          current_temp_c: 22.5,
          target_temp_c: 21.0,
          mode: "cooling",
          fan_speed: "auto",
          fault_code: null,
          last_updated: new Date().toISOString(),
        },
      ]),
    });
  });

  await page.route("**/api/operations/hvac/alerts**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify([]) })
  );

  await page.goto("/en/dashboard/operations/hvac");
  await expect(page.getByTestId("hvac-page")).toBeVisible();

  // Click the first room card to open the control modal
  await page.getByTestId("hvac-room-card").first().click();
  await expect(page.getByTestId("hvac-control-modal")).toBeVisible();

  // Change the target temperature
  await page.getByTestId("hvac-target-temp").fill("20.5");

  // Send the command
  await page.getByTestId("hvac-control-send").click();

  // Modal should close after a successful command
  await expect(page.getByTestId("hvac-control-modal")).not.toBeVisible();
});

// ── Test: send guest message ───────────────────────────────────────────────────

test("send guest message", async ({ page }) => {
  await mockShell(page);

  const threadId = "00000000-0000-0000-0000-000000000401";
  const thread = {
    id: threadId,
    org_id: AUTH_USER.org_id,
    property_id: propertyId,
    thread_id: "thread-ext-001",
    guest_id: "guest-001",
    guest_first_name: "Jane",
    guest_last_name: "Smith",
    channel: "in_app",
    status: "open",
    assigned_to_user_id: null,
    unread_count: 1,
    last_message_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const sentMessageId = "msg-00000000-0000-0000-0000-000000000501";

  await page.route("**/api/operations/messaging/threads**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes("/messages")) {
      if (method === "POST") {
        const payload = route.request().postDataJSON() as { body: string; language: string };
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            message: {
              id: sentMessageId,
              org_id: AUTH_USER.org_id,
              thread_id: thread.thread_id,
              channel: "in_app",
              direction: "out",
              guest_id: thread.guest_id,
              body: payload.body,
              status: "sent",
              sent_at: new Date().toISOString(),
              language: payload.language,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          }),
        });
        return;
      }
      // GET messages
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ items: [] }),
      });
      return;
    }

    // GET thread list
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items: [thread] }),
    });
  });

  await page.route("**/api/operations/messaging/templates**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [] }) })
  );

  await page.goto("/en/dashboard/operations/guest-messaging");
  await expect(page.getByTestId("guest-messaging-page")).toBeVisible();

  // Select the thread from the sidebar
  await page.getByTestId(`guest-messaging-thread-${threadId}`).click();
  await expect(page.getByTestId("guest-messaging-open-thread")).toBeVisible();

  // Compose a message
  await page.getByTestId("guest-messaging-composer-body").fill("Your room is ready! Welcome to Hotel A.");

  // Send
  await page.getByTestId("guest-messaging-send").click();

  // The sent message bubble must appear in the conversation
  await expect(page.getByTestId(`guest-messaging-message-${sentMessageId}`)).toBeVisible();
});