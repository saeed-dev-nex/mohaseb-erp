import React, { useCallback, useEffect, useState } from "react";
import {
  assetsAPI,
  type DepreciationRun,
  type FixedAsset,
} from "../services/api";
import { useBusiness } from "../lib/business";
import JalaliDatePicker from "../components/JalaliDatePicker";
import { toJalali } from "../utils/persian";
import { Button, EmptyState, Spinner } from "../components/ui";
import { Section } from "../components/FormSection";

const fmt = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("fa-IR").format(Number(n) || 0);

const inp =
  "w-full px-3 py-2.5 bg-slate-700/50 border border-slate-600/50 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all";

const MONTHS = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

const CATEGORIES = [
  ["land", "زمین"],
  ["building", "ساختمان"],
  ["machinery", "ماشین‌آلات"],
  ["vehicle", "وسایل نقلیه"],
  ["equipment", "تجهیزات و اثاثه"],
  ["software", "نرم‌افزار"],
  ["other", "سایر"],
] as const;

export default function AssetsPage() {
  const { current } = useBusiness();
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [runs, setRuns] = useState<DepreciationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    code: "",
    name: "",
    category: "equipment",
    purchase_date: new Date().toISOString().slice(0, 10),
    cost: "",
    salvage_value: "",
    useful_life_years: 5,
  });
  const [runForm, setRunForm] = useState({ year: 1405, month: 1 });

  const load = useCallback(async () => {
    if (!current) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [assetsRes, runsRes] = await Promise.all([
        assetsAPI.list(),
        assetsAPI.runs(),
      ]);
      setAssets(assetsRes.data);
      const rdata = runsRes.data as unknown as
        DepreciationRun[] | { results: DepreciationRun[] };
      setRuns(Array.isArray(rdata) ? rdata : rdata.results);
    } catch {
      setMessage("خطا در دریافت دارایی‌ها");
    } finally {
      setLoading(false);
    }
  }, [current]);

  useEffect(() => {
    load();
  }, [load]);

  const createAsset = async () => {
    if (!form.code || !form.name || !form.cost) return;
    try {
      await assetsAPI.create({
        code: form.code,
        name: form.name,
        category: form.category,
        purchase_date: form.purchase_date,
        cost: Number(form.cost) || 0,
        salvage_value: Number(form.salvage_value) || 0,
        useful_life_years: form.useful_life_years,
      });
      setForm({
        code: "",
        name: "",
        category: "equipment",
        purchase_date: new Date().toISOString().slice(0, 10),
        cost: "",
        salvage_value: "",
        useful_life_years: 5,
      });
      setMessage("دارایی ثبت شد.");
      load();
    } catch {
      setMessage("خطا در ثبت دارایی (کد تکراری؟)");
    }
  };

  const runDepreciation = async () => {
    try {
      const res = await assetsAPI.run(runForm);
      setMessage(
        `استهلاک ${MONTHS[runForm.month - 1]} ${fmt(runForm.year)} ثبت شد: ${fmt(res.data.total_amount)}`,
      );
      load();
    } catch {
      setMessage("خطا در ثبت استهلاک (این ماه قبلاً ثبت شده؟)");
    }
  };

  const deleteRun = async (run: DepreciationRun) => {
    try {
      await assetsAPI.deleteRun(run.id);
      setMessage("اجرای استهلاک برگردانده شد.");
      load();
    } catch {
      setMessage("خطا در برگرداندن اجرا");
    }
  };

  if (!current) {
    return (
      <EmptyState
        icon="🏢"
        title="کسب‌وکاری انتخاب نشده است"
        description="برای کار با دارایی‌ها، ابتدا از نوبار یک کسب‌وکار انتخاب کنید."
      />
    );
  }
  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-white">
        دارایی‌های ثابت — {current.name}
      </h1>
      {message && (
        <p
          className={`text-sm rounded-xl px-3 py-2 border ${
            message.startsWith("خطا")
              ? "text-rose-300 bg-rose-500/10 border-rose-500/20"
              : "text-emerald-300 bg-emerald-500/10 border-emerald-500/20"
          }`}
        >
          {message}
        </p>
      )}

      <Section title="دارایی‌ها" icon="🏢">
        <div className="overflow-x-auto mb-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-right border-b border-slate-700">
                <th className="py-2 px-2">کد</th>
                <th className="py-2 px-2">نام</th>
                <th className="py-2 px-2">گروه</th>
                <th className="py-2 px-2">تاریخ خرید</th>
                <th className="py-2 px-2">بهای تمام‌شده</th>
                <th className="py-2 px-2">استهلاک ماهانه</th>
                <th className="py-2 px-2">استهلاک انباشته</th>
                <th className="py-2 px-2">ارزش دفتری</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-slate-800 text-slate-200"
                >
                  <td className="py-2 px-2 font-mono text-slate-400">
                    {a.code}
                  </td>
                  <td className="py-2 px-2">{a.name}</td>
                  <td className="py-2 px-2">{a.category_display}</td>
                  <td className="py-2 px-2">{toJalali(a.purchase_date)}</td>
                  <td className="py-2 px-2">{fmt(a.cost)}</td>
                  <td className="py-2 px-2">{fmt(a.monthly_depreciation)}</td>
                  <td className="py-2 px-2">
                    {fmt(a.accumulated_depreciation)}
                  </td>
                  <td className="py-2 px-2">{fmt(a.book_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid sm:grid-cols-4 gap-2 items-end">
          <input
            className={inp}
            placeholder="کد دارایی"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
          <input
            className={inp}
            placeholder="نام دارایی"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <select
            className={inp}
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          >
            {CATEGORIES.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              تاریخ خرید
            </label>
            <JalaliDatePicker
              value={form.purchase_date}
              onChange={(v) => setForm({ ...form, purchase_date: v })}
            />
          </div>
          <input
            className={inp}
            placeholder="بهای تمام‌شده"
            inputMode="numeric"
            value={form.cost}
            onChange={(e) =>
              setForm({ ...form, cost: e.target.value.replace(/[^0-9]/g, "") })
            }
          />
          <input
            className={inp}
            placeholder="ارزش اسقاط"
            inputMode="numeric"
            value={form.salvage_value}
            onChange={(e) =>
              setForm({
                ...form,
                salvage_value: e.target.value.replace(/[^0-9]/g, ""),
              })
            }
          />
          <input
            className={inp}
            type="number"
            min={1}
            placeholder="عمر مفید (سال)"
            value={form.useful_life_years}
            onChange={(e) =>
              setForm({
                ...form,
                useful_life_years: Number(e.target.value) || 1,
              })
            }
          />
          <Button type="button" variant="primary" onClick={createAsset}>
            ثبت دارایی
          </Button>
        </div>
        <p className="text-xs text-slate-500 mt-3">
          استهلاک خط مستقیم از ماه بعد از خرید شروع می‌شود؛ زمین معمولاً با عمر
          مفید بالا و ارزش اسقاط برابر بها ثبت می‌شود تا عملاً مستهلک نشود.
        </p>
      </Section>

      <Section title="اجراهای استهلاک" icon="📉">
        <div className="flex flex-wrap gap-2 items-end mb-4">
          <input
            className={`${inp} w-28`}
            type="number"
            value={runForm.year}
            onChange={(e) =>
              setRunForm({ ...runForm, year: Number(e.target.value) || 1405 })
            }
          />
          <select
            className={`${inp} w-36`}
            value={runForm.month}
            onChange={(e) =>
              setRunForm({ ...runForm, month: Number(e.target.value) })
            }
          >
            {MONTHS.map((name, i) => (
              <option key={i + 1} value={i + 1}>
                {name}
              </option>
            ))}
          </select>
          <Button type="button" variant="primary" onClick={runDepreciation}>
            ثبت استهلاک این ماه + سند
          </Button>
        </div>
        <div className="space-y-2">
          {runs.map((run) => (
            <div
              key={run.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-800/40 px-4 py-3 text-sm"
            >
              <span className="text-white font-bold">
                {MONTHS[run.month - 1]} {fmt(run.year)}
              </span>
              <span className="text-slate-300">
                جمع: {fmt(run.total_amount)}
              </span>
              <span className="text-slate-400">
                {fmt(run.lines.length)} دارایی
              </span>
              {run.journal_entry && (
                <span className="text-slate-500">سند حسابداری ثبت شد</span>
              )}
              <button
                type="button"
                className="text-rose-300 text-xs mr-auto"
                onClick={() => deleteRun(run)}
              >
                برگرداندن اجرا
              </button>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
