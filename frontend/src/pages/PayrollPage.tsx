import React, { useCallback, useEffect, useState } from "react";
import {
  payrollAPI,
  staffAPI,
  type EmploymentProfile,
  type PayrollPeriod,
  type Payslip,
} from "../services/api";
import { useBusiness } from "../lib/business";
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

type Tab = "employees" | "periods";
type StaffOption = { id: number; name: string };

const emptyProfileForm = {
  staff: "" as number | "",
  personnel_code: "",
  national_id: "",
  insurance_number: "",
  bank_iban: "",
  base_salary: "",
  housing_allowance: "",
  food_allowance: "",
  child_allowance_each: "",
  children_count: 0,
  is_insured: true,
};

export default function PayrollPage() {
  const { current } = useBusiness();
  const [tab, setTab] = useState<Tab>("periods");
  const [profiles, setProfiles] = useState<EmploymentProfile[]>([]);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [profileForm, setProfileForm] = useState(emptyProfileForm);
  const [periodForm, setPeriodForm] = useState({ year: 1405, month: 1 });
  const [selectedPeriod, setSelectedPeriod] = useState<PayrollPeriod | null>(
    null,
  );
  const [slips, setSlips] = useState<Payslip[]>([]);

  const load = useCallback(async () => {
    if (!current) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [profilesRes, periodsRes, staffRes] = await Promise.all([
        payrollAPI.profiles(),
        payrollAPI.periods(),
        staffAPI.list(),
      ]);
      setProfiles(profilesRes.data);
      const pdata = periodsRes.data as unknown as
        PayrollPeriod[] | { results: PayrollPeriod[] };
      setPeriods(Array.isArray(pdata) ? pdata : pdata.results);
      const sdata = staffRes.data as unknown as
        StaffOption[] | { results: StaffOption[] };
      setStaffOptions(Array.isArray(sdata) ? sdata : sdata.results);
    } catch {
      setMessage("خطا در دریافت اطلاعات حقوق");
    } finally {
      setLoading(false);
    }
  }, [current]);

  useEffect(() => {
    load();
  }, [load]);

  const loadSlips = async (period: PayrollPeriod) => {
    setSelectedPeriod(period);
    try {
      const res = await payrollAPI.payslips(period.id);
      setSlips(res.data);
    } catch {
      setMessage("خطا در دریافت فیش‌ها");
    }
  };

  const createProfile = async () => {
    if (profileForm.staff === "") return;
    try {
      await payrollAPI.createProfile({
        staff: profileForm.staff,
        personnel_code: profileForm.personnel_code,
        national_id: profileForm.national_id,
        insurance_number: profileForm.insurance_number,
        bank_iban: profileForm.bank_iban,
        base_salary: Number(profileForm.base_salary) || 0,
        housing_allowance: Number(profileForm.housing_allowance) || 0,
        food_allowance: Number(profileForm.food_allowance) || 0,
        child_allowance_each: Number(profileForm.child_allowance_each) || 0,
        children_count: profileForm.children_count,
        is_insured: profileForm.is_insured,
      });
      setProfileForm(emptyProfileForm);
      setMessage("پروندهٔ استخدامی ساخته شد.");
      load();
    } catch {
      setMessage("خطا در ساخت پرونده (برای این شخص قبلاً پرونده ساخته شده؟)");
    }
  };

  const createPeriod = async () => {
    try {
      await payrollAPI.createPeriod(periodForm);
      setMessage("دوره ساخته شد؛ حالا فیش‌ها را تولید کنید.");
      load();
    } catch {
      setMessage("خطا در ساخت دوره (دورهٔ این ماه قبلاً ساخته شده؟)");
    }
  };

  const actOnPeriod = async (
    period: PayrollPeriod,
    kind: "generate" | "finalize" | "unfinalize" | "delete",
  ) => {
    try {
      if (kind === "generate") await payrollAPI.generate(period.id);
      if (kind === "finalize") await payrollAPI.finalize(period.id);
      if (kind === "unfinalize") await payrollAPI.unfinalize(period.id);
      if (kind === "delete") await payrollAPI.deletePeriod(period.id);
      setMessage("انجام شد.");
      if (kind === "delete" && selectedPeriod?.id === period.id) {
        setSelectedPeriod(null);
        setSlips([]);
      }
      load();
      if (selectedPeriod?.id === period.id && kind !== "delete") {
        const fresh = (await payrollAPI.periods())
          .data as unknown as PayrollPeriod[];
        const updated = fresh.find((p) => p.id === period.id);
        if (updated) loadSlips(updated);
      }
    } catch {
      setMessage("خطا در انجام عملیات روی دوره");
    }
  };

  const patchSlip = async (slip: Payslip, field: string, value: string) => {
    try {
      const res = await payrollAPI.updatePayslip(slip.id, {
        [field]: field === "days_worked" ? Number(value) || 0 : value,
      });
      setSlips(slips.map((s) => (s.id === slip.id ? res.data : s)));
    } catch {
      setMessage("خطا در بازحساب فیش");
    }
  };

  const download = async (
    kind: "bank" | "insurance",
    period: PayrollPeriod,
  ) => {
    try {
      const res =
        kind === "bank"
          ? await payrollAPI.exportBank(period.id)
          : await payrollAPI.exportInsurance(period.id);
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${kind}-${period.year}-${String(period.month).padStart(2, "0")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setMessage("خطا در دریافت خروجی");
    }
  };

  if (!current) {
    return (
      <EmptyState
        icon="💵"
        title="کسب‌وکاری انتخاب نشده است"
        description="برای کار با حقوق و دستمزد، ابتدا از نوبار یک کسب‌وکار انتخاب کنید."
      />
    );
  }
  if (loading) return <Spinner />;

  const editable = selectedPeriod?.status === "draft";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-white">
          حقوق و دستمزد — {current.name}
        </h1>
        <div className="flex gap-2">
          {(
            [
              ["periods", "دوره‌ها و فیش‌ها"],
              ["employees", "پرونده‌های استخدامی"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
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

      {tab === "employees" && (
        <Section title="پرونده‌های استخدامی" icon="🗂️">
          <div className="overflow-x-auto mb-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 text-right border-b border-slate-700">
                  <th className="py-2 px-2">نام</th>
                  <th className="py-2 px-2">کد پرسنلی</th>
                  <th className="py-2 px-2">حقوق پایه</th>
                  <th className="py-2 px-2">مسکن</th>
                  <th className="py-2 px-2">بن</th>
                  <th className="py-2 px-2">اولاد (هر فرزند)</th>
                  <th className="py-2 px-2">فرزند</th>
                  <th className="py-2 px-2">بیمه</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-slate-800 text-slate-200"
                  >
                    <td className="py-2 px-2">{p.staff_name}</td>
                    <td className="py-2 px-2">{p.personnel_code || "—"}</td>
                    <td className="py-2 px-2">{fmt(p.base_salary)}</td>
                    <td className="py-2 px-2">{fmt(p.housing_allowance)}</td>
                    <td className="py-2 px-2">{fmt(p.food_allowance)}</td>
                    <td className="py-2 px-2">{fmt(p.child_allowance_each)}</td>
                    <td className="py-2 px-2">{fmt(p.children_count)}</td>
                    <td className="py-2 px-2">
                      {p.is_insured ? "مشمول" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid sm:grid-cols-3 gap-2">
            <select
              className={inp}
              value={profileForm.staff}
              onChange={(e) =>
                setProfileForm({
                  ...profileForm,
                  staff: e.target.value ? Number(e.target.value) : "",
                })
              }
            >
              <option value="">انتخاب شخص (از پرسنل)…</option>
              {staffOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              className={inp}
              placeholder="کد پرسنلی"
              value={profileForm.personnel_code}
              onChange={(e) =>
                setProfileForm({
                  ...profileForm,
                  personnel_code: e.target.value,
                })
              }
            />
            <input
              className={inp}
              placeholder="کد ملی"
              value={profileForm.national_id}
              onChange={(e) =>
                setProfileForm({ ...profileForm, national_id: e.target.value })
              }
            />
            <input
              className={inp}
              placeholder="شماره بیمه"
              value={profileForm.insurance_number}
              onChange={(e) =>
                setProfileForm({
                  ...profileForm,
                  insurance_number: e.target.value,
                })
              }
            />
            <input
              className={inp}
              placeholder="شماره شبا"
              value={profileForm.bank_iban}
              onChange={(e) =>
                setProfileForm({ ...profileForm, bank_iban: e.target.value })
              }
            />
            <input
              className={inp}
              placeholder="حقوق پایه ماهانه"
              inputMode="numeric"
              value={profileForm.base_salary}
              onChange={(e) =>
                setProfileForm({
                  ...profileForm,
                  base_salary: e.target.value.replace(/[^0-9]/g, ""),
                })
              }
            />
            <input
              className={inp}
              placeholder="حق مسکن"
              inputMode="numeric"
              value={profileForm.housing_allowance}
              onChange={(e) =>
                setProfileForm({
                  ...profileForm,
                  housing_allowance: e.target.value.replace(/[^0-9]/g, ""),
                })
              }
            />
            <input
              className={inp}
              placeholder="بن کارگری"
              inputMode="numeric"
              value={profileForm.food_allowance}
              onChange={(e) =>
                setProfileForm({
                  ...profileForm,
                  food_allowance: e.target.value.replace(/[^0-9]/g, ""),
                })
              }
            />
            <input
              className={inp}
              placeholder="حق اولاد هر فرزند"
              inputMode="numeric"
              value={profileForm.child_allowance_each}
              onChange={(e) =>
                setProfileForm({
                  ...profileForm,
                  child_allowance_each: e.target.value.replace(/[^0-9]/g, ""),
                })
              }
            />
            <input
              className={inp}
              type="number"
              min={0}
              placeholder="تعداد فرزند"
              value={profileForm.children_count}
              onChange={(e) =>
                setProfileForm({
                  ...profileForm,
                  children_count: Number(e.target.value) || 0,
                })
              }
            />
            <label className="flex items-center gap-2 text-sm text-slate-300 px-1">
              <input
                type="checkbox"
                checked={profileForm.is_insured}
                onChange={(e) =>
                  setProfileForm({
                    ...profileForm,
                    is_insured: e.target.checked,
                  })
                }
              />
              مشمول بیمه
            </label>
            <Button type="button" variant="primary" onClick={createProfile}>
              ساخت پرونده
            </Button>
          </div>
          <p className="text-xs text-slate-500 mt-3">
            شخص ابتدا باید در صفحهٔ «پرسنل» وجود داشته باشد. نرخ‌های بیمه
            (۷٪/۲۳٪) و پلکان مالیات از تنظیمات حقوق خوانده می‌شوند (پیش‌فرض
            پلکان ۱۴۰۴).
          </p>
        </Section>
      )}

      {tab === "periods" && (
        <div className="space-y-5">
          <Section title="دوره‌های حقوق" icon="💵">
            <div className="flex flex-wrap gap-2 items-end mb-4">
              <input
                className={`${inp} w-28`}
                type="number"
                value={periodForm.year}
                onChange={(e) =>
                  setPeriodForm({
                    ...periodForm,
                    year: Number(e.target.value) || 1405,
                  })
                }
              />
              <select
                className={`${inp} w-36`}
                value={periodForm.month}
                onChange={(e) =>
                  setPeriodForm({
                    ...periodForm,
                    month: Number(e.target.value),
                  })
                }
              >
                {MONTHS.map((name, i) => (
                  <option key={i + 1} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
              <Button type="button" variant="primary" onClick={createPeriod}>
                ساخت دوره
              </Button>
            </div>
            <div className="space-y-2">
              {periods.map((period) => (
                <div
                  key={period.id}
                  className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm cursor-pointer transition-all ${
                    selectedPeriod?.id === period.id
                      ? "border-blue-500/50 bg-blue-500/10"
                      : "border-slate-700/60 bg-slate-800/40 hover:bg-slate-800"
                  }`}
                  onClick={() => loadSlips(period)}
                >
                  <span className="text-white font-bold">
                    {MONTHS[period.month - 1]} {fmt(period.year)}
                  </span>
                  <span
                    className={
                      period.status === "finalized"
                        ? "text-emerald-300"
                        : "text-amber-300"
                    }
                  >
                    {period.status_display}
                  </span>
                  <span className="text-slate-400">
                    {fmt(period.payslip_count)} فیش
                  </span>
                  <span className="text-slate-300">
                    ناخالص: {fmt(period.totals.gross)}
                  </span>
                  <span className="text-slate-300">
                    خالص: {fmt(period.totals.net)}
                  </span>
                  <span
                    className="flex gap-2 text-xs mr-auto"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {period.status === "draft" && (
                      <>
                        <button
                          type="button"
                          className="text-blue-300"
                          onClick={() => actOnPeriod(period, "generate")}
                        >
                          تولید/بازحساب فیش‌ها
                        </button>
                        <button
                          type="button"
                          className="text-emerald-300"
                          onClick={() => actOnPeriod(period, "finalize")}
                        >
                          نهایی‌کردن + سند
                        </button>
                        <button
                          type="button"
                          className="text-rose-300"
                          onClick={() => actOnPeriod(period, "delete")}
                        >
                          حذف
                        </button>
                      </>
                    )}
                    {period.status === "finalized" && (
                      <button
                        type="button"
                        className="text-amber-300"
                        onClick={() => actOnPeriod(period, "unfinalize")}
                      >
                        برگرداندن به پیش‌نویس
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-slate-300"
                      onClick={() => download("bank", period)}
                    >
                      خروجی بانک
                    </button>
                    <button
                      type="button"
                      className="text-slate-300"
                      onClick={() => download("insurance", period)}
                    >
                      خروجی بیمه
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </Section>

          {selectedPeriod && (
            <Section
              title={`فیش‌های ${MONTHS[selectedPeriod.month - 1]} ${fmt(selectedPeriod.year)}`}
              icon="🧾"
            >
              {slips.length === 0 ? (
                <EmptyState
                  icon="🧾"
                  title="فیشی تولید نشده است"
                  description="از دکمهٔ «تولید/بازحساب فیش‌ها» استفاده کنید."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-400 text-right border-b border-slate-700">
                        <th className="py-2 px-2">نام</th>
                        <th className="py-2 px-2">روز کارکرد</th>
                        <th className="py-2 px-2">اضافه‌کاری (ساعت)</th>
                        <th className="py-2 px-2">سایر کسورات</th>
                        <th className="py-2 px-2">ناخالص</th>
                        <th className="py-2 px-2">بیمه کارمند</th>
                        <th className="py-2 px-2">مالیات</th>
                        <th className="py-2 px-2">خالص</th>
                      </tr>
                    </thead>
                    <tbody>
                      {slips.map((slip) => (
                        <tr
                          key={slip.id}
                          className="border-b border-slate-800 text-slate-200"
                        >
                          <td className="py-2 px-2">{slip.staff_name}</td>
                          <td className="py-2 px-2">
                            <input
                              className="w-16 bg-slate-700/50 border border-slate-600/50 rounded-lg px-2 py-1 text-white disabled:opacity-50"
                              type="number"
                              min={0}
                              max={31}
                              disabled={!editable}
                              defaultValue={slip.days_worked}
                              onBlur={(e) =>
                                patchSlip(slip, "days_worked", e.target.value)
                              }
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              className="w-20 bg-slate-700/50 border border-slate-600/50 rounded-lg px-2 py-1 text-white disabled:opacity-50"
                              type="number"
                              min={0}
                              step="0.5"
                              disabled={!editable}
                              defaultValue={Number(slip.overtime_hours)}
                              onBlur={(e) =>
                                patchSlip(
                                  slip,
                                  "overtime_hours",
                                  e.target.value,
                                )
                              }
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              className="w-28 bg-slate-700/50 border border-slate-600/50 rounded-lg px-2 py-1 text-white disabled:opacity-50"
                              type="number"
                              min={0}
                              disabled={!editable}
                              defaultValue={Number(slip.other_deductions)}
                              onBlur={(e) =>
                                patchSlip(
                                  slip,
                                  "other_deductions",
                                  e.target.value,
                                )
                              }
                            />
                          </td>
                          <td className="py-2 px-2">{fmt(slip.gross)}</td>
                          <td className="py-2 px-2">
                            {fmt(slip.insurance_employee)}
                          </td>
                          <td className="py-2 px-2">{fmt(slip.tax)}</td>
                          <td className="py-2 px-2 font-bold text-white">
                            {fmt(slip.net)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-xs text-slate-500 mt-3">
                بیمه: سهم کارمند ۷٪ و کارفرما ۲۳٪ از مبنای بیمه (پایه + مسکن +
                بن + اضافه‌کاری). مالیات پلکانی پس از کسر حق اولاد و معافیت
                ماهانه محاسبه می‌شود. با نهایی‌کردن دوره، سند هزینهٔ حقوق در
                حسابداری ثبت می‌شود.
              </p>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}
