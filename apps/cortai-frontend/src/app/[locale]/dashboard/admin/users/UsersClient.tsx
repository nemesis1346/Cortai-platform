"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Table, Td } from "@/components/ui/Table";
import { apiFetch, type AdminUser, type UserRole, type UserStatus } from "@/lib/api";

type UserForm = {
  email: string;
  full_name: string;
  role: UserRole;
  status: UserStatus;
  password?: string;
};

type UserList = {
  items: AdminUser[];
  total: number;
  page: number;
  page_size: number;
};

export function UsersClient() {
  const t = useTranslations("users");
  const userSchema = z.object({
    email: z.string().email(),
    full_name: z.string().min(2),
    role: z.enum(["IT_ADMIN", "SERVICE_PROVIDER_ADMIN", "HOTEL_ADMIN", "STAFF"]),
    status: z.enum(["ACTIVE", "INVITED", "DISABLED"]),
    password: z.string().optional()
  }).refine((value) => !value.password || value.password.length >= 10, {
    path: ["password"],
    message: t("passwordMinLength")
  });
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "">("");
  const [open, setOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(false);
  const form = useForm<UserForm>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      role: "HOTEL_ADMIN",
      status: "INVITED",
      password: ""
    }
  });

  const loadUsers = useCallback(async (query: string, role: UserRole | "") => {
    const params = new URLSearchParams({ page: "1", page_size: "20" });
    if (query) params.set("search", query);
    if (role) params.set("role", role);
    const response = await apiFetch<UserList>(`/api/admin/users?${params.toString()}`);
    setUsers(response.items);
  }, []);

  useEffect(() => {
    void loadUsers("", "");
  }, [loadUsers]);

  function applyFilters(query: string, role: UserRole | "") {
    setSearch(query);
    setRoleFilter(role);
    void loadUsers(query, role);
  }

  function openCreateModal() {
    setEditingUser(null);
    form.reset({ role: "HOTEL_ADMIN", status: "INVITED", password: "" });
    setOpen(true);
  }

  function openEditModal(user: AdminUser) {
    setEditingUser(user);
    form.reset({
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      status: user.status,
      password: ""
    });
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
    setEditingUser(null);
    form.reset({ role: "HOTEL_ADMIN", status: "INVITED", password: "" });
  }

  async function submitUser(values: UserForm) {
    if (!editingUser && !values.password) {
      form.setError("password", { message: t("passwordRequired") });
      return;
    }

    setLoading(true);
    try {
      if (editingUser) {
        const { password, ...rest } = values;
        await apiFetch<AdminUser>(`/api/admin/users/${editingUser.id}`, {
          method: "PATCH",
          body: JSON.stringify(password ? { ...rest, password } : rest)
        });
      } else {
        await apiFetch<AdminUser>("/api/admin/users", {
          method: "POST",
          body: JSON.stringify(values)
        });
      }
      closeModal();
      await loadUsers(search, roleFilter);
    } finally {
      setLoading(false);
    }
  }

  async function deleteUser(userId: string) {
    await apiFetch<void>(`/api/admin/users/${userId}`, { method: "DELETE" });
    await loadUsers(search, roleFilter);
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <p className="text-xs text-cortai-text2">{t("subtitle")}</p>
        </div>
        <Button className="ml-auto" onClick={openCreateModal}>
          {t("create")}
        </Button>
      </div>

      <Card
        title={t("directory")}
        action={
          <form
            action={(formData) => {
              const value = String(formData.get("search") ?? "");
              const role = String(formData.get("role") ?? "") as UserRole | "";
              applyFilters(value, role);
            }}
            className="flex gap-2"
          >
            <input
              name="search"
              defaultValue={search}
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-1.5 text-xs outline-none focus:border-cortai-teal"
              placeholder={t("search")}
            />
            <select
              name="role"
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-1.5 text-xs outline-none focus:border-cortai-teal"
              value={roleFilter}
              aria-label={t("roleFilter")}
              onChange={(event) => {
                applyFilters(search, event.target.value as UserRole | "");
              }}
            >
              <option value="">{t("allRoles")}</option>
              {(["IT_ADMIN", "SERVICE_PROVIDER_ADMIN", "HOTEL_ADMIN", "STAFF"] satisfies UserRole[]).map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
            <Button type="submit" variant="ghost">
              {t("filter")}
            </Button>
          </form>
        }
      >
        <Table headers={[t("name"), t("email"), t("role"), t("status"), t("actions")]}>
          {users.map((user) => (
            <tr key={user.id} className="hover:bg-white/[0.02]">
              <Td>{user.full_name}</Td>
              <Td>{user.email}</Td>
              <Td>
                <Badge>{user.role}</Badge>
              </Td>
              <Td>
                <Badge tone={statusTone(user.status)}>{user.status}</Badge>
              </Td>
              <Td>
                <div className="flex gap-2">
                  <Button variant="ghost" type="button" onClick={() => openEditModal(user)}>
                    {t("edit")}
                  </Button>
                  <Button variant="danger" type="button" onClick={() => void deleteUser(user.id)}>
                    {t("delete")}
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Modal
        open={open}
        title={editingUser ? t("editUser") : t("createUser")}
        closeLabel={t("close")}
        onClose={closeModal}
      >
        <form onSubmit={form.handleSubmit(submitUser)} className="grid gap-3">
          <Input label={t("email")} {...form.register("email")} error={form.formState.errors.email?.message} />
          <Input
            label={t("fullName")}
            {...form.register("full_name")}
            error={form.formState.errors.full_name?.message}
          />
          <label className="grid gap-1.5 text-xs text-cortai-text2">
            <span>{t("role")}</span>
            <select className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-cortai-text" {...form.register("role")}>
              {(["IT_ADMIN", "SERVICE_PROVIDER_ADMIN", "HOTEL_ADMIN", "STAFF"] satisfies UserRole[]).map((role) => (
                <option key={role}>{role}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs text-cortai-text2">
            <span>{t("status")}</span>
            <select className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-cortai-text" {...form.register("status")}>
              {(["ACTIVE", "INVITED", "DISABLED"] satisfies UserStatus[]).map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </label>
          <Input
            type="password"
            label={editingUser ? t("passwordOptional") : t("password")}
            {...form.register("password")}
            error={form.formState.errors.password?.message}
          />
          <Button type="submit" disabled={loading}>
            {loading ? t("saving") : editingUser ? t("update") : t("save")}
          </Button>
        </form>
      </Modal>
    </div>
  );
}

function Badge({ children, tone = "teal" }: { children: React.ReactNode; tone?: "teal" | "green" | "amber" | "red" }) {
  const styles = {
    teal: "border-cortai-teal/25 bg-cortai-teal/10 text-cortai-teal",
    green: "border-cortai-green/25 bg-cortai-green/10 text-cortai-green",
    amber: "border-cortai-amber/25 bg-cortai-amber/10 text-cortai-amber",
    red: "border-cortai-red/25 bg-cortai-red/10 text-cortai-red"
  };
  return <span className={`rounded-pill border px-2 py-0.5 text-[10px] font-semibold ${styles[tone]}`}>{children}</span>;
}

function statusTone(status: UserStatus) {
  if (status === "ACTIVE") return "green";
  if (status === "DISABLED") return "red";
  return "amber";
}
