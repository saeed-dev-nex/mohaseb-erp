import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { invoicesAPI } from "../services/api";
import { hideWaiting, showWaiting } from "../lib/waiting";
import JalaliDatePicker from "../components/JalaliDatePicker";
import { Button, StatCard } from "../components/ui";
import { jalaliMonthStartISO, jalaliPrevMonthRangeISO } from "../utils/persian";

const fmt = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("fa-IR").format(Number(n) || 0) + " تومان";
const fmtN = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("fa-IR").format(Number(n) || 0);

const persianDate = (d: string | null | undefined): string => {
  if (!d) return "---";
  try {
    return new Intl.DateTimeFormat("fa-IR").format(new Date(d));
  } catch {
    return d;
  }
};

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft: {
    label: "پیش‌نویس",
    color: "text-slate-300 bg-slate-500/20 border-slate-500/30",
  },
  pending: {
    label: "پرداخت نشده",
    color: "text-yellow-300 bg-yellow-500/20 border-yellow-500/30",
  },
  paid: {
    label: "پرداخت شده",
    color: "text-green-300 bg-green-500/20 border-green-500/30",
  },
  cancelled: {
    label: "لغو شده",
    color: "text-red-300 bg-red-500/20 border-red-500/30",
  },
};

type ReportInvoice = {
  id: number;
  invoice_number: string;
  customer_name: string;
  date: string;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  commission_total: number;
  status: string;
  paid_by_name?: string | null;
  operator_name?: string | null;
};

type OverdueInvoice = {
  id: number;
  invoice_number: string;
  customer_name: string;
  due_date: string;
  remaining_amount?: number | null;
  total_amount: number;
};

type ReportData = {
  total_revenue: number;
  pending_amount: number;
  invoice_amount: number;
  total_count: number;
  expense_total: number;
  net_profit: number | string;
  by_status?: Record<string, { count: number; amount: number }>;
  monthly?: { month: string; label?: string; received: number | string }[];
  expense_categories?: { name: string; amount: number }[];
  top_customers?: { name: string; count: number; amount: number }[];
  top_services?: { name: string; amount: number }[];
  payment_methods?: { name: string; amount: number }[];
  invoices?: ReportInvoice[];
};

const Reports = () => {
  const today = new Date().toISOString().slice(0, 10);
  // "This month" is the current JALALI month (e.g. آبان starts Oct 23),
  // not the Gregorian one — the whole app runs on Shamsi dates.
  const firstOfMonth = jalaliMonthStartISO();
  const prevMonth = jalaliPrevMonthRangeISO();

  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(today);
  const [statusFilter, setStatusFilter] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [report, setReport] = useState<ReportData | null>(null);
  const [overdue, setOverdue] = useState<OverdueInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("summary"); // summary | invoices | overdue
  const [exporting, setExporting] = useState(false);

  const loadReport = async () => {
    setLoading(true);
    try {
      const [repRes, ovRes] = await Promise.all([
        invoicesAPI.report({
          date_from: dateFrom,
          date_to: dateTo,
          status: statusFilter,
          customer_name: customerSearch,
        }),
        invoicesAPI.overdue(),
      ]);
      setReport(repRes.data);
      setOverdue(ovRes.data);
    } finally {
      setLoading(false);
    }
  };

  const downloadExcel = async () => {
    setExporting(true);
    showWaiting("در حال آماده‌سازی گزارش Excel…");
    try {
      const { data } = await invoicesAPI.exportExcel({
        date_from: dateFrom,
        date_to: dateTo,
        status: statusFilter,
        customer_name: customerSearch,
      });
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `financial_report_${dateFrom}_${dateTo}.xlsx`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      alert("خطا در دریافت فایل اکسل");
    } finally {
      setExporting(false);
      hideWaiting();
    }
  };

  useEffect(() => {
    loadReport();
    window.addEventListener("mohaseb:data-changed", loadReport);
    return () => window.removeEventListener("mohaseb:data-changed", loadReport);
  }, [dateFrom, dateTo, statusFilter, customerSearch]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">📈 گزارشات مالی</h2>
          <p className="text-slate-400 text-sm mt-1">
            تحلیل و گزارش‌گیری از عملکرد مالی
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={downloadExcel}
            disabled={exporting}
            className="px-4 py-2.5 rounded-xl bg-emerald-600/20 border border-emerald-500/30 hover:bg-emerald-600/30 text-emerald-400 text-sm transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {exporting ? "در حال آماده‌سازی…" : "📊 دریافت گزارش Excel"}
          </button>
          <button
            onClick={async () => {
              showWaiting("در حال آماده‌سازی خروجی CSV…");
              try {
                const { data } = await invoicesAPI.exportCsv({
                  date_from: dateFrom,
                  date_to: dateTo,
                  status: statusFilter,
                  customer_name: customerSearch,
                });
                const url = URL.createObjectURL(data);
                const a = document.createElement("a");
                a.href = url;
                a.download = `invoices_${dateFrom}_${dateTo}.csv`;
                a.click();
                window.setTimeout(() => URL.revokeObjectURL(url), 1000);
              } catch {
                alert("خطا در دانلود");
              } finally {
                hideWaiting();
              }
            }}
            className="px-4 py-2.5 rounded-xl bg-emerald-600/20 border border-emerald-500/30 hover:bg-emerald-600/30 text-emerald-400 text-sm transition-all flex items-center gap-2"
          >
            📄 خروجی CSV
          </button>
        </div>
      </div>

      {/* Date Filter */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <label className="space-y-1.5">
            <span className="text-xs text-slate-400">وضعیت فاکتور</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white"
            >
              <option value="">همه وضعیت‌ها</option>
              {Object.entries(STATUS_MAP).map(([value, item]) => (
                <option key={value} value={value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs text-slate-400">مشتری</span>
            <input
              type="search"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              placeholder="جستجو بر اساس نام مشتری"
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500"
            />
          </label>
        </div>
        <div className="flex flex-col sm:flex-row items-end gap-4">
          <div className="space-y-1.5 flex-1">
            <label className="text-xs text-slate-400">از تاریخ</label>
            <JalaliDatePicker
              value={dateFrom}
              onChange={(v) => setDateFrom(v)}
            />
          </div>
          <div className="space-y-1.5 flex-1">
            <label className="text-xs text-slate-400">تا تاریخ</label>
            <JalaliDatePicker value={dateTo} onChange={(v) => setDateTo(v)} />
          </div>

          <div className="flex gap-2 flex-wrap">
            {[
              { label: "امروز", f: today, t: today },
              { label: "این ماه", f: firstOfMonth, t: today },
              {
                label: "ماه گذشته",
                f: prevMonth.from,
                t: prevMonth.to,
              },
              { label: "همه", f: "2020-01-01", t: today },
            ].map((q) => (
              <button
                key={q.label}
                onClick={() => {
                  setDateFrom(q.f);
                  setDateTo(q.t);
                }}
                className="px-3 py-2 text-xs rounded-xl border border-slate-600 text-slate-400 hover:bg-slate-700 hover:text-white transition-all"
              >
                {q.label}
              </button>
            ))}
            <Button variant="primary" onClick={loadReport} loading={loading}>
              {!loading && "🔍"} نمایش گزارش
            </Button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      {report && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard
            icon="💳"
            label="مبلغ دریافت‌شده"
            value={fmt(report.total_revenue)}
            color="green"
          />
          <StatCard
            icon="🟡"
            label="مانده فاکتورهای پرداخت‌نشده"
            value={fmt(report.pending_amount)}
            color="yellow"
          />
          <StatCard
            icon="🧾"
            label="ارزش فاکتورها"
            value={fmt(report.invoice_amount)}
            color="purple"
          />
          <StatCard
            icon="📋"
            label="تعداد فاکتور"
            value={fmtN(report.total_count)}
            color="blue"
          />
          <StatCard
            icon="💸"
            label="کل هزینه‌ها"
            value={fmt(report.expense_total)}
            color="red"
          />
          <StatCard
            icon="📈"
            label="سود خالص (کارمزد − هزینه)"
            value={fmt(report.net_profit)}
            color={Number(report.net_profit) >= 0 ? "green" : "red"}
          />
        </div>
      )}

      {/* Status Breakdown */}
      {report && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(STATUS_MAP).map(([key, { label, color }]) => {
            const data = report.by_status?.[key];
            if (!data) return null;
            return (
              <div
                key={key}
                className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4"
              >
                <span
                  className={`text-xs px-2 py-0.5 rounded-full border ${color}`}
                >
                  {label}
                </span>
                <p className="text-white font-bold text-lg mt-2">
                  {fmtN(data.count)}
                </p>
                <p className="text-slate-400 text-xs mt-0.5">
                  {fmt(data.amount)}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {report && tab === "summary" && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <section className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
            <h3 className="font-semibold text-white mb-4">
              روند ماهانه دریافت‌ها
            </h3>
            {report.monthly?.length ? (
              <div className="space-y-3">
                {report.monthly.slice(-12).map((row) => {
                  const max = Math.max(
                    ...(report.monthly ?? []).map(
                      (item) => Number(item.received) || 0,
                    ),
                    1,
                  );
                  return (
                    <div
                      key={row.month}
                      className="grid grid-cols-[5rem_1fr_auto] gap-3 items-center text-xs"
                    >
                      <span className="text-slate-400">
                        {row.label ?? row.month}
                      </span>
                      <div className="h-2 rounded bg-slate-700 overflow-hidden">
                        <div
                          className="h-full rounded bg-emerald-500"
                          style={{
                            width: `${Math.max(2, (Number(row.received) * 100) / max)}%`,
                          }}
                        />
                      </div>
                      <span className="text-slate-200">
                        {fmt(row.received)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-500">در این بازه داده‌ای نیست</p>
            )}
          </section>
          <section className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
            <h3 className="font-semibold text-white mb-4">
              هزینه بر اساس دسته
            </h3>
            {report.expense_categories?.length ? (
              <div className="space-y-3">
                {report.expense_categories.map((row) => (
                  <div
                    key={row.name}
                    className="flex justify-between gap-3 border-b border-slate-700/40 pb-2 text-sm"
                  >
                    <span className="text-slate-300">{row.name}</span>
                    <span className="text-rose-300">{fmt(row.amount)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                هزینه‌ای در این بازه ثبت نشده است
              </p>
            )}
          </section>
          <section className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
            <h3 className="font-semibold text-white mb-4">
              مشتری‌های برتر بر اساس مبلغ فاکتور
            </h3>
            {report.top_customers?.length ? (
              <div className="space-y-3">
                {report.top_customers.map((row, index) => (
                  <div
                    key={`${row.name}-${index}`}
                    className="flex justify-between gap-3 text-sm"
                  >
                    <span className="text-slate-300">
                      {index + 1}. {row.name}{" "}
                      <span className="text-slate-500">
                        ({fmtN(row.count)} فاکتور)
                      </span>
                    </span>
                    <span className="text-blue-300">{fmt(row.amount)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                مشتری‌ای در این بازه ثبت نشده است
              </p>
            )}
          </section>
          <section className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
            <h3 className="font-semibold text-white mb-4">
              خدمات و روش‌های پرداخت
            </h3>
            <div className="grid sm:grid-cols-2 gap-5">
              <div>
                <p className="text-xs text-slate-500 mb-2">خدمات پرفروش</p>
                {report.top_services?.slice(0, 5).map((row) => (
                  <div
                    key={row.name}
                    className="flex justify-between gap-2 text-xs py-1.5"
                  >
                    <span className="text-slate-300">{row.name}</span>
                    <span className="text-amber-300">{fmt(row.amount)}</span>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-2">
                  روش پرداخت ثبت‌شده
                </p>
                {report.payment_methods?.length ? (
                  report.payment_methods.map((row) => (
                    <div
                      key={row.name}
                      className="flex justify-between gap-2 text-xs py-1.5"
                    >
                      <span className="text-slate-300">{row.name}</span>
                      <span className="text-emerald-300">
                        {fmt(row.amount)}
                      </span>
                    </div>
                  ))
                ) : (
                  <span className="text-xs text-slate-500">
                    پرداختی ثبت نشده است
                  </span>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-700/50">
        {[
          { key: "summary", label: "📊 نمای کلی" },
          {
            key: "invoices",
            label: `📋 فاکتورها (${Math.min(report?.total_count || 0, 100)} از ${report?.total_count || 0})`,
          },
          { key: "overdue", label: `⏰ معوقه‌ها (${overdue.length})` },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${
              tab === t.key
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Invoice List */}
      {tab === "invoices" && report && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
          {report.invoices?.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-10">
              فاکتوری در این بازه زمانی یافت نشد
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-700/30 text-slate-400">
                    <th className="text-right py-3.5 px-4 font-medium">
                      شماره
                    </th>
                    <th className="text-right py-3.5 px-4 font-medium">
                      مشتری
                    </th>
                    <th className="text-right py-3.5 px-4 font-medium">
                      تاریخ
                    </th>
                    <th className="text-right py-3.5 px-4 font-medium">مبلغ</th>
                    <th className="text-right py-3.5 px-4 font-medium">
                      پرداخت‌شده
                    </th>
                    <th className="text-right py-3.5 px-4 font-medium">
                      مانده
                    </th>
                    <th className="text-right py-3.5 px-4 font-medium">
                      کارمزد
                    </th>
                    <th className="text-right py-3.5 px-4 font-medium">
                      وضعیت
                    </th>
                    <th className="text-right py-3.5 px-4 font-medium">
                      پرداخت‌کننده
                    </th>
                    <th className="text-right py-3.5 px-4 font-medium">
                      صادرکننده
                    </th>
                    <th className="py-3.5 px-4" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                  {report.invoices.map((inv) => {
                    const st = STATUS_MAP[inv.status] || STATUS_MAP.draft;
                    return (
                      <tr
                        key={inv.id}
                        className="hover:bg-slate-700/20 transition-colors"
                      >
                        <td className="py-3.5 px-4 font-mono text-xs text-blue-400">
                          {inv.invoice_number}
                        </td>
                        <td className="py-3.5 px-4 text-white">
                          {inv.customer_name}
                        </td>
                        <td className="py-3.5 px-4 text-slate-400 text-xs">
                          {persianDate(inv.date)}
                        </td>
                        <td className="py-3.5 px-4 text-white font-medium">
                          {fmt(inv.total_amount)}
                        </td>
                        <td className="py-3.5 px-4 text-emerald-300">
                          {fmt(inv.paid_amount)}
                        </td>
                        <td className="py-3.5 px-4 text-amber-300">
                          {fmt(inv.remaining_amount)}
                        </td>
                        <td className="py-3.5 px-4 text-yellow-400">
                          {Number(inv.commission_total) > 0
                            ? fmt(inv.commission_total)
                            : "—"}
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full border ${st.color}`}
                          >
                            {st.label}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-slate-300">
                          {inv.paid_by_name || "—"}
                        </td>
                        <td className="py-3.5 px-4 text-slate-300">
                          {inv.operator_name || "—"}
                        </td>
                        <td className="py-3.5 px-4">
                          <Link
                            to={`/invoices/${inv.id}`}
                            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                          >
                            مشاهده →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Overdue List */}
      {tab === "overdue" && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
          {overdue.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-3xl mb-2">✅</p>
              <p className="text-slate-300 font-medium">
                هیچ فاکتور معوقه‌ای وجود ندارد
              </p>
              <p className="text-slate-500 text-sm mt-1">
                فاکتورهایی که سررسیدشان گذشته اینجا نشان داده می‌شوند
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-red-500/10 text-slate-400">
                    <th className="text-right py-3.5 px-4 font-medium">
                      شماره
                    </th>
                    <th className="text-right py-3.5 px-4 font-medium">
                      مشتری
                    </th>
                    <th className="text-right py-3.5 px-4 font-medium text-red-400">
                      سررسید
                    </th>
                    <th className="text-right py-3.5 px-4 font-medium">
                      مانده
                    </th>
                    <th className="py-3.5 px-4" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                  {overdue.map((inv) => {
                    const daysLate = Math.floor(
                      (Date.now() - new Date(inv.due_date).getTime()) /
                        86400000,
                    );
                    return (
                      <tr
                        key={inv.id}
                        className="hover:bg-red-500/5 transition-colors"
                      >
                        <td className="py-3.5 px-4 font-mono text-xs text-blue-400">
                          {inv.invoice_number}
                        </td>
                        <td className="py-3.5 px-4 text-white">
                          {inv.customer_name}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="text-red-400 text-xs">
                            {persianDate(inv.due_date)}
                          </span>
                          <span className="text-red-500/70 text-xs mr-2">
                            ({daysLate} روز تأخیر)
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-white font-medium">
                          {fmt(inv.remaining_amount ?? inv.total_amount)}
                        </td>
                        <td className="py-3.5 px-4">
                          <Link
                            to={`/invoices/${inv.id}`}
                            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                          >
                            مشاهده →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Reports;
