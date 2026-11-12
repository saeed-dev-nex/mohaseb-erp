import React, { useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import QuickInvoiceModal from "./QuickInvoiceModal";
import InvoiceEditRequestAlerts from "./InvoiceEditRequestAlerts";
import UpdateBanner from "./UpdateBanner";
import WelcomeModal from "./WelcomeModal";
import {
  backupConfigAPI,
  chatAPI,
  chatSocketProtocols,
  chatSocketURL,
  welcomeAPI,
} from "../services/api";
import api from "../services/api";
import { hasModule } from "../utils/modules";
import { startVisibilityPoll } from "../utils/visibilityPoll";
import {
  countQueuedQuickInvoices,
  flushQuickInvoiceQueue,
} from "../lib/offlineQueue";
import {
  SHORTCUTS_CHANGED_EVENT,
  eventMatchesCombo,
  loadShortcuts,
} from "../lib/shortcuts";
import type { ShortcutMap } from "../lib/shortcuts";
import { isWaitingActive } from "../lib/waiting";
import WaitingModal from "./WaitingModal";

type ChatNotice = { sender: string; text: string };

const BASE_TITLE = "محاسب پرو - سیستم یکپارچه مالی";

const faDigits = (n: number) =>
  String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

/** Reflect the unread chat count in the tab title: «(۲ پیام جدید) - محاسب پرو». */
const applyTitleBadge = (count: number) => {
  document.title =
    count > 0 ? `(${faDigits(count)} پیام جدید) - محاسب پرو` : BASE_TITLE;
};

let chimeContext: AudioContext | null = null;

/** Short, soft two-tone chime for a new chat message. Best-effort only:
 * browsers may keep the context suspended until the user interacts. */
const playChatChime = () => {
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    chimeContext = chimeContext || new Ctor();
    if (chimeContext.state === "suspended") void chimeContext.resume();
    const ctx = chimeContext;
    const now = ctx.currentTime;
    [880, 1174.66].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.11;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.07, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.12);
    });
  } catch {
    /* Sound is optional. */
  }
};

/** Toast shown when the service worker installed a newer app build. */
const SwUpdateToast = () => {
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    const show = () => setVisible(true);
    window.addEventListener("mohaseb:sw-update", show);
    return () => window.removeEventListener("mohaseb:sw-update", show);
  }, []);
  if (!visible) return null;
  return (
    <div className="fixed bottom-4 left-4 z-[90] flex items-center gap-3 rounded-2xl border border-emerald-400/40 bg-slate-800 px-4 py-3 shadow-2xl shadow-black/40">
      <span className="text-sm text-slate-100">
        نسخهٔ جدید نرم‌افزار آماده است
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
      >
        بروزرسانی
      </button>
      <button
        type="button"
        onClick={() => setVisible(false)}
        className="text-xs text-slate-400 hover:text-slate-200"
      >
        بعداً
      </button>
    </div>
  );
};

const ChatRealtimeBridge = () => {
  const user = useSelector((state: any) => state.auth.currentUser);
  const isAuthenticated = useSelector(
    (state: any) => state.auth.isAuthenticated,
  );
  const [notice, setNotice] = React.useState<ChatNotice | null>(null);
  const canChat = hasModule(user, "chat");

  React.useEffect(() => {
    setNotice(null);
    if (!isAuthenticated || !user?.id || !canChat) return undefined;
    let active = true;
    let socket: WebSocket | undefined;
    let reconnectTimer: number | undefined;
    let noticeTimer: number | undefined;
    let heartbeatTimer: number | undefined;
    let reconnectDelay = 1000;

    const setConnection = (connected: boolean) =>
      window.dispatchEvent(
        new CustomEvent("mohaseb:chat-connection", { detail: { connected } }),
      );
    const refreshUnread = () =>
      chatAPI
        .unread()
        .then(({ data }) => {
          if (!active) return;
          applyTitleBadge(data.count || 0);
          window.dispatchEvent(
            new CustomEvent("mohaseb:chat-unread", {
              detail: { count: data.count || 0 },
            }),
          );
        })
        .catch(() => {});
    const handleVisibility = () => {
      if (!document.hidden) refreshUnread();
    };
    const handleRead = () => {
      applyTitleBadge(0);
      window.dispatchEvent(
        new CustomEvent("mohaseb:chat-unread", { detail: { count: 0 } }),
      );
    };

    const connect = () => {
      if (!active) return;
      try {
        socket = new WebSocket(chatSocketURL(), chatSocketProtocols());
      } catch {
        scheduleReconnect();
        return;
      }
      socket.onopen = () => {
        reconnectDelay = 1000;
        setConnection(true);
        window.dispatchEvent(new CustomEvent("mohaseb:chat-presence"));
        refreshUnread();
        heartbeatTimer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN)
            socket.send(JSON.stringify({ type: "heartbeat" }));
        }, 30000);
      };
      socket.onmessage = (event) => {
        let payload: any;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        if (payload.type === "presence") {
          window.dispatchEvent(new CustomEvent("mohaseb:chat-presence"));
          return;
        }
        if (payload.type === "deleted") {
          window.dispatchEvent(
            new CustomEvent("mohaseb:chat-deleted", {
              detail: { id: payload.message_id },
            }),
          );
          return;
        }
        if (payload.type !== "message" || !payload.message) return;
        const message = payload.message;
        window.dispatchEvent(
          new CustomEvent("mohaseb:chat-message", { detail: message }),
        );
        if (Number(message.sender) === Number(user.id)) return;
        const onChatPage =
          window.location.pathname === "/chat" && !document.hidden;
        if (!onChatPage) {
          refreshUnread();
          setNotice({
            sender: message.sender_name,
            text: message.text || `فایل پیوست: ${message.file_name}`,
          });
          playChatChime();
          window.clearTimeout(noticeTimer);
          noticeTimer = window.setTimeout(() => setNotice(null), 7000);
        }
        if (
          !onChatPage &&
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          try {
            const notification = new Notification(
              `پیام جدید از ${message.sender_name}`,
              {
                body: message.text || `فایل پیوست: ${message.file_name}`,
                tag: `mohaseb-chat-${message.id}`,
              },
            );
            notification.onclick = () => {
              window.focus();
              window.location.href = "/chat";
              notification.close();
            };
          } catch {
            /* Browser notification delivery is optional. */
          }
        }
      };
      socket.onclose = () => {
        window.clearInterval(heartbeatTimer);
        setConnection(false);
        scheduleReconnect();
      };
      socket.onerror = () => socket?.close();
    };
    const scheduleReconnect = () => {
      if (!active || reconnectTimer) return;
      setConnection(false);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        refreshUnread();
        connect();
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    };

    window.addEventListener("mohaseb:chat-read", handleRead);
    document.addEventListener("visibilitychange", handleVisibility);
    connect();
    return () => {
      active = false;
      applyTitleBadge(0);
      window.removeEventListener("mohaseb:chat-read", handleRead);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(noticeTimer);
      window.clearInterval(heartbeatTimer);
      socket?.close();
    };
  }, [isAuthenticated, user?.id, canChat]);

  return notice ? (
    <a
      href="/chat"
      onClick={() => setNotice(null)}
      className="fixed left-5 top-20 z-[60] max-w-sm rounded-2xl border border-blue-400/30 bg-slate-800 px-4 py-3 text-right shadow-2xl shadow-black/30"
    >
      <p className="text-sm font-semibold text-blue-200">
        پیام تازه از {notice.sender}
      </p>
      <p className="mt-1 truncate text-xs text-slate-300">{notice.text}</p>
      <span className="mt-2 block text-[10px] text-blue-300">
        برای مشاهده وارد گفتگو شوید
      </span>
    </a>
  ) : null;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => void;
  userChoice: Promise<unknown>;
};

const Layout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("sidebar-collapsed") === "true",
  );
  const [quickInvoice, setQuickInvoice] = useState(false);
  const [offlinePending, setOfflinePending] = useState(0);
  const [offlineFlushed, setOfflineFlushed] = useState<string[]>([]);

  // Offline quick-invoice queue: flush on mount and on reconnect, and
  // keep the pending count fresh (the quick-invoice modal announces new
  // queued drafts with a window event).
  React.useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const flushed = await flushQuickInvoiceQueue();
      if (!alive) return;
      if (flushed.length) setOfflineFlushed(flushed);
      setOfflinePending(await countQueuedQuickInvoices());
    };
    void refresh();
    const onOnline = () => void refresh();
    const onQueued = () => {
      void countQueuedQuickInvoices().then((n) => {
        if (alive) setOfflinePending(n);
      });
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("mohaseb:queue-updated", onQueued);
    const timer = window.setInterval(onQueued, 30_000);
    return () => {
      alive = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("mohaseb:queue-updated", onQueued);
      window.clearInterval(timer);
    };
  }, []);

  React.useEffect(() => {
    if (!offlineFlushed.length) return undefined;
    const timer = window.setTimeout(() => setOfflineFlushed([]), 9000);
    return () => window.clearTimeout(timer);
  }, [offlineFlushed]);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const isAuthenticated = useSelector(
    (state: any) => state.auth.isAuthenticated,
  );
  const currentUser = useSelector((state: any) => state.auth.currentUser);
  const isSuperuser = !!currentUser?.is_superuser;
  const canQuickInvoice = hasModule(currentUser, "invoices");
  const location = useLocation();
  // The FAB is redundant — and covers the submit button — on the full
  // invoice form (create and edit), so it stays hidden there.
  const isInvoiceForm =
    location.pathname === "/invoices/new" ||
    /^\/invoices\/[^/]+\/edit$/.test(location.pathname);

  // Global keyboard shortcuts — editable in Settings → میانبرهای
  // صفحه‌کلید (defaults: Alt+N quick invoice, Alt+Shift+N new invoice,
  // Alt+Shift+C new customer). Matching uses e.code, so combos work with
  // a Persian keyboard layout too. Listens for in-app changes so edits
  // apply without a reload.
  const navigate = useNavigate();
  const [shortcutMap, setShortcutMap] = useState<ShortcutMap>(() =>
    loadShortcuts(),
  );
  React.useEffect(() => {
    const refresh = () => setShortcutMap(loadShortcuts());
    window.addEventListener(SHORTCUTS_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SHORTCUTS_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  React.useEffect(() => {
    const run = (id: string): boolean => {
      switch (id) {
        case "quick_invoice":
          if (!hasModule(currentUser, "invoices")) return false;
          setQuickInvoice(true);
          return true;
        case "new_invoice":
          if (!hasModule(currentUser, "invoices")) return false;
          navigate("/invoices/new");
          return true;
        case "new_customer":
          if (!hasModule(currentUser, "customers")) return false;
          navigate("/customers?new=1");
          return true;
        case "new_service":
          if (!hasModule(currentUser, "services")) return false;
          navigate("/services?new=1");
          return true;
        case "new_expense":
          if (!hasModule(currentUser, "expenses")) return false;
          navigate("/expenses?new=1");
          return true;
        default:
          return false;
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || isWaitingActive()) return;
      for (const [id, combo] of Object.entries(shortcutMap)) {
        if (combo && eventMatchesCombo(e, combo)) {
          if (run(id)) e.preventDefault();
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcutMap, currentUser, navigate]);

  React.useEffect(() => {
    if (!isAuthenticated) return;
    welcomeAPI
      .today()
      .then(({ data }) => {
        if (data.show && data.message) setWelcomeMessage(data.message);
      })
      .catch(() => {});
  }, [isAuthenticated]);

  React.useEffect(() => {
    if (!isAuthenticated) return undefined;
    let lastRevision: string | undefined;
    return startVisibilityPoll(
      async (signal: AbortSignal, isActive: () => boolean) => {
        const { data } = await api.get("changes/", { signal, timeout: 12000 });
        if (!isActive()) return;
        const revision = JSON.stringify(data.revision);
        if (lastRevision !== undefined && revision !== lastRevision) {
          window.dispatchEvent(new CustomEvent("mohaseb:data-changed"));
        }
        lastRevision = revision;
      },
      {
        document,
        setTimeout: window.setTimeout.bind(window),
        clearTimeout: window.clearTimeout.bind(window),
      },
    );
  }, [isAuthenticated, currentUser?.id]);

  React.useEffect(() => {
    if (!isAuthenticated || !isSuperuser) return undefined;
    backupConfigAPI.checkAuto().catch(() => {});
    const timer = window.setInterval(
      () => backupConfigAPI.checkAuto().catch(() => {}),
      60 * 1000,
    );
    return () => window.clearInterval(timer);
  }, [isAuthenticated, isSuperuser]);

  React.useEffect(() => {
    const captureInstallPrompt = (event: BeforeInstallPromptEvent) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    return () =>
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
  }, []);

  const installPwa = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  return (
    <div
      data-theme={localStorage.getItem("app-theme") || "dark"}
      className="min-h-screen bg-slate-950 font-vazirmatn overflow-x-clip"
      dir="rtl"
    >
      {/* Sidebar */}
      <Sidebar
        isOpen={sidebarOpen}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() =>
          setSidebarCollapsed((value) => {
            localStorage.setItem("sidebar-collapsed", String(!value));
            return !value;
          })
        }
        onClose={() => setSidebarOpen(false)}
      />
      <ChatRealtimeBridge />
      <InvoiceEditRequestAlerts />
      <SwUpdateToast />
      {welcomeMessage && (
        <WelcomeModal
          message={welcomeMessage}
          onClose={() => setWelcomeMessage("")}
        />
      )}

      {/* Main content - offset for sidebar on desktop */}
      <div
        className={`${sidebarCollapsed ? "lg:mr-20" : "lg:mr-64"} flex flex-col min-h-screen transition-[margin] duration-300`}
      >
        <Navbar onMenuToggle={() => setSidebarOpen((prev) => !prev)} />
        <UpdateBanner />
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>

      {/* Quick Invoice FAB */}
      {canQuickInvoice && !isInvoiceForm && (
        <button
          onClick={() => setQuickInvoice(true)}
          title="فاکتور سریع"
          className="fixed bottom-6 left-6 z-40 w-14 h-14 rounded-2xl
          bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700
          text-white shadow-xl shadow-blue-500/30 hover:shadow-blue-500/50
          flex items-center justify-center text-2xl
          transition-all duration-300 hover:scale-110 active:scale-95
          group"
        >
          ⚡{/* Tooltip */}
          <span
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2
          bg-slate-800 text-white text-[11px] font-medium px-3 py-1.5 rounded-lg border border-slate-700
          opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none"
          >
            فاکتور سریع (Alt+N)
          </span>
        </button>
      )}

      {/* Global waiting overlay for long-running operations */}
      <WaitingModal />

      {/* Quick Invoice Modal */}
      {canQuickInvoice && (
        <QuickInvoiceModal
          isOpen={quickInvoice}
          onClose={() => setQuickInvoice(false)}
          onSuccess={() => {}}
        />
      )}
      {(offlineFlushed.length > 0 || offlinePending > 0) && (
        <div className="fixed bottom-6 left-6 z-50 flex flex-col gap-2">
          {offlineFlushed.length > 0 && (
            <div className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-xl">
              ✅ فاکتور آفلاین ارسال شد: {offlineFlushed.join("، ")}
            </div>
          )}
          {offlinePending > 0 && (
            <div className="rounded-xl bg-amber-600 px-4 py-3 text-sm font-semibold text-white shadow-xl">
              📥 {offlinePending} فاکتور در انتظار ارسال — با برگشت اینترنت
              خودکار ارسال می‌شود
            </div>
          )}
        </div>
      )}
      {installPrompt && (
        <button
          type="button"
          onClick={installPwa}
          className="fixed bottom-24 left-6 z-40 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-xl shadow-emerald-900/30 hover:bg-emerald-500"
        >
          ⬇ نصب محاسب پرو
        </button>
      )}
    </div>
  );
};

export default Layout;
