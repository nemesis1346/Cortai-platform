import { test, expect } from "@playwright/test";

test("login and create user happy path", async ({ page }) => {
  // The dashboard is protected by middleware that requires `cortai_access_token` cookie.
  await page.context().addCookies([
    {
      name: "cortai_access_token",
      value: "test-token",
      url: "http://localhost:3000",
      path: "/",
      httpOnly: true,
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
      body: JSON.stringify([
        { id: "80b6c65b-554b-4ab0-aba0-f42bcd7ee610", name: "Hotel A", slug: "hotel-a" }
      ])
    });
  });

  await page.context().addCookies([
    {
      name: "cortai_property_id",
      value: "80b6c65b-554b-4ab0-aba0-f42bcd7ee610",
      url: "http://localhost:3000",
      path: "/",
      sameSite: "Lax"
    }
  ]);
  await page.route("**/api/admin/users**", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: "00000000-0000-0000-0000-000000000002",
          org_id: "00000000-0000-0000-0000-000000000010",
          email: "new.user@hotel-a.test",
          full_name: "New User",
          role: "HOTEL_ADMIN",
          status: "ACTIVE",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 20 })
    });
  });

  await page.goto("/en/login");
  await page.getByTestId("login-org").fill("hotel-a");
  await page.getByTestId("login-email").fill("admin@hotel-a.test");
  await page.getByTestId("login-password").fill("password");
  await page.getByTestId("login-submit").click();

  await expect(page.getByTestId("users-page")).toBeVisible();
  await page.getByTestId("users-create-open").click();
  await page.getByTestId("user-form-email").fill("new.user@hotel-a.test");
  await page.getByTestId("user-form-full-name").fill("New User");
  await page.getByTestId("user-form-password").fill("temporary-password");
  await page.getByTestId("user-form-submit").click();
});
