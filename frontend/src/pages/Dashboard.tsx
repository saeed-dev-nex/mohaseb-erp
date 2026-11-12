import React, { useEffect, useState } from "react";
import { dashboardAPI, invoicesAPI } from "../services/api";
import {
  Button,
  StatCard,
  StatusBadge,
  Spinner,
  formatPrice,
} from "../components/ui";
import { Link } from "react-router-dom";
import { toJalali } from "../utils/persian";

const fmt = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("fa-IR").format(Number(n) || 0);

type MonthData = {
  month?: string;
  label?: string;
  revenue?: number;
  expense?: number;
  profit?: number;
};

type TopServiceItem = {
  service_title_snapshot?: string | null;
  total: number;
  count: number;
};

type OverdueItem = {
  id: number;
  invoice_number: string;
  customer_name: string;
  due_date: string;
  remaining_amount: number;
};

type TopCustomer = {
  customer__name?: string | null;
  total: number;
  count: number;
};

type RecentInvoice = {
  id: number;
  invoice_number: string;
  customer_name: string;
  total_amount: number;
  status: string;
};

type UpcomingCheque = {
  id: number;
  type: string;
  bank_name: string;
  customer_name: string;
  cheque_number: string;
  amount: number;
  due_date: string;
};

type DashboardStats = {
  total_customers: number;
  total_invoices: number;
  total_commission: number;
  pending_invoices: number;
  paid_invoices: number;
  total_expenses: number;
  net_profit: number;
  overdue_invoices: number;
  overdue_amount?: number;
  overdue_items?: OverdueItem[];
  monthly_revenue?: MonthData[];
  top_services?: TopServiceItem[];
  top_customers?: TopCustomer[];
  recent_invoices?: RecentInvoice[];
  upcoming_cheques?: UpcomingCheque[];
};

type ReminderInvoice = {
  id: number;
  invoice_number: string;
  customer_name: string;
  days: number;
  due_date: string;
  remaining_amount: number;
};

type ReminderCheque = {
  id: number;
  cheque_number: string;
  bank_name: string;
  customer_name: string;
  days: number;
  due_date: string;
  amount: number;
};

type DashboardReminders = {
  totals: {
    due_soon_invoices_count: number;
    cheques_due_count: number;
    bounced_cheques_count: number;
    bounced_cheques_amount: number;
  };
  due_soon_invoices: ReminderInvoice[];
  cheques_due: ReminderCheque[];
};

// ── Mini Bar Chart (revenue vs expense) ──
const BarChart = ({ data }: { data: MonthData[] }) => {
  const maxVal = Math.max(
    ...data.map((d) => Math.max(d.revenue || 0, d.expense || 0)),
    1,
  );
  const compactAmount = (value: number) =>
    new Intl.NumberFormat("fa-IR", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value || 0);
  const monthLabel = (month: MonthData) => {
    // The API buckets by Jalali month and sends its Persian label
    // (e.g. «آبان ۱۴۰۵») — it is authoritative; the Intl path below is
    // only a fallback for payloads without a label.
    if (month.label) return month.label;
    const [year, number] = (month.month || "").split("-").map(Number);
    if (!year || !number) return month.label;
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      month: "short",
    }).format(new Date(year, number - 1, 15));
  };
  return (
    <div className="relative">
      <div className="absolute inset-x-0 top-0 bottom-7 flex flex-col justify-between pointer-events-none">
        {[1, 0.66, 0.33, 0].map((tick, index) => (
          <div key={index} className="flex items-center gap-2">
            <span className="w-10 text-left text-[10px] text-slate-500">
              {compactAmount(maxVal * tick)}
            </span>
            <span className="h-px flex-1 border-t border-dashed border-slate-700/70" />
          </div>
        ))}
      </div>
      <div className="relative flex items-end gap-3 h-48 pl-12 pb-7">
        {data.map((month, i) => {
          const revPct = Math.max(((month.revenue || 0) / maxVal) * 100, 2);
          const expPct = Math.max(((month.expense || 0) / maxVal) * 100, 2);
          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center gap-2 group"
            >
              <div
                className="relative w-full flex items-end gap-1"
                style={{ height: "170px" }}
              >
                {/* Tooltip */}
                <div
                  className="absolute -top-10 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity
                bg-slate-700 text-white text-[10px] rounded-lg px-2 py-1.5 whitespace-nowrap z-10 pointer-events-none leading-relaxed"
                >
                  <span className="text-blue-300">
                    درآمد: {fmt(month.revenue)}
                  </span>
                  <br />
                  <span className="text-red-300">
                    هزینه: {fmt(month.expense)}
                  </span>
                  <br />
                  <span className="text-green-300">
                    سود: {fmt(month.profit)}
                  </span>
                </div>
                {/* Revenue bar */}
                <div
                  title={`درآمد ${fmt(month.revenue)}`}
                  className="flex-1 rounded-t-md bg-gradient-to-t from-blue-600 to-indigo-400 group-hover:from-indigo-600 group-hover:to-blue-300 transition-all duration-300"
                  style={{ height: `${revPct}%` }}
                />
                {/* Expense bar */}
                <div
                  title={`هزینه ${fmt(month.expense)}`}
                  className="flex-1 rounded-t-md bg-gradient-to-t from-red-600/60 to-red-400/60 group-hover:from-red-500 group-hover:to-red-300 transition-all duration-300"
                  style={{ height: `${expPct}%` }}
                />
              </div>
              <span className="text-slate-400 text-xs">
                {monthLabel(month)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── Pie Chart (CSS-only donut) ──
const DonutChart = ({
  data,
  total,
}: {
  data: TopServiceItem[];
  total: number;
}) => {
  const colors = [
    "#6366f1",
    "#3b82f6",
    "#10b981",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#ec4899",
  ];
  let cumPct = 0;
  const segments = data.map((item, i) => {
    const pct = total > 0 ? (item.total / total) * 100 : 0;
    const start = cumPct;
    cumPct += pct;
    return { ...item, pct, start, color: colors[i % colors.length] };
  });

  const gradient =
    segments.length > 0
      ? `conic-gradient(${segments.map((s) => `${s.color} ${s.start}% ${s.start + s.pct}%`).join(", ")})`
      : "conic-gradient(#334155 0% 100%)";

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative w-36 h-36">
        <div
          className="w-full h-full rounded-full"
          style={{ background: gradient }}
        />
        <div className="absolute inset-3 rounded-full bg-slate-800 flex items-center justify-center flex-col">
          <span className="text-white font-bold text-sm">
            {segments.length}
          </span>
          <span className="text-slate-500 text-[10px]">خدمت</span>
        </div>
      </div>
      <div className="space-y-1.5 w-full">
        {segments.slice(0, 5).map((s, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: s.color }}
              />
              <span className="text-slate-300 truncate">
                {s.service_title_snapshot || "---"}
              </span>
            </div>
            <span className="text-slate-400 shrink-0">{s.count} بار</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const Dashboard = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [reminders, setReminders] = useState<DashboardReminders | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const refresh = () =>
      dashboardAPI
        .stats()
        .then((res) => setStats(res.data))
        .catch(console.error)
        .finally(() => setLoading(false));
    dashboardAPI
      .reminders(7)
      .then((res) => setReminders(res.data))
      .catch(() => {});
    refresh();
    window.addEventListener("mohaseb:data-changed", refresh);
    return () => window.removeEventListener("mohaseb:data-changed", refresh);
  }, []);

  const handleMarkPaid = async (id: number) => {
    await invoicesAPI.markPaid(id);
    const res = await dashboardAPI.stats();
    setStats(res.data);
  };

  if (loading) return <Spinner size="lg" />;

  const topSvcTotal = (stats?.top_services || []).reduce(
    (a, s) => a + Number(s.total || 0),
    0,
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">📊 داشبورد</h2>
          <p className="text-slate-400 text-sm mt-1">
            خلاصه وضعیت مالی و تحلیلی
          </p>
        </div>
        <Link to="/invoices/new">
          <Button variant="primary">+ فاکتور جدید</Button>
        </Link>
      </div>

      {/* Stats Row 1 */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="کل مشتریان"
          value={fmt(stats?.total_customers || 0)}
          icon="👥"
          color="blue"
        />
        <StatCard
          label="کل فاکتورها"
          value={fmt(stats?.total_invoices || 0)}
          icon="🧾"
          color="purple"
        />
        <StatCard
          label="درآمد خالص (کارمزد)"
          value={formatPrice(stats?.total_commission || 0)}
          icon="💰"
          color="green"
        />
        <StatCard
          label="در انتظار پرداخت"
          value={fmt(stats?.pending_invoices || 0)}
          icon="⏳"
          color="yellow"
          sub={`پرداخت شده: ${fmt(stats?.paid_invoices || 0)}`}
        />
      </div>

      {/* Stats Row 2 — Financial Overview */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20 rounded-2xl p-5">
          <p className="text-emerald-400/80 text-xs mb-1">💼 کل کارمزد</p>
          <p className="text-emerald-400 text-xl font-bold">
            {formatPrice(stats?.total_commission || 0)}
          </p>
        </div>
        <div className="bg-gradient-to-br from-red-500/10 to-red-600/5 border border-red-500/20 rounded-2xl p-5">
          <p className="text-red-400/80 text-xs mb-1">💸 کل هزینه‌ها</p>
          <p className="text-red-400 text-xl font-bold">
            {formatPrice(stats?.total_expenses || 0)}
          </p>
        </div>
        <div
          className={`bg-gradient-to-br border rounded-2xl p-5 ${
            (stats?.net_profit || 0) >= 0
              ? "from-green-500/10 to-green-600/5 border-green-500/20"
              : "from-red-500/10 to-red-600/5 border-red-500/20"
          }`}
        >
          <p
            className={`text-xs mb-1 ${(stats?.net_profit || 0) >= 0 ? "text-green-400/80" : "text-red-400/80"}`}
          >
            📊 سود خالص
          </p>
          <p
            className={`text-xl font-bold ${(stats?.net_profit || 0) >= 0 ? "text-green-400" : "text-red-400"}`}
          >
            {formatPrice(stats?.net_profit || 0)}
          </p>
        </div>
        <div className="bg-gradient-to-br from-orange-500/10 to-orange-600/5 border border-orange-500/20 rounded-2xl p-5">
          <p className="text-orange-400/80 text-xs mb-1">
            ⚠️ فاکتورهای عقب‌افتاده
          </p>
          <p className="text-orange-400 text-xl font-bold">
            {fmt(stats?.overdue_invoices || 0)}
          </p>
        </div>
      </div>

      {stats?.overdue_items?.length > 0 && (
        <section className="rounded-2xl border border-orange-500/25 bg-orange-500/5 p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-orange-500">
                فاکتورهای سررسیدگذشته
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                ماندهٔ کل: {formatPrice(stats.overdue_amount || 0)}
              </p>
            </div>
            <Link
              to="/reports"
              className="text-xs text-blue-400 hover:underline"
            >
              همهٔ معوقات
            </Link>
          </div>
          <div className="divide-y divide-orange-500/10">
            {stats.overdue_items.map((item) => (
              <Link
                key={item.id}
                to={`/invoices/${item.id}`}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm hover:bg-orange-500/5"
              >
                <span className="text-slate-200">
                  {item.invoice_number} · {item.customer_name}
                </span>
                <span className="text-slate-500 text-xs">
                  سررسید {toJalali(item.due_date)}
                </span>
                <span className="font-medium text-orange-500">
                  {formatPrice(item.remaining_amount)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {reminders &&
        (reminders.totals.due_soon_invoices_count > 0 ||
          reminders.totals.cheques_due_count > 0 ||
          reminders.totals.bounced_cheques_count > 0) && (
          <section className="rounded-2xl border border-sky-500/25 bg-sky-500/5 p-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold text-sky-400">
                یادآوری سررسید (۷ روز آینده)
              </h3>
              {reminders.totals.bounced_cheques_count > 0 && (
                <span className="text-xs text-red-400">
                  ⚠️ {fmt(reminders.totals.bounced_cheques_count)} چک برگشتی
                  نیازمند پیگیری (
                  {formatPrice(reminders.totals.bounced_cheques_amount)})
                </span>
              )}
            </div>
            <div className="divide-y divide-sky-500/10">
              {reminders.due_soon_invoices.slice(0, 5).map((item) => (
                <Link
                  key={`inv-${item.id}`}
                  to={`/invoices/${item.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm hover:bg-sky-500/5"
                >
                  <span className="text-slate-200">
                    فاکتور {item.invoice_number} · {item.customer_name}
                  </span>
                  <span className="text-slate-500 text-xs">
                    {fmt(item.days)} روز مانده · {toJalali(item.due_date)}
                  </span>
                  <span className="font-medium text-sky-400">
                    {formatPrice(item.remaining_amount)}
                  </span>
                </Link>
              ))}
              {reminders.cheques_due.slice(0, 5).map((item) => (
                <Link
                  key={`chq-${item.id}`}
                  to="/cheques"
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm hover:bg-sky-500/5"
                >
                  <span className="text-slate-200">
                    چک {item.cheque_number} · {item.bank_name} ·{" "}
                    {item.customer_name}
                  </span>
                  <span className="text-slate-500 text-xs">
                    {fmt(item.days)} روز مانده · {toJalali(item.due_date)}
                  </span>
                  <span className="font-medium text-sky-400">
                    {formatPrice(item.amount)}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Revenue/Expense Chart */}
        <div className="xl:col-span-2 bg-slate-800/50 border border-slate-700/50 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-white font-semibold">
              درآمد و هزینه ۶ ماه گذشته
            </h3>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-blue-500" />
                درآمد
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-red-400/70" />
                هزینه
              </span>
            </div>
          </div>
          {stats?.monthly_revenue ? (
            <BarChart data={stats.monthly_revenue} />
          ) : (
            <div className="h-40 flex items-center justify-center text-slate-500 text-sm">
              داده‌ای موجود نیست
            </div>
          )}
        </div>

        {/* Top Services Donut */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-6">
          <h3 className="text-white font-semibold mb-4">🔧 بیشترین خدمات</h3>
          {(stats?.top_services || []).length > 0 ? (
            <DonutChart data={stats.top_services} total={topSvcTotal} />
          ) : (
            <div className="flex items-center justify-center text-slate-500 text-sm h-48">
              داده‌ای موجود نیست
            </div>
          )}
        </div>
      </div>

      {/* Top Customers + Quick Actions */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Top Customers */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-6 min-w-0 overflow-hidden">
          <h3 className="text-white font-semibold mb-4">🏆 بهترین مشتریان</h3>
          {(stats?.top_customers || []).length > 0 ? (
            <div className="space-y-2">
              {stats.top_customers.map((c, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-2 min-w-0 bg-slate-700/30 rounded-xl p-3"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span
                      className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-xs font-bold
                      ${i === 0 ? "bg-yellow-500/20 text-yellow-400" : i === 1 ? "bg-slate-400/20 text-slate-300" : "bg-orange-500/20 text-orange-400"}`}
                    >
                      {i + 1}
                    </span>
                    <span className="text-white text-sm font-medium truncate min-w-0">
                      {c.customer__name || "---"}
                    </span>
                  </div>
                  <div className="text-left shrink-0 whitespace-nowrap">
                    <p className="text-blue-400 font-semibold text-sm">
                      {formatPrice(c.total)}
                    </p>
                    <p className="text-slate-500 text-xs">{c.count} فاکتور</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-slate-500 text-sm text-center py-8">
              داده‌ای موجود نیست
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-6">
          <h3 className="text-white font-semibold mb-4">دسترسی سریع</h3>
          <div className="grid grid-cols-2 gap-2.5">
            {[
              {
                to: "/invoices/new",
                icon: "➕",
                label: "صدور فاکتور",
                cls: "bg-blue-500/10 border-blue-500/20 text-blue-300 hover:bg-blue-500/20",
              },
              {
                to: "/customers",
                icon: "👤",
                label: "مشتریان",
                cls: "bg-purple-500/10 border-purple-500/20 text-purple-300 hover:bg-purple-500/20",
              },
              {
                to: "/services",
                icon: "⚙️",
                label: "خدمات",
                cls: "bg-green-500/10 border-green-500/20 text-green-300 hover:bg-green-500/20",
              },
              {
                to: "/expenses",
                icon: "💰",
                label: "هزینه‌ها",
                cls: "bg-red-500/10 border-red-500/20 text-red-300 hover:bg-red-500/20",
              },
              {
                to: "/staff",
                icon: "👷",
                label: "پرسنل",
                cls: "bg-indigo-500/10 border-indigo-500/20 text-indigo-300 hover:bg-indigo-500/20",
              },
              {
                to: "/reports",
                icon: "📈",
                label: "گزارشات",
                cls: "bg-yellow-500/10 border-yellow-500/20 text-yellow-300 hover:bg-yellow-500/20",
              },
              {
                to: "/settings",
                icon: "🎨",
                label: "تنظیمات برند",
                cls: "bg-pink-500/10 border-pink-500/20 text-pink-300 hover:bg-pink-500/20",
              },
              {
                to: "/invoices?status=pending",
                icon: "📋",
                label: "فاکتورهای معلق",
                cls: "bg-orange-500/10 border-orange-500/20 text-orange-300 hover:bg-orange-500/20",
              },
            ].map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-sm ${item.cls}`}
              >
                <span className="text-lg">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Invoices + Upcoming Cheques */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Invoices */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-6 min-w-0 overflow-hidden">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-white font-semibold">آخرین فاکتورها</h3>
            <Link
              to="/invoices"
              className="text-blue-400 text-sm hover:text-blue-300 transition-colors"
            >
              مشاهده همه ←
            </Link>
          </div>

          {stats?.recent_invoices?.length > 0 ? (
            <div className="space-y-2">
              {stats.recent_invoices.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between gap-2 min-w-0 p-3 rounded-xl bg-slate-700/30 hover:bg-slate-700/50 transition-all group"
                >
                  <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
                    <span className="text-blue-400 font-mono text-xs bg-blue-500/10 px-2 py-1 rounded-lg shrink-0 whitespace-nowrap">
                      {inv.invoice_number}
                    </span>
                    <span className="text-slate-200 text-sm truncate min-w-0">
                      {inv.customer_name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-4 shrink-0">
                    <span className="text-slate-300 text-sm font-medium whitespace-nowrap">
                      {formatPrice(inv.total_amount)}
                    </span>
                    <StatusBadge status={inv.status} />
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity hidden sm:flex gap-1">
                      <Link
                        to={`/invoices/${inv.id}`}
                        className="text-xs px-2 py-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-600 transition-all"
                      >
                        مشاهده
                      </Link>
                      {inv.status === "pending" && (
                        <button
                          onClick={() => handleMarkPaid(inv.id)}
                          className="text-xs px-2 py-1 rounded-lg text-green-400 hover:bg-green-500/10 transition-all"
                        >
                          پرداخت
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-500 text-sm text-center py-8">
              هنوز فاکتوری ثبت نشده است
            </p>
          )}
        </div>

        {/* Upcoming Cheques */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-6 min-w-0 overflow-hidden">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-white font-semibold">
              🎫 چک‌های سررسید نزدیک (۱۰ روز آینده)
            </h3>
            <Link
              to="/cheques"
              className="text-blue-400 text-sm hover:text-blue-300 transition-colors"
            >
              مشاهده همه ←
            </Link>
          </div>

          {stats?.upcoming_cheques?.length > 0 ? (
            <div className="space-y-2">
              {stats.upcoming_cheques.map((chq) => (
                <div
                  key={chq.id}
                  className="flex items-center justify-between gap-2 min-w-0 p-3 rounded-xl bg-slate-700/30 hover:bg-slate-700/50 transition-all group"
                >
                  <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
                    <span
                      className={`text-xs px-2 py-1 rounded-lg font-medium border shrink-0 whitespace-nowrap ${
                        chq.type === "incoming"
                          ? "bg-blue-500/10 border-blue-500/20 text-blue-400"
                          : "bg-purple-500/10 border-purple-500/20 text-purple-400"
                      }`}
                    >
                      {chq.type === "incoming" ? "دریافتی" : "پرداختی"}
                    </span>
                    <div className="min-w-0">
                      <span className="block text-slate-200 text-sm font-medium truncate">
                        {chq.bank_name} ({chq.customer_name})
                      </span>
                      <span className="block text-[10px] text-slate-500 mt-0.5 font-mono truncate">
                        شماره چک: {chq.cheque_number}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-4 shrink-0">
                    <span className="text-slate-300 text-sm font-medium whitespace-nowrap">
                      {formatPrice(chq.amount)}
                    </span>
                    <span className="text-xs text-yellow-400 font-mono bg-yellow-500/10 px-2 py-1 rounded-lg">
                      {toJalali(chq.due_date)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-500 text-sm text-center py-8">
              چک سررسید نزدیک در ۱۰ روز آینده وجود ندارد
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
