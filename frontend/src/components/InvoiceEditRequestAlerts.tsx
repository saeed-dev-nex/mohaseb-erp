import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  alertsSocketProtocols,
  alertsSocketURL,
  invoicesAPI,
} from "../services/api";
import { playChime } from "../lib/chime";

type EditRequestItem = {
  id: number;
  invoice_id: number;
  invoice_number: string;
  requested_by: string;
};

type AlertPayload = {
  kind: string;
  request_id: number;
  invoice_id: number;
  invoice_number: string;
  requested_by_id: number;
  requested_by: string;
  reviewed_by_id: number | null;
  reviewed_by: string;
  status: string;
};

type Toast = {
  id: number;
  tone: "success" | "danger" | "info";
  text: React.ReactNode;
};

const InvoiceEditRequestAlerts = () => {
  const user = useSelector((state: any) => state.auth.currentUser);
  const isManager = Boolean(user?.is_staff || user?.is_superuser);
  const myId = user?.id as number | undefined;
  const [requests, setRequests] = useState<EditRequestItem[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);

  const pushToast = useCallback(
    (tone: Toast["tone"], text: React.ReactNode) => {
      const id = ++toastSeq.current;
      setToasts((current) => [...current.slice(-3), { id, tone, text }]);
      window.setTimeout(
        () => setToasts((current) => current.filter((t) => t.id !== id)),
        14000,
      );
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (!isManager) return;
    try {
      const { data } = await invoicesAPI.editRequests();
      setRequests(data);
    } catch {
      // Keep the last known requests visible while the API is temporarily unavailable.
    }
  }, [isManager]);

  // Initial load + in-app refreshes + a slow poll as a safety net for
  // when the alert socket is unavailable (e.g. multi-process deploys).
  useEffect(() => {
    if (!isManager) return undefined;
    refresh();
    window.addEventListener("mohaseb:data-changed", refresh);
    const timer = window.setInterval(refresh, 45000);
    return () => {
      window.removeEventListener("mohaseb:data-changed", refresh);
      window.clearInterval(timer);
    };
  }, [isManager, refresh]);

  // Real-time alerts socket (all signed-in users): managers learn about
  // new requests instantly; the requester learns the moment a manager
  // approves or rejects, without refreshing the page.
  useEffect(() => {
    if (!user) return undefined;
    let socket: WebSocket | undefined;
    let closed = false;
    let retry: number | undefined;

    const handleAlert = (alert: AlertPayload) => {
      if (alert.kind === "edit_request_created") {
        if (isManager) {
          refresh();
          playChime();
        }
        return;
      }
      if (alert.kind !== "edit_request_reviewed") return;
      if (isManager) refresh();
      if (myId !== undefined && alert.requested_by_id === myId) {
        if (alert.status === "approved") {
          pushToast(
            "success",
            <>
              دسترسی ویرایش فاکتور{" "}
              <Link
                className="font-semibold underline"
                to={`/invoices/${alert.invoice_id}`}
              >
                {alert.invoice_number}
              </Link>{" "}
              باز شد؛ حالا می‌توانید آن را ویرایش کنید.
            </>,
          );
        } else {
          pushToast(
            "danger",
            <>درخواست ویرایش فاکتور {alert.invoice_number} رد شد.</>,
          );
        }
        playChime();
      } else if (
        isManager &&
        alert.status === "approved" &&
        alert.reviewed_by_id !== myId
      ) {
        pushToast(
          "info",
          <>
            دسترسی ویرایش فاکتور {alert.invoice_number} برای{" "}
            {alert.requested_by} باز شد.
          </>,
        );
      }
    };

    const connect = () => {
      if (closed) return;
      try {
        socket = new WebSocket(alertsSocketURL(), alertsSocketProtocols());
      } catch {
        retry = window.setTimeout(connect, 3000);
        return;
      }
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string);
          if (data?.type === "alert" && data.alert) handleAlert(data.alert);
        } catch {
          /* Non-JSON frames are ignored. */
        }
      };
      socket.onclose = () => {
        if (!closed) retry = window.setTimeout(connect, 3000);
      };
      socket.onerror = () => {
        try {
          socket?.close();
        } catch {
          /* The close handler schedules the reconnect. */
        }
      };
    };
    connect();
    return () => {
      closed = true;
      if (retry) window.clearTimeout(retry);
      try {
        socket?.close();
      } catch {
        /* Already closed. */
      }
    };
  }, [user, isManager, myId, refresh, pushToast]);

  const review = async (
    item: EditRequestItem,
    decision: "approve" | "reject",
  ) => {
    setBusyId(item.id);
    try {
      await invoicesAPI.reviewEditRequest(item.invoice_id, item.id, decision);
      setRequests((current) =>
        current.filter((request) => request.id !== item.id),
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      {isManager && requests.length > 0 && (
        <div
          className="fixed left-4 top-20 z-[80] w-[min(26rem,calc(100vw-2rem))] space-y-2"
          aria-live="polite"
        >
          {requests.map((item) => (
            <section
              key={item.id}
              className="rounded-2xl border border-amber-400/50 bg-white p-4 shadow-2xl shadow-slate-900/20"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 text-xl" aria-hidden="true">
                  🔔
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">
                    درخواست ویرایش فاکتور پرداخت‌شده
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {item.requested_by} برای فاکتور{" "}
                    <Link
                      className="font-semibold text-blue-700 hover:underline"
                      to={`/invoices/${item.invoice_id}`}
                    >
                      {item.invoice_number}
                    </Link>{" "}
                    درخواست داده است.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => review(item, "approve")}
                      disabled={busyId === item.id}
                      className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      تأیید یک‌بار ویرایش
                    </button>
                    <button
                      type="button"
                      onClick={() => review(item, "reject")}
                      disabled={busyId === item.id}
                      className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50"
                    >
                      رد درخواست
                    </button>
                  </div>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}

      {toasts.length > 0 && (
        <div
          className="fixed bottom-4 left-4 z-[85] w-[min(24rem,calc(100vw-2rem))] space-y-2"
          aria-live="polite"
        >
          {toasts.map((toast) => (
            <section
              key={toast.id}
              className={`rounded-2xl border p-4 shadow-2xl shadow-slate-900/20 ${
                toast.tone === "success"
                  ? "border-emerald-400/60 bg-emerald-50 text-emerald-900"
                  : toast.tone === "danger"
                    ? "border-red-300 bg-red-50 text-red-900"
                    : "border-sky-300 bg-sky-50 text-sky-900"
              }`}
            >
              <div className="flex items-start gap-2">
                <span aria-hidden="true">
                  {toast.tone === "success"
                    ? "✅"
                    : toast.tone === "danger"
                      ? "⛔"
                      : "ℹ️"}
                </span>
                <p className="min-w-0 flex-1 text-sm">{toast.text}</p>
                <button
                  type="button"
                  aria-label="بستن اعلان"
                  onClick={() =>
                    setToasts((current) =>
                      current.filter((t) => t.id !== toast.id),
                    )
                  }
                  className="text-xs opacity-60 hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
};

export default InvoiceEditRequestAlerts;
