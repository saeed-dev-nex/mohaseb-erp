import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSelector } from "react-redux";
import { chatAPI } from "../services/api";

type ChatUser = {
  id: number;
  name: string;
  online?: boolean;
};

type ChatMessage = {
  id: number;
  sender: number | string;
  recipient?: number | string | null;
  sender_name?: string;
  text?: string;
  file_name?: string;
  created_at: string;
};

const timeLabel = (value: string) =>
  new Intl.DateTimeFormat("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("fa-IR", { month: "short", day: "numeric" }).format(
    new Date(value),
  );
const initial = (name?: string | null) => (name || "?").trim().slice(0, 1);
const mergeMessages = (
  current: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] => {
  const items = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => items.set(message.id, message));
  return [...items.values()].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
};

const Chat = () => {
  const currentUser = useSelector((state: any) => state.auth.currentUser);
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [recipient, setRecipient] = useState("all");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<string>(
    () =>
      typeof Notification === "undefined"
        ? "unsupported"
        : Notification.permission,
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadedRecipientRef = useRef<string | null>(null);
  const selectedUser = useMemo(
    () => users.find((user) => String(user.id) === recipient),
    [recipient, users],
  );

  const loadUsers = useCallback(async () => {
    try {
      setUsers((await chatAPI.users()).data);
    } catch {
      /* The chat remains usable if presence is temporarily unavailable. */
    }
  }, []);
  const loadMessages = useCallback(async () => {
    const isNewConversation = loadedRecipientRef.current !== recipient;
    if (isNewConversation) setLoading(true);
    try {
      setMessages(
        (await chatAPI.list(recipient === "all" ? {} : { recipient })).data,
      );
    } catch {
      setError("دریافت پیام‌ها انجام نشد. اتصال سرور را بررسی کنید.");
    } finally {
      loadedRecipientRef.current = recipient;
      if (isNewConversation) setLoading(false);
    }
  }, [recipient]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);
  useEffect(() => {
    loadMessages();
    chatAPI
      .markRead()
      .then(() => window.dispatchEvent(new CustomEvent("mohaseb:chat-read")))
      .catch(() => {});
  }, [loadMessages]);
  useEffect(() => {
    const onMessage = (event: CustomEvent) => {
      const message = event.detail;
      const belongsHere =
        recipient === "all"
          ? !message?.recipient
          : String(message?.sender) === recipient ||
            String(message?.recipient) === recipient;
      if (belongsHere)
        setMessages((previous) => mergeMessages(previous, [message]));
      if (document.visibilityState === "visible")
        chatAPI
          .markRead()
          .then(() =>
            window.dispatchEvent(new CustomEvent("mohaseb:chat-read")),
          )
          .catch(() => {});
    };
    const onConnection = (event: CustomEvent) =>
      setConnected(Boolean(event.detail?.connected));
    window.addEventListener("mohaseb:chat-message", onMessage);
    const onDeleted = (event: CustomEvent) =>
      setMessages((previous) =>
        previous.filter((message) => message.id !== event.detail?.id),
      );
    window.addEventListener("mohaseb:chat-deleted", onDeleted);
    window.addEventListener("mohaseb:chat-connection", onConnection);
    window.addEventListener("mohaseb:chat-presence", loadUsers);
    return () => {
      window.removeEventListener("mohaseb:chat-message", onMessage);
      window.removeEventListener("mohaseb:chat-deleted", onDeleted);
      window.removeEventListener("mohaseb:chat-connection", onConnection);
      window.removeEventListener("mohaseb:chat-presence", loadUsers);
    };
  }, [recipient, loadUsers]);
  useEffect(() => {
    // WebSocket is the immediate delivery channel. This lightweight fallback
    // also keeps conversations live when a proxy/LAN setup accepts a socket
    // but drops channel-layer events, so a manual page refresh is never needed.
    const timer = window.setInterval(loadMessages, 1500);
    return () => window.clearInterval(timer);
  }, [loadMessages]);
  useEffect(() => {
    const timer = window.setInterval(loadUsers, 60000);
    return () => window.clearInterval(timer);
  }, [loadUsers]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const sendMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if ((!text.trim() && !file) || sending) return;
    const body = new FormData();
    body.append("text", text.trim());
    if (recipient !== "all") body.append("recipient", recipient);
    if (file) body.append("file", file);
    setSending(true);
    setError("");
    try {
      const { data } = await chatAPI.create(body);
      setMessages((previous) => mergeMessages(previous, [data]));
      setText("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      const data = err.response?.data;
      setError(
        data?.recipient?.[0] ||
          data?.file?.[0] ||
          data?.text?.[0] ||
          data?.detail ||
          "ارسال پیام انجام نشد.",
      );
    } finally {
      setSending(false);
    }
  };
  const downloadFile = async (message: ChatMessage) => {
    try {
      const { data } = await chatAPI.download(message.id);
      const url = URL.createObjectURL(data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = message.file_name || "chat-file";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("دریافت فایل انجام نشد.");
    }
  };
  const deleteMessage = async (message: ChatMessage) => {
    try {
      await chatAPI.remove(message.id);
      setMessages((previous) =>
        previous.filter((item) => item.id !== message.id),
      );
    } catch {
      setError("حذف پیام انجام نشد.");
    }
  };
  const enableNotifications = async () => {
    if (typeof Notification !== "undefined")
      setNotificationPermission(await Notification.requestPermission());
  };

  return (
    <section
      className="chat-page mx-auto flex h-[calc(100vh-8rem)] min-h-[520px] max-w-6xl overflow-hidden rounded-2xl border border-slate-700/60 bg-[#0b141a] shadow-2xl"
      aria-label="گفتگوی کاربران"
    >
      <aside className="flex w-[19rem] shrink-0 flex-col border-l border-slate-700/70 bg-[#111b21]">
        <div className="border-b border-slate-700/70 px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="font-bold text-white">گفتگوها</h1>
            <span
              title={connected ? "اتصال زنده برقرار است" : "در حال اتصال"}
              className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-emerald-400" : "bg-amber-400"}`}
            />
          </div>
          <p className="mt-1 text-xs text-slate-400">
            کاربر را برای گفتگوی خصوصی انتخاب کنید
          </p>
        </div>
        <nav className="flex-1 overflow-y-auto p-2" aria-label="فهرست کاربران">
          <button
            type="button"
            onClick={() => setRecipient("all")}
            className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-right transition ${recipient === "all" ? "bg-[#2a3942] text-white" : "text-slate-200 hover:bg-slate-800/70"}`}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20 text-lg">
              👥
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">همهٔ کاربران</span>
              <span className="block truncate text-xs text-slate-400">
                پیام عمومی برای همهٔ همکاران
              </span>
            </span>
          </button>
          <p className="px-3 pb-1 pt-3 text-[11px] font-semibold text-slate-500">
            کاربران
          </p>
          {users.map((user) => (
            <button
              key={user.id}
              type="button"
              onClick={() => setRecipient(String(user.id))}
              className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-right transition ${recipient === String(user.id) ? "bg-[#2a3942] text-white" : "text-slate-200 hover:bg-slate-800/70"}`}
            >
              <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-600/25 text-sm font-bold text-sky-100">
                {initial(user.name)}
                <i
                  className={`absolute bottom-0 left-0 h-3 w-3 rounded-full border-2 border-[#111b21] ${user.online ? "bg-emerald-400" : "bg-slate-500"}`}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">
                  {user.name}
                </span>
                <span
                  className={`block text-xs ${user.online ? "text-emerald-400" : "text-slate-500"}`}
                >
                  {user.online ? "آنلاین" : "آفلاین"}
                </span>
              </span>
            </button>
          ))}
          {!users.length && (
            <p className="px-3 py-8 text-center text-xs text-slate-500">
              کاربر دیگری یافت نشد.
            </p>
          )}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col bg-[#0b141a]">
        <header className="flex items-center justify-between gap-3 border-b border-slate-700/70 bg-[#202c33] px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-600/60 text-lg">
              {selectedUser ? initial(selectedUser.name) : "👥"}
            </span>
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-white">
                {selectedUser ? selectedUser.name : "همهٔ کاربران"}
              </h2>
              <p
                className={`mt-0.5 text-xs ${selectedUser?.online ? "text-emerald-400" : "text-slate-400"}`}
              >
                {selectedUser
                  ? selectedUser.online
                    ? "آنلاین"
                    : "آفلاین"
                  : "پیام عمومی تیم"}
              </p>
            </div>
          </div>
          {notificationPermission === "default" && (
            <button
              type="button"
              onClick={enableNotifications}
              className="rounded-lg border border-emerald-400/30 px-3 py-2 text-xs text-emerald-300 hover:bg-emerald-400/10"
            >
              فعال‌سازی اعلان ویندوز
            </button>
          )}
        </header>
        <div
          className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_center,_rgba(32,44,51,.45),_transparent_70%)] px-4 py-5 sm:px-7"
          aria-live="polite"
        >
          {loading && (
            <p className="py-12 text-center text-sm text-slate-500">
              در حال دریافت پیام‌ها…
            </p>
          )}
          {!loading && !messages.length && (
            <div className="py-20 text-center">
              <p className="text-4xl">👋</p>
              <p className="mt-3 text-sm text-slate-300">
                هنوز پیامی در این گفتگو نیست
              </p>
            </div>
          )}
          {messages.map((message, index) => {
            const mine = Number(message.sender) === Number(currentUser?.id);
            const previous = messages[index - 1];
            const showDate =
              !previous ||
              new Date(previous.created_at).toDateString() !==
                new Date(message.created_at).toDateString();
            return (
              <React.Fragment key={message.id}>
                {showDate && (
                  <div className="my-4 text-center">
                    <span className="rounded-lg bg-[#182229] px-3 py-1 text-[11px] text-slate-400">
                      {dateLabel(message.created_at)}
                    </span>
                  </div>
                )}
                <article
                  className={`mb-2 flex ${mine ? "justify-start" : "justify-end"}`}
                >
                  <div
                    className={`max-w-[84%] rounded-xl px-3 py-2 shadow ${mine ? "rounded-tr-sm bg-[#005c4b] text-white" : "rounded-tl-sm bg-[#202c33] text-slate-100"}`}
                  >
                    <div className="flex items-end gap-3">
                      <div className="min-w-0">
                        {!mine && (
                          <p className="mb-1 text-xs font-semibold text-sky-300">
                            {message.sender_name}
                          </p>
                        )}
                        {message.text && (
                          <p className="whitespace-pre-wrap break-words text-sm leading-6">
                            {message.text}
                          </p>
                        )}
                        {message.file_name && (
                          <button
                            type="button"
                            onClick={() => downloadFile(message)}
                            className="mt-2 flex items-center gap-2 rounded-lg bg-black/15 px-2 py-1.5 text-xs hover:bg-black/25"
                          >
                            📎{" "}
                            <span className="max-w-48 truncate">
                              {message.file_name}
                            </span>
                            <span>دریافت</span>
                          </button>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <time className="pb-0.5 text-[10px] text-slate-300/70">
                          {timeLabel(message.created_at)}
                        </time>
                        {mine && (
                          <button
                            type="button"
                            onClick={() => deleteMessage(message)}
                            className="text-[10px] text-slate-300/70 hover:text-rose-300"
                            title="حذف پیام برای همه"
                          >
                            حذف برای همه
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              </React.Fragment>
            );
          })}
          <div ref={bottomRef} />
        </div>
        {error && (
          <p
            role="alert"
            className="bg-[#202c33] px-5 py-2 text-xs text-rose-300"
          >
            {error}
          </p>
        )}
        <form
          onSubmit={sendMessage}
          className="border-t border-slate-700/70 bg-[#202c33] p-3"
        >
          {file && (
            <div className="mb-2 flex items-center justify-between rounded-lg bg-slate-700/70 px-3 py-2 text-xs text-slate-200">
              <span className="truncate">📎 {file.name}</span>
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="text-rose-300"
              >
                حذف
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <label
              className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-xl text-slate-300 hover:bg-slate-700"
              title="پیوست فایل"
            >
              📎
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
            </label>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              rows={1}
              maxLength={5000}
              placeholder={`پیام به ${selectedUser ? selectedUser.name : "همهٔ کاربران"}…`}
              className="max-h-32 min-h-11 flex-1 resize-y rounded-lg border-0 bg-[#2a3942] px-4 py-3 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
            <button
              type="submit"
              disabled={sending || (!text.trim() && !file)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-lg text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              title="ارسال پیام"
            >
              {sending ? (
                "…"
              ) : (
                <svg
                  className="h-5 w-5 -scale-x-100"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              )}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
};

export default Chat;
