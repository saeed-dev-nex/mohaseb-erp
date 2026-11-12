import React, { useCallback, useEffect, useState } from "react";
import {
  invoicesAPI,
  taxAPI,
  type MoadianSubmission,
  type SeasonalRow,
  type VatReport,
} from "../services/api";
import { useBusiness } from "../lib/business";
import { Button, EmptyState, Spinner } from "../components/ui";
import { Section } from "../components/FormSection";

const fmt = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("fa-IR").format(Number(n) || 0);

const inp =
  "w-full px-3 py-2.5 bg-slate-700/50 border border-slate-600/50 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all";

const SEASONS = ["بهار", "تابستان", "پاییز", "زمستان"];
type Tab = "vat" | "seasonal" | "moadian";

export default function TaxPage() {
  const { current } = useBusiness();
  const [tab, setTab] = useState<Tab>("vat");
  const [year, setYear] = useState(1405);
  const [season, setSeason] = useState(1);
  const [vat, setVat] = useState<VatReport | null>(null);
  const [seasonalRows, setSeasonalRows] = useState<SeasonalRow[]>([]);
  const [submissions, setSubmissions] = useState<MoadianSubmission[]>([]);
  const [recentInvoices, setRecentInvoices] = useState<
    { id: number; invoice_number: string; customer_name: string }[]
  >([]);
  const [settings, setSettings] = useState({
    vat_rate: "10",
    economic_code: "",
  });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const loadSettings = useCallback(async () => {
    if (!current) return;
    try {
      const res = await taxAPI.settings();
      const data = res.data as unknown as {
        vat_rate: number;
        economic_code: string;
      };
      setSettings({
        vat_rate: String(data.vat_rate),
        economic_code: data.economic_code || "",
      });
    } catch {
      /* settings are optional for reports */
    }
  }, [current]);

  useEffect(() => {
    setLoading(false);
    loadSettings();
  }, [loadSettings]);

  const loadVat = async () => {
    try {
      const res = await taxAPI.vatReport(year, season);
      setVat(res.data);
    } catch {
      setMessage("خطا در دریافت گزارش ارزش افزوده");
    }
  };

  const loadSeasonal = async () => {
    try {
      const res = await taxAPI.seasonal(year, season);
      setSeasonalRows(res.data.rows);
    } catch {
      setMessage("خطا در دریافت معاملات فصلی");
    }
  };

  const loadMoadian = async () => {
    try {
      const [subsRes, invoicesRes] = await Promise.all([
        taxAPI.submissions(),
        invoicesAPI.list(),
      ]);
      const sdata = subsRes.data as unknown as
        MoadianSubmission[] | { results: MoadianSubmission[] };
      setSubmissions(Array.isArray(sdata) ? sdata : sdata.results);
      const idata = invoicesRes.data as unknown as {
        results: {
          id: number;
          invoice_number: string;
          customer_name: string;
        }[];
      };
      setRecentInvoices((idata.results || []).slice(0, 30));
    } catch {
      setMessage("خطا در دریافت صف مؤدیان");
    }
  };

  const saveSettings = async () => {
    try {
      await taxAPI.updateSettings({
        vat_rate: Number(settings.vat_rate) || 10,
        economic_code: settings.economic_code,
      });
      setMessage("تنظیمات مالیاتی ذخیره شد.");
    } catch {
      setMessage("خطا در ذخیرهٔ تنظیمات");
    }
  };

  const downloadSeasonalCsv = async () => {
    try {
      const res = await taxAPI.seasonalCsv(year, season);
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `seasonal-${year}-s${season}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setMessage("خطا در دریافت فایل معاملات فصلی");
    }
  };

  if (!current) {
    return (
      <EmptyState
        icon="🧾"
        title="کسب‌وکاری انتخاب نشده است"
        description="برای کار با مالیات، ابتدا از نوبار یک کسب‌وکار انتخاب کنید."
      />
    );
  }
  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-white">
          مالیات — {current.name}
        </h1>
        <div className="flex gap-2">
          {(
            [
              ["vat", "ارزش افزوده"],
              ["seasonal", "معاملات فصلی"],
              ["moadian", "سامانه مؤدیان"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setTab(key);
                if (key === "moadian") loadMoadian();
              }}
              className={`px-4 py-2 rounded-xl text-sm transition-all ${
                tab === key
                  ? "bg-blue-600 text-white"
                  : "bg-slate-700/60 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {message && (
        <p className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2">
          {message}
        </p>
      )}

      <Section title="تنظیمات و دوره" icon="⚙️">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              نرخ ارزش افزوده (٪)
            </label>
            <input
              className={`${inp} w-28`}
              value={settings.vat_rate}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  vat_rate: e.target.value.replace(/[^0-9.]/g, ""),
                })
              }
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              کد اقتصادی
            </label>
            <input
              className={`${inp} w-44`}
              value={settings.economic_code}
              onChange={(e) =>
                setSettings({ ...settings, economic_code: e.target.value })
              }
            />
          </div>
          <Button type="button" variant="outline" onClick={saveSettings}>
            ذخیره تنظیمات
          </Button>
          <div className="mr-auto flex gap-2 items-end">
            <div>
              <label className="block text-xs text-slate-400 mb-1">سال</label>
              <input
                className={`${inp} w-24`}
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value) || 1405)}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">فصل</label>
              <select
                className={`${inp} w-32`}
                value={season}
                onChange={(e) => setSeason(Number(e.target.value))}
              >
                {SEASONS.map((name, i) => (
                  <option key={i + 1} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </Section>

      {tab === "vat" && (
        <Section title="گزارش دوره‌ای ارزش افزوده" icon="🧾">
          <div className="flex justify-end mb-4">
            <Button type="button" variant="primary" onClick={loadVat}>
              محاسبهٔ گزارش فصل
            </Button>
          </div>
          {vat && (
            <div className="grid sm:grid-cols-2 gap-4 text-sm">
              <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 p-4 space-y-2">
                <h3 className="text-white font-bold">فروش (خروجی)</h3>
                <p className="text-slate-300">
                  تعداد فاکتور: {fmt(vat.sales_count)}
                </p>
                <p className="text-slate-300">
                  مبنای فروش: {fmt(vat.sales_base)}
                </p>
                <p className="text-slate-300">
                  مالیات دریافتی: {fmt(vat.output_vat)}
                </p>
              </div>
              <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 p-4 space-y-2">
                <h3 className="text-white font-bold">خرید (ورودی)</h3>
                <p className="text-slate-300">
                  تعداد خرید ثبت‌شده: {fmt(vat.purchases_count)}
                </p>
                <p className="text-slate-300">
                  مبنای خرید: {fmt(vat.purchases_base)}
                </p>
                <p className="text-slate-300">
                  مالیات پرداختی: {fmt(vat.input_vat)}
                </p>
              </div>
              <div className="sm:col-span-2 rounded-xl border border-blue-500/30 bg-blue-500/10 p-4">
                <span className="text-white font-bold">
                  {vat.payable >= 0
                    ? "ماندهٔ قابل پرداخت به سازمان: "
                    : "بستانکاری از سازمان: "}
                  {fmt(Math.abs(vat.payable))}
                </span>
              </div>
            </div>
          )}
        </Section>
      )}

      {tab === "seasonal" && (
        <Section title="معاملات فصلی (مادهٔ ۱۶۹)" icon="🗂️">
          <div className="flex justify-end gap-2 mb-4">
            <Button
              type="button"
              variant="outline"
              onClick={downloadSeasonalCsv}
            >
              دانلود CSV
            </Button>
            <Button type="button" variant="primary" onClick={loadSeasonal}>
              محاسبهٔ معاملات فصل
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 text-right border-b border-slate-700">
                  <th className="py-2 px-2">طرف حساب</th>
                  <th className="py-2 px-2">شناسه ملی</th>
                  <th className="py-2 px-2">نوع</th>
                  <th className="py-2 px-2">تعداد</th>
                  <th className="py-2 px-2">مبلغ معامله</th>
                  <th className="py-2 px-2">ارزش افزوده</th>
                </tr>
              </thead>
              <tbody>
                {seasonalRows.map((row, i) => (
                  <tr
                    key={i}
                    className="border-b border-slate-800 text-slate-200"
                  >
                    <td className="py-2 px-2">{row.party_name}</td>
                    <td className="py-2 px-2">{row.national_id || "—"}</td>
                    <td className="py-2 px-2">
                      {row.side === "sale" ? "فروش" : "خرید"}
                    </td>
                    <td className="py-2 px-2">{fmt(row.count)}</td>
                    <td className="py-2 px-2">{fmt(row.amount)}</td>
                    <td className="py-2 px-2">{fmt(row.vat)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {tab === "moadian" && (
        <Section title="صف ارسال به سامانهٔ مؤدیان" icon="📤">
          <p className="text-xs text-slate-500 mb-4">
            اتصال زنده به سامانهٔ مؤدیان نیازمند انتخاب سرویس‌دهنده و کلید
            امضاست و هنوز فعال نیست؛ اینجا فاکتورها در صف قرار می‌گیرند و وضعیت
            ارسال (شناسهٔ یکتا و پاسخ سامانه) دستی ثبت می‌شود.
          </p>
          <div className="space-y-2 mb-5">
            {submissions.map((sub) => (
              <div
                key={sub.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-800/40 px-4 py-3 text-sm"
              >
                <span className="text-white">{sub.invoice_number}</span>
                <span className="text-slate-400">{sub.customer_name}</span>
                <span
                  className={
                    sub.status === "sent"
                      ? "text-emerald-300"
                      : sub.status === "failed"
                        ? "text-rose-300"
                        : "text-amber-300"
                  }
                >
                  {sub.status_display}
                </span>
                <span className="text-slate-500 text-xs font-mono">
                  {sub.unique_id}
                </span>
                <span className="flex gap-2 text-xs mr-auto">
                  {sub.status !== "sent" && (
                    <button
                      type="button"
                      className="text-emerald-300"
                      onClick={() => taxAPI.markSent(sub.id).then(loadMoadian)}
                    >
                      ثبت ارسال موفق
                    </button>
                  )}
                  {sub.status === "queued" && (
                    <button
                      type="button"
                      className="text-rose-300"
                      onClick={() =>
                        taxAPI.markFailed(sub.id).then(loadMoadian)
                      }
                    >
                      ثبت ناموفق
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
          <h3 className="text-sm text-white font-bold mb-2">
            افزودن فاکتور به صف
          </h3>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {recentInvoices.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center gap-3 text-sm text-slate-300 py-1"
              >
                <span>{inv.invoice_number}</span>
                <span className="text-slate-500">{inv.customer_name}</span>
                <button
                  type="button"
                  className="text-blue-300 text-xs"
                  onClick={() => taxAPI.queue(inv.id).then(loadMoadian)}
                >
                  + افزودن به صف
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
