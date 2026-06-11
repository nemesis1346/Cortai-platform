"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { useRealtimeSocket } from "@/hooks/use-realtime-socket";
import { useAuth } from "@/components/auth/AuthProvider";

type Thread = {
  id: string;
  org_id: string;
  property_id: string;
  thread_id: string;
  guest_id: string;
  guest_first_name: string | null;
  guest_last_name: string | null;
  channel: "sms" | "whatsapp" | "email" | "in_app";
  status: string;
  assigned_to_user_id: string | null;
  unread_count: number;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
};

type ThreadList = { items: Thread[] };

type Message = {
  id: string;
  org_id: string;
  thread_id: string;
  channel: string;
  direction: "in" | "out";
  guest_id: string;
  body: string;
  status: string | null;
  sent_at: string;
  language: string;
  created_at: string;
  updated_at: string;
};

type MessageList = { items: Message[] };

type Template = {
  id: string;
  org_id: string;
  name: string;
  language: "en" | "fr";
  body_template: string;
  variables: string[];
  created_at: string;
  updated_at: string;
};

type TemplateList = { items: Template[] };

type LiveMessageReceived = {
  type?: string;
  thread_id?: string;
  message?: Partial<Message>;
  payload?: Partial<Message> & { thread_id?: string };
  message_id?: string;
  body?: string;
  channel?: string;
  guest_id?: string;
  language?: string;
  ts?: string;
  sent_at?: string;
};

function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const parts = document.cookie.split(";").map((p) => p.trim());
  const prefix = `${name}=`;
  for (const p of parts) {
    if (p.startsWith(prefix)) return decodeURIComponent(p.slice(prefix.length));
  }
  return null;
}

function displayGuest(thread: Thread) {
  const name = `${thread.guest_first_name ?? ""} ${thread.guest_last_name ?? ""}`.trim();
  return name || thread.guest_id;
}

function fmtTs(value: string | null, dash: string) {
  if (!value) return dash;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function threadTone(status: string) {
  if (status === "open") return "green";
  if (status === "pending") return "amber";
  if (status === "closed") return "neutral";
  return "blue";
}

function coerceInboundMessage(event: LiveMessageReceived, thread: Thread | undefined): Message | null {
  const fromEvent = event.message ?? event.payload;
  const id = typeof fromEvent?.id === "string" ? fromEvent.id : typeof event.message_id === "string" ? event.message_id : `live-${Date.now()}`;
  const threadId = typeof fromEvent?.thread_id === "string" ? fromEvent.thread_id : event.thread_id;
  const body = typeof fromEvent?.body === "string" ? fromEvent.body : typeof event.body === "string" ? event.body : "";
  if (!threadId || !body) return null;
  return {
    id,
    org_id: typeof fromEvent?.org_id === "string" ? fromEvent.org_id : thread?.org_id ?? "",
    thread_id: threadId,
    channel: typeof fromEvent?.channel === "string" ? fromEvent.channel : event.channel ?? thread?.channel ?? "sms",
    direction: "in",
    guest_id: typeof fromEvent?.guest_id === "string" ? fromEvent.guest_id : event.guest_id ?? thread?.guest_id ?? "",
    body,
    status: typeof fromEvent?.status === "string" ? fromEvent.status : null,
    sent_at:
      typeof fromEvent?.sent_at === "string"
        ? fromEvent.sent_at
        : typeof event.sent_at === "string"
          ? event.sent_at
          : typeof event.ts === "string"
            ? event.ts
            : new Date().toISOString(),
    language: typeof fromEvent?.language === "string" ? fromEvent.language : event.language ?? "en",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

export function GuestMessagingClient({ initialPropertyId }: { initialPropertyId: string }) {
  const t = useTranslations("operations.guestMessaging");
  const tc = useTranslations("operations.common");
  const { notify } = useToast();
  const { user } = useAuth();
  const [propertyId, setPropertyId] = useState(initialPropertyId);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [guestFilter, setGuestFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [templateLanguage, setTemplateLanguage] = useState<"en" | "fr">("en");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [composerBody, setComposerBody] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const next = getCookie("cortai_property_id") ?? "";
    setPropertyId(next);
  }, [initialPropertyId]);

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [selectedThreadId, threads]
  );

  const loadThreads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (guestFilter.trim()) params.set("guest", guestFilter.trim());
      if (channelFilter) params.set("channel", channelFilter);
      if (statusFilter) params.set("status", statusFilter);
      const resp = await apiFetch<ThreadList>(`/api/operations/messaging/threads?${params.toString()}`);
      const scoped = propertyId ? resp.items.filter((thread) => thread.property_id === propertyId) : resp.items;
      setThreads(scoped);
      setSelectedThreadId((prev) => prev ?? scoped[0]?.id ?? null);
    } finally {
      setLoading(false);
    }
  }, [channelFilter, guestFilter, propertyId, statusFilter]);

  const loadTemplates = useCallback(async () => {
    const resp = await apiFetch<TemplateList>(`/api/operations/messaging/templates?language=${templateLanguage}`);
    setTemplates(resp.items);
  }, [templateLanguage]);

  const loadMessages = useCallback(async (threadPk: string) => {
    const resp = await apiFetch<MessageList>(`/api/operations/messaging/threads/${encodeURIComponent(threadPk)}/messages`);
    setMessages(resp.items);
  }, []);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    if (selectedThreadId) void loadMessages(selectedThreadId);
  }, [loadMessages, selectedThreadId]);

  const handleLiveMessage = useCallback(
    (message: Record<string, unknown>) => {
      if (message.type !== "message.received" && message.type !== "cortai.live.message.received") return;
      const event = message as LiveMessageReceived;
      const eventThreadId =
        typeof event.thread_id === "string"
          ? event.thread_id
          : typeof event.message?.thread_id === "string"
            ? event.message.thread_id
            : event.payload?.thread_id;
      if (!eventThreadId) return;
      const thread = threads.find((item) => item.thread_id === eventThreadId);
      const inbound = coerceInboundMessage(event, thread);
      if (!inbound) return;

      if (selectedThread && selectedThread.thread_id === eventThreadId) {
        setMessages((prev) => (prev.some((item) => item.id === inbound.id) ? prev : [...prev, inbound]));
      }

      setThreads((prev) =>
        prev.map((item) =>
          item.thread_id === eventThreadId
            ? {
                ...item,
                unread_count: selectedThread?.thread_id === eventThreadId ? item.unread_count : item.unread_count + 1,
                last_message_at: inbound.sent_at
              }
            : item
        )
      );
    },
    [selectedThread, threads]
  );

  const { status: socketStatus } = useRealtimeSocket({
    enabled: Boolean(propertyId),
    propertyId,
    onMessage: handleLiveMessage,
    onReconnect: loadThreads
  });

  function applyTemplate(templateId: string) {
    setSelectedTemplateId(templateId);
    const template = templates.find((item) => item.id === templateId);
    if (template) setComposerBody(template.body_template);
  }

  async function sendMessage() {
    if (!selectedThread || !composerBody.trim()) return;
    const resp = await apiFetch<{ message: Message }>(
      `/api/operations/messaging/threads/${encodeURIComponent(selectedThread.id)}/messages`,
      {
        method: "POST",
        headers: { "accept-language": templateLanguage },
        body: JSON.stringify({ body: composerBody.trim(), language: templateLanguage })
      }
    );
    setMessages((prev) => [...prev, resp.message]);
    setComposerBody("");
    setSelectedTemplateId("");
    await loadThreads();
    notify({ title: t("toast.sent.title"), description: t("toast.sent.description"), tone: "success" });
  }

  async function assignToMe() {
    if (!selectedThread || !user) return;
    const updated = await apiFetch<Thread>(`/api/operations/messaging/threads/${encodeURIComponent(selectedThread.id)}/assign`, {
      method: "POST",
      body: JSON.stringify({ assigned_to_user_id: user.id })
    });
    setThreads((prev) => prev.map((th) => (th.id === updated.id ? { ...th, ...updated } : th)));
    notify({ title: t("toast.assigned.title"), description: t("toast.assigned.description"), tone: "success" });
  }

  async function unassign() {
    if (!selectedThread) return;
    const updated = await apiFetch<Thread>(`/api/operations/messaging/threads/${encodeURIComponent(selectedThread.id)}/assign`, {
      method: "POST",
      body: JSON.stringify({ assigned_to_user_id: null })
    });
    setThreads((prev) => prev.map((th) => (th.id === updated.id ? { ...th, ...updated } : th)));
    notify({ title: t("toast.unassigned.title"), description: t("toast.unassigned.description"), tone: "success" });
  }

  async function markRead() {
    if (!selectedThread) return;
    const updated = await apiFetch<Thread>(`/api/operations/messaging/threads/${encodeURIComponent(selectedThread.id)}/read`, {
      method: "POST"
    });
    setThreads((prev) => prev.map((th) => (th.id === updated.id ? { ...th, ...updated } : th)));
  }

  async function markUnread() {
    if (!selectedThread) return;
    const updated = await apiFetch<Thread>(`/api/operations/messaging/threads/${encodeURIComponent(selectedThread.id)}/unread`, {
      method: "POST"
    });
    setThreads((prev) => prev.map((th) => (th.id === updated.id ? { ...th, ...updated } : th)));
  }

  function channelLabel(channel: string) {
    return t(`channels.${channel}`);
  }

  function statusLabel(status: string) {
    return t(`statuses.${status}`);
  }

  if (!propertyId) {
    return (
      <div className="rounded-lg border border-cortai-border bg-cortai-bg2 p-4">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="mt-1 text-xs text-cortai-text2">{t("selectProperty")}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4" data-testid="guest-messaging-page">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <p className="text-xs text-cortai-text2">{t("subtitle")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge tone={socketStatus === "connected" ? "green" : "amber"} data-testid="guest-messaging-ws-status">
            {t(`socket.${socketStatus}`)}
          </Badge>
          <Button type="button" variant="ghost" onClick={() => void loadThreads()} disabled={loading} data-testid="guest-messaging-refresh">
            {t("refresh")}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
        <Card title={t("threads.title")}>
          <div className="grid gap-3" data-testid="guest-messaging-thread-filters">
            <Input
              label={t("filters.guest")}
              value={guestFilter}
              onChange={(e) => setGuestFilter(e.target.value)}
              data-testid="guest-messaging-filter-guest"
            />
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1.5 text-xs text-cortai-text2">
                <span className="font-medium">{t("filters.channel")}</span>
                <select
                  className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-sm outline-none focus:border-cortai-teal"
                  value={channelFilter}
                  onChange={(e) => setChannelFilter(e.target.value)}
                  data-testid="guest-messaging-filter-channel"
                >
                  <option value="">{t("filters.allChannels")}</option>
                  {["sms", "whatsapp", "email", "in_app"].map((channel) => (
                    <option key={channel} value={channel}>
                      {channelLabel(channel)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-xs text-cortai-text2">
                <span className="font-medium">{t("filters.status")}</span>
                <select
                  className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-sm outline-none focus:border-cortai-teal"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  data-testid="guest-messaging-filter-status"
                >
                  <option value="">{t("filters.allStatuses")}</option>
                  {["open", "pending", "closed"].map((status) => (
                    <option key={status} value={status}>
                      {statusLabel(status)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="mt-4 grid max-h-[620px] gap-2 overflow-y-auto">
            {threads.length === 0 ? <p className="text-xs text-cortai-text2">{t("threads.empty")}</p> : null}
            {threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => setSelectedThreadId(thread.id)}
                className={`rounded-lg border p-3 text-left transition ${
                  selectedThreadId === thread.id ? "border-cortai-teal bg-cortai-teal/10" : "border-cortai-border bg-cortai-bg2 hover:bg-cortai-bg4"
                }`}
                data-testid={`guest-messaging-thread-${thread.id}`}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{displayGuest(thread)}</span>
                  {thread.unread_count > 0 ? <Badge tone="amber">{thread.unread_count}</Badge> : null}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Badge tone={threadTone(thread.status)}>{statusLabel(thread.status)}</Badge>
                  <Badge tone="neutral">{channelLabel(thread.channel)}</Badge>
                </div>
                <p className="mt-2 text-[11px] text-cortai-text2">{fmtTs(thread.last_message_at, tc("dash"))}</p>
                <p className="mt-1 truncate text-[11px] text-cortai-text3">
                  {thread.assigned_to_user_id ? t("threads.assigned") : t("threads.unassigned")}
                </p>
              </button>
            ))}
          </div>
        </Card>

        <Card
          title={selectedThread ? displayGuest(selectedThread) : t("conversation.title")}
          action={
            selectedThread ? (
              <div className="flex flex-wrap gap-2" data-testid="guest-messaging-thread-actions">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void markRead()}
                  disabled={selectedThread.unread_count === 0}
                  data-testid="guest-messaging-mark-read"
                >
                  {t("actions.markRead")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void markUnread()}
                  data-testid="guest-messaging-mark-unread"
                >
                  {t("actions.markUnread")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void assignToMe()}
                  disabled={!user}
                  data-testid="guest-messaging-assign-to-me"
                >
                  {t("actions.assignToMe")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void unassign()}
                  data-testid="guest-messaging-unassign"
                >
                  {t("actions.unassign")}
                </Button>
              </div>
            ) : null
          }
        >
          {!selectedThread ? (
            <p className="text-xs text-cortai-text2">{t("conversation.empty")}</p>
          ) : (
            <div className="grid max-h-[720px] gap-3 overflow-y-auto" data-testid="guest-messaging-open-thread">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-[78%] rounded-lg border px-3 py-2 ${
                    message.direction === "out"
                      ? "ml-auto border-cortai-teal/25 bg-cortai-teal/10"
                      : "mr-auto border-cortai-border bg-cortai-bg2"
                  }`}
                  data-testid={`guest-messaging-message-${message.id}`}
                >
                  <p className="whitespace-pre-wrap text-sm">{message.body}</p>
                  <p className="mt-1 text-[10px] text-cortai-text3">
                    {message.direction === "out" ? t("conversation.outbound") : t("conversation.inbound")} · {message.language} ·{" "}
                    {fmtTs(message.sent_at, tc("dash"))}
                  </p>
                </div>
              ))}
              {messages.length === 0 ? <p className="text-xs text-cortai-text2">{t("conversation.noMessages")}</p> : null}
            </div>
          )}
        </Card>

        <Card title={t("composer.title")}>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={templateLanguage === "en" ? "primary" : "ghost"}
                onClick={() => setTemplateLanguage("en")}
                data-testid="guest-messaging-template-language-en"
              >
                {t("composer.english")}
              </Button>
              <Button
                type="button"
                variant={templateLanguage === "fr" ? "primary" : "ghost"}
                onClick={() => setTemplateLanguage("fr")}
                data-testid="guest-messaging-template-language-fr"
              >
                {t("composer.french")}
              </Button>
            </div>
            <label className="grid gap-1.5 text-xs text-cortai-text2">
              <span className="font-medium">{t("composer.template")}</span>
              <select
                className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-sm outline-none focus:border-cortai-teal"
                value={selectedTemplateId}
                onChange={(e) => applyTemplate(e.target.value)}
                data-testid="guest-messaging-template-picker"
              >
                <option value="">{t("composer.noTemplate")}</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-xs text-cortai-text2">
              <span className="font-medium">{t("composer.message")}</span>
              <textarea
                className="min-h-[180px] rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-sm text-cortai-text outline-none transition placeholder:text-cortai-text3 focus:border-cortai-teal"
                value={composerBody}
                onChange={(e) => setComposerBody(e.target.value)}
                placeholder={t("composer.placeholder")}
                data-testid="guest-messaging-composer-body"
              />
            </label>
            <Button
              type="button"
              onClick={() => void sendMessage()}
              disabled={!selectedThread || !composerBody.trim()}
              data-testid="guest-messaging-send"
            >
              {t("composer.send")}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

