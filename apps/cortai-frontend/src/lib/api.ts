export type UserRole = "IT_ADMIN" | "SERVICE_PROVIDER_ADMIN" | "HOTEL_ADMIN" | "STAFF";
export type UserStatus = "ACTIVE" | "INVITED" | "DISABLED";

export type AuthUser = {
  id: string;
  org_id: string;
  email: string;
  full_name: string;
  role: UserRole;
  status: UserStatus;
};

export type AdminUser = AuthUser & {
  created_at: string;
  updated_at: string;
};

// In production/staging we want same-origin by default (Caddy routes `api.*` separately).
// When NEXT_PUBLIC_API_BASE_URL is unset, fall back to a relative URL to avoid accidentally
// calling the user's own localhost from the browser.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
