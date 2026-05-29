import { test, expect, type Page } from "@playwright/test";

const appUrl = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${process.env.PORT || 3100}`;
const cookieDomain = new URL(appUrl).hostname;
const propertyId = "80b6c65b-554b-4ab0-aba0-f42bcd7ee610";

type UserRow = {
  id: string;
  org_id: string;
  email: string;
  full_name: string;
  role: "IT_ADMIN" | "SERVICE_PROVIDER_ADMIN" | "HOTEL_ADMIN" | "STAFF";
  status: "ACTIVE" | "INVITED" | "DISABLED";
  created_at: string;
  updated_at: string;
};

type IncidentRow = {
  id: string;
  org_id: string;
  property_id: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  title: string;
  description: string | null;
  assigned_to: string | null;
  created_at: string;
  resolved_at: string | null;
};

async function mockShell(page: Page) {
  await page.context().addCookies([
    {
      name: "cortai_access_token",
      value: "test-token",
      domain: cookieDomain,
      path: "/",
      httpOnly: true,
      sameSite: "Lax"
    },
    {
      name: "cortai_property_id",
      value: propertyId,
      domain: cookieDomain,
      path: "/",
      sameSite: "Lax"
    }
  ]);

  await page.route("**/api/auth/login", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      headers: {
        "set-cookie": "cortai_access_token=test-token; Path=/; SameSite=Lax"
      },
      body: JSON.stringify({
        access_token: "test-token",
        token_type: "bearer",
        expires_at: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
        user: {
          id: "00000000-0000-0000-0000-000000000001",
          org_id: "00000000-0000-0000-0000-000000000010",
          email: "admin@hotel-a.test",
          full_name: "Admin",
          role: "IT_ADMIN",
          status: "ACTIVE"
        }
      })
    });
  });

  // AuthProvider loads the current user on mount.
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "00000000-0000-0000-0000-000000000001",
        org_id: "00000000-0000-0000-0000-000000000010",
        email: "admin@hotel-a.test",
        full_name: "Admin",
        role: "IT_ADMIN",
        status: "ACTIVE"
      })
    });
  });

  await page.route("**/api/properties", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{ id: propertyId, name: "Hotel A", slug: "hotel-a" }])
    });
  });
}

test("create user happy path", async ({ page }) => {
  await mockShell(page);
  const users: UserRow[] = [];
  await page.route("**/api/admin/users**", async (route) => {
    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON() as Pick<UserRow, "email" | "full_name" | "role" | "status">;
      const created: UserRow = {
        id: "00000000-0000-0000-0000-000000000002",
        org_id: "00000000-0000-0000-0000-000000000010",
        email: payload.email,
        full_name: payload.full_name,
        role: payload.role,
        status: payload.status,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      users.push(created);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(created)
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items: users, total: users.length, page: 1, page_size: 20 })
    });
  });

  await page.goto("/en/dashboard/admin/users");
  await expect(page.getByTestId("users-page")).toBeVisible();
  await page.getByTestId("users-create-open").click();
  await page.getByTestId("user-form-email").fill("new.user@hotel-a.test");
  await page.getByTestId("user-form-full-name").fill("New User");
  await page.getByTestId("user-form-password").fill("temporary-password");
  await page.getByTestId("user-form-submit").click();

  await expect(page.getByRole("cell", { name: "New User" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "new.user@hotel-a.test" })).toBeVisible();
});

test("create incident happy path", async ({ page }) => {
  await mockShell(page);
  const incidents: IncidentRow[] = [];

  await page.route("**/api/operations/incidents**", async (route) => {
    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON() as Pick<
        IncidentRow,
        "property_id" | "severity" | "status" | "title" | "description" | "assigned_to"
      >;
      const created: IncidentRow = {
        id: "00000000-0000-0000-0000-000000000101",
        org_id: "00000000-0000-0000-0000-000000000010",
        property_id: payload.property_id,
        severity: payload.severity,
        status: payload.status,
        title: payload.title,
        description: payload.description,
        assigned_to: payload.assigned_to,
        created_at: new Date().toISOString(),
        resolved_at: null
      };
      incidents.push(created);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(created)
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items: incidents, total: incidents.length, page: 1, page_size: 20 })
    });
  });

  await page.goto("/en/dashboard/security/incidents");
  await expect(page.getByTestId("incidents-page")).toBeVisible();
  await page.getByTestId("incidents-new").click();
  await page.getByTestId("incident-form-title").fill("Water leak in room 1204");
  await page.getByTestId("incident-form-submit").click();

  await expect(page.getByRole("cell", { name: "Water leak in room 1204" })).toBeVisible();
  await expect(page.getByTestId("incidents-toast-created")).toBeVisible();
});
