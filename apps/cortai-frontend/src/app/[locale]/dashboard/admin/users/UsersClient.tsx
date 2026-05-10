"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Table, Td } from "@/components/ui/Table";
import { apiFetch, type AdminUser, type UserRole, type UserStatus } from "@/lib/api";

const userSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(2),
  role: z.enum(["IT_ADMIN", "SERVICE_PROVIDER_ADMIN", "HOTEL_ADMIN", "STAFF"]),
  status: z.enum(["ACTIVE", "INVITED", "DISABLED"]),
  password: z.string().min(10)
});

type UserForm = z.infer<typeof userSchema>;

type UserList = {
  items: AdminUser[];
  total: number;
  page: number;
  page_size: number;
};

export function UsersClient() {
  const t = useTranslations("users");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const form = useForm<UserForm>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      role: "HOTEL_ADMIN",
      status: "INVITED"
    }
  });

  async function loadUsers(query = search) {
    const params = new URLSearchParams({ page: "1", page_size: "20" });
    if (query) params.set("search", query);
    const response = await apiFetch<UserList>(`/api/admin/users?${params.toString()}`);
    setUsers(response.items);
  }

  useEffect(() => {
    void loadUsers("");
  }, []);

  async function createUser(values: UserForm) {
    setLoading(true);
    try {
      await apiFetch<AdminUser>("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(values)
      });
      setOpen(false);
      form.reset({ role: "HOTEL_ADMIN", status: "INVITED" });
      await loadUsers();
    } finally {
      setLoading(false);
    }
  }

  async function deleteUser(userId: string) {
    await apiFetch<void>(`/api/admin/users/${userId}`, { method: "DELETE" });
    await loadUsers();
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <p className="text-xs text-cortai-text2">{t("subtitle")}</p>
        </div>
        <Button className="ml-auto" onClick={() => setOpen(true)}>
          {t("create")}
        </Button>
      </div>

      <Card
        title={t("directory")}
        action={
          <form
            action={(formData) => {
              const value = String(formData.get("search") ?? "");
              setSearch(value);
              void loadUsers(value);
            }}
            className="flex gap-2"
          >
            <input
              name="search"
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-1.5 text-xs outline-none focus:border-cortai-teal"
              placeholder={t("search")}
            />
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
                  <Button variant="ghost" type="button">
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

      <Modal open={open} title={t("createUser")} closeLabel={t("close")} onClose={() => setOpen(false)}>
        <form onSubmit={form.handleSubmit(createUser)} className="grid gap-3">
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
            label={t("password")}
            {...form.register("password")}
            error={form.formState.errors.password?.message}
          />
          <Button type="submit" disabled={loading}>
            {loading ? t("saving") : t("save")}
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
