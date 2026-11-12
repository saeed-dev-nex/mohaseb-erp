import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { usersAPI } from "../services/api";

type PerfUser = {
  id: number;
  username: string;
  full_name: string;
  is_active: boolean;
  is_staff: boolean;
  is_superuser: boolean;
  date_joined: string;
  last_login: string | null;
  last_activity: string | null;
};

type PerfData = {
  user: PerfUser;
  range: string;
  stats: {
    invoices_issued: number;
    invoices_total: number;
    payments_recorded: number;
    payments_total: number;
    edit_requests: number;
    edit_requests_approved: number;
    activity_events: number;
  };
  monthly_series: { label: string; count: number; total: number }[];
  recent_invoices: {
    id: number;
    invoice_number: string;
    customer_name: string;
    status: string;
    total_amount: number;
    date: string;
  }[];
  recent_payments: {
    id: number;
    invoice_id: number;
    invoice_number: string;
    amount: number;
    method: string;
    paid_at: string;
  }[];
};

const RANGES = [
  { key: "month", label: "این ماه" },
  { key: "30d", label: "۳۰ روز گذشته" },
  { key: "all", label: "همهٔ زمان‌ها" },
] as const;

const faNum = (value: number) => value.toLocaleString("fa-IR");
const faMoney = (value: number) => `${faNum(value)} تومان`;
const faDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString("fa-IR") : "—";
const faDateTime = (value: string | null) =>
  value
    ? `${new Date(value).toLocaleDateString("fa-IR")} - ${new Date(value).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })}`
    : "—";

const METHOD_LABELS: Record<string, string> = {
  cash: "نقدی",
  card: "کارت‌خوان",
  transfer: "کارت‌به‌کارت / حواله",
  other: "سایر",
};

export default function UserPerformancePage() {
  const { id } = useParams<{ id: string }>();
  const [range, setRange] = useState<string>("month");
  const [data, setData] = useState<PerfData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true);
    usersAPI
      .performance(id, range)
      .then(({ data: payload }) => {
        if (active) {
          setData(payload as PerfData);
          setError("");
        }
      })
      .catch(() => {
        if (active) setError("دریافت عملکرد کاربر انجام نشد.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, range]);

  const user = data?.user;
  const stats = data?.stats;
  const maxCount = Math.max(
    1,
    ...(data?.monthly_series.map((m) => m.count) ?? [1]),
  );
  const roleLabel = user?.is_superuser
    ? "مدیر ارشد"
    : user?.is_staff
      ? "مدیر"
      : "اپراتور";

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">📊 عملکرد کاربر</h1>
        <Link
          to="/users"
          className="rounded-lg border border-slate-600/60 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700/40"
        >
          ← بازگشت به کاربران
        </Link>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="py-16 text-center text-slate-400">در حال بارگذاری…</div>
      )}

      {user && stats && (
        <>
          {/* Profile header */}
          <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-700/60 bg-slate-800/50 p-5">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-violet-500/20 text-2xl font-bold text-violet-300">
              {(user.full_name || user.username).slice(0, 1)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-bold text-white">
                {user.full_name || user.username}
              </p>
              <p className="text-sm text-slate-400" dir="ltr">
                @{user.username}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                <span className="rounded-full bg-violet-500/15 px-2.5 py-1 font-medium text-violet-300">
                  {roleLabel}
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 font-medium ${
                    user.is_active
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-red-500/15 text-red-300"
                  }`}
                >
                  {user.is_active ? "فعال" : "غیرفعال"}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-1 text-xs text-slate-400 sm:text-left">
              <p>عضویت از: {faDate(user.date_joined)}</p>
              <p>آخرین ورود: {faDateTime(user.last_login)}</p>
              <p>آخرین فعالیت: {faDateTime(user.last_activity)}</p>
            </div>
          </section>

          {/* Range selector */}
          <div className="flex flex-wrap gap-2">
            {RANGES.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setRange(item.key)}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition ${
                  range === item.key
                    ? "bg-violet-600 text-white"
                    : "border border-slate-600/60 text-slate-300 hover:bg-slate-700/40"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Stat cards */}
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              {
                icon: "🧾",
                label: "فاکتورهای صادرشده",
                value: faNum(stats.invoices_issued),
                sub: faMoney(stats.invoices_total),
              },
              {
                icon: "💳",
                label: "دریافتی‌های ثبت‌شده",
                value: faNum(stats.payments_recorded),
                sub: faMoney(stats.payments_total),
              },
              {
                icon: "✏️",
                label: "درخواست‌های ویرایش",
                value: faNum(stats.edit_requests),
                sub: `${faNum(stats.edit_requests_approved)} تأییدشده`,
              },
              {
                icon: "📋",
                label: "رویدادهای ثبت‌شده",
                value: faNum(stats.activity_events),
                sub: "در گزارش حسابرسی",
              },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-2xl border border-slate-700/60 bg-slate-800/50 p-4"
              >
                <p className="text-lg" aria-hidden="true">
                  {card.icon}
                </p>
                <p className="mt-1 text-2xl font-bold text-white">
                  {card.value}
                </p>
                <p className="text-xs text-slate-400">{card.label}</p>
                <p className="mt-1 text-[11px] text-slate-500">{card.sub}</p>
              </div>
            ))}
          </section>

          {/* Monthly series */}
          <section className="rounded-2xl border border-slate-700/60 bg-slate-800/50 p-5">
            <h2 className="mb-4 text-sm font-bold text-white">
              فاکتورهای صادرشده در ۶ ماه اخیر
            </h2>
            <div className="flex items-end justify-between gap-3" dir="ltr">
              {data.monthly_series.map((month) => (
                <div
                  key={month.label}
                  className="flex flex-1 flex-col items-center gap-2"
                >
                  <span className="text-xs font-semibold text-slate-200">
                    {faNum(month.count)}
                  </span>
                  <div
                    className="w-full max-w-14 rounded-t-lg bg-gradient-to-t from-violet-600/70 to-violet-400/70"
                    style={{
                      height: `${Math.max(6, (month.count / maxCount) * 110)}px`,
                    }}
                    title={faMoney(month.total)}
                  />
                  <span className="text-center text-[10px] leading-tight text-slate-400">
                    {month.label}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Recent invoices */}
            <section className="rounded-2xl border border-slate-700/60 bg-slate-800/50 p-5">
              <h2 className="mb-3 text-sm font-bold text-white">
                آخرین فاکتورهای صادرشده
              </h2>
              {data.recent_invoices.length === 0 ? (
                <p className="text-sm text-slate-500">فاکتوری ثبت نشده است.</p>
              ) : (
                <ul className="divide-y divide-slate-700/50">
                  {data.recent_invoices.map((invoice) => (
                    <li
                      key={invoice.id}
                      className="flex items-center justify-between gap-3 py-2.5 text-sm"
                    >
                      <div className="min-w-0">
                        <Link
                          to={`/invoices/${invoice.id}`}
                          className="font-semibold text-blue-300 hover:underline"
                        >
                          {invoice.invoice_number}
                        </Link>
                        <p className="truncate text-xs text-slate-400">
                          {invoice.customer_name || "—"} -{" "}
                          {faDate(invoice.date)}
                        </p>
                      </div>
                      <span className="shrink-0 text-slate-200">
                        {faMoney(invoice.total_amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Recent payments */}
            <section className="rounded-2xl border border-slate-700/60 bg-slate-800/50 p-5">
              <h2 className="mb-3 text-sm font-bold text-white">
                آخرین دریافتی‌های ثبت‌شده
              </h2>
              {data.recent_payments.length === 0 ? (
                <p className="text-sm text-slate-500">
                  دریافتی‌ای ثبت نشده است.
                </p>
              ) : (
                <ul className="divide-y divide-slate-700/50">
                  {data.recent_payments.map((payment) => (
                    <li
                      key={payment.id}
                      className="flex items-center justify-between gap-3 py-2.5 text-sm"
                    >
                      <div className="min-w-0">
                        <Link
                          to={`/invoices/${payment.invoice_id}`}
                          className="font-semibold text-blue-300 hover:underline"
                        >
                          {payment.invoice_number}
                        </Link>
                        <p className="text-xs text-slate-400">
                          {METHOD_LABELS[payment.method] || payment.method} -{" "}
                          {faDate(payment.paid_at)}
                        </p>
                      </div>
                      <span className="shrink-0 text-slate-200">
                        {faMoney(payment.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
