import { useCallback, useEffect, useState } from "react";
import {
  businessesAPI,
  type Business,
  type BusinessTemplate,
  type FiscalYear,
} from "../../services/api";
import { showWaiting, hideWaiting } from "../../lib/waiting";
import { F, Section, inp } from "./shared";

const faNum = (value: number) => value.toLocaleString("fa-IR");

const ROLE_LABELS: Record<string, string> = {
  owner: "مالک",
  manager: "مدیر",
  operator: "اپراتور",
  viewer: "مشاهده‌گر",
};

type Member = {
  id: number;
  username: string;
  role: string;
  is_default: boolean;
};

/**
 * Businesses admin (ERP phase 0): the multi-business core. Lists the
 * businesses the superuser runs, creates new ones from a job template
 * (قالب شغلی), and manages each business's fiscal years and members.
 */
export const BusinessesTab = ({ isSuperuser }: { isSuperuser: boolean }) => {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [templates, setTemplates] = useState<BusinessTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [form, setForm] = useState({
    name: "",
    template_key: "services_repair",
    person_type: "legal" as "legal" | "individual",
    national_id: "",
    phone: "",
  });
  const [yearForm, setYearForm] = useState({
    title: "",
    start_date: "",
    end_date: "",
    is_current: true,
  });
  const [memberForm, setMemberForm] = useState({
    username: "",
    role: "operator",
  });

  const loadBusinesses = useCallback(async () => {
    try {
      const { data } = await businessesAPI.list();
      setBusinesses(data);
      setSelectedId((previous) => previous ?? data[0]?.id ?? null);
    } catch {
      setError("دریافت فهرست کسب‌وکارها انجام نشد.");
    }
  }, []);

  useEffect(() => {
    void loadBusinesses();
    businessesAPI
      .templates()
      .then(({ data }) => setTemplates(data))
      .catch(() => setTemplates([]));
  }, [loadBusinesses]);

  const selected = businesses.find((b) => b.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected) {
      setYears([]);
      setMembers([]);
      return;
    }
    businessesAPI
      .fiscalYears(selected.id)
      .then(({ data }) => setYears(data))
      .catch(() => setYears([]));
    businessesAPI
      .members(selected.id)
      .then(({ data }) => setMembers(data as Member[]))
      .catch(() => setMembers([]));
  }, [selected]);

  if (!isSuperuser) return null;

  const createBusiness = async () => {
    setError("");
    setNotice("");
    showWaiting("در حال ساخت کسب‌وکار…");
    try {
      const { data } = await businessesAPI.create(form);
      setForm({
        name: "",
        template_key: "services_repair",
        person_type: "legal",
        national_id: "",
        phone: "",
      });
      await loadBusinesses();
      setSelectedId(data.id);
      setNotice(
        `کسب‌وکار «${data.name}» با قالب «${data.template_title}» ساخته شد و سال مالی جاری آن آماده است.`,
      );
    } catch {
      setError("ساخت کسب‌وکار انجام نشد. نام و قالب را بررسی کنید.");
    } finally {
      hideWaiting();
    }
  };

  const addYear = async () => {
    if (!selected) return;
    setError("");
    try {
      await businessesAPI.addFiscalYear(selected.id, yearForm);
      const { data } = await businessesAPI.fiscalYears(selected.id);
      setYears(data);
      setYearForm({
        title: "",
        start_date: "",
        end_date: "",
        is_current: true,
      });
    } catch {
      setError(
        "افزودن سال مالی انجام نشد. عنوان تکراری یا تاریخ‌ها را بررسی کنید.",
      );
    }
  };

  const addMember = async () => {
    if (!selected) return;
    setError("");
    try {
      await businessesAPI.addMember(selected.id, memberForm);
      const { data } = await businessesAPI.members(selected.id);
      setMembers(data as Member[]);
      setMemberForm({ username: "", role: "operator" });
    } catch {
      setError(
        "افزودن عضو انجام نشد. نام کاربری باید دقیقاً نام یک کاربر موجود باشد.",
      );
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}
      {notice && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm rounded-xl px-4 py-3">
          {notice}
        </div>
      )}

      <Section title="کسب‌وکارهای شما" icon="🏢">
        {businesses.length === 0 ? (
          <p className="text-slate-400 text-sm">
            هنوز کسب‌وکاری ثبت نشده است؛ از فرم زیر اولین کسب‌وکار را بسازید.
          </p>
        ) : (
          <div className="space-y-2">
            {businesses.map((business) => (
              <button
                key={business.id}
                onClick={() => setSelectedId(business.id)}
                className={`w-full text-right px-4 py-3 rounded-xl border transition-all ${
                  business.id === selectedId
                    ? "bg-blue-500/10 border-blue-500/40"
                    : "bg-slate-700/30 border-slate-700/50 hover:bg-slate-700/50"
                }`}
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-white text-sm font-medium">
                    {business.name}
                  </span>
                  <span className="text-xs text-slate-400">
                    {business.template_title} ·{" "}
                    {business.person_type === "legal" ? "حقوقی" : "حقیقی"} · نقش
                    شما: {ROLE_LABELS[business.my_role ?? ""] ?? "—"}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  سال مالی جاری: {business.current_fiscal_year?.title ?? "—"} ·{" "}
                  {faNum(business.effective_modules.length)} ماژول فعال در قالب
                </p>
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title="کسب‌وکار جدید" icon="➕">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <F label="نام کسب‌وکار">
            <input
              className={inp}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="مثلاً فروشگاه مرکزی"
            />
          </F>
          <F label="قالب شغلی">
            <select
              className={inp}
              value={form.template_key}
              onChange={(e) =>
                setForm({ ...form, template_key: e.target.value })
              }
            >
              {templates.map((template) => (
                <option key={template.key} value={template.key}>
                  {template.title}
                </option>
              ))}
            </select>
          </F>
          <F label="نوع شخصیت">
            <select
              className={inp}
              value={form.person_type}
              onChange={(e) =>
                setForm({
                  ...form,
                  person_type: e.target.value as "legal" | "individual",
                })
              }
            >
              <option value="legal">حقوقی (شرکت / مؤسسه)</option>
              <option value="individual">حقیقی (شخص / مغازه)</option>
            </select>
          </F>
          <F label="شناسه ملی / کد ملی">
            <input
              className={inp}
              value={form.national_id}
              onChange={(e) =>
                setForm({ ...form, national_id: e.target.value })
              }
            />
          </F>
          <F label="تلفن">
            <input
              className={inp}
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </F>
        </div>
        {templates.find((t) => t.key === form.template_key) && (
          <p className="text-xs text-slate-400 mt-3">
            {templates.find((t) => t.key === form.template_key)?.description}
          </p>
        )}
        <button
          onClick={createBusiness}
          disabled={!form.name.trim()}
          className="mt-4 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-all"
        >
          ساخت کسب‌وکار
        </button>
      </Section>

      {selected && (
        <>
          <Section title={`سال‌های مالی — ${selected.name}`} icon="📅">
            <div className="space-y-2 mb-4">
              {years.length === 0 && (
                <p className="text-slate-400 text-sm">سال مالی ثبت نشده است.</p>
              )}
              {years.map((year) => (
                <div
                  key={year.id}
                  className="flex items-center justify-between bg-slate-700/30 rounded-xl px-4 py-2.5 text-sm"
                >
                  <span className="text-white">{year.title}</span>
                  <span className="text-slate-400 text-xs">
                    {year.start_date} تا {year.end_date}
                    {year.is_current && " · جاری"}
                    {year.is_closed && " · بسته"}
                  </span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <F label="عنوان">
                <input
                  className={inp}
                  value={yearForm.title}
                  onChange={(e) =>
                    setYearForm({ ...yearForm, title: e.target.value })
                  }
                  placeholder="سال مالی ۱۴۰۶"
                />
              </F>
              <F label="شروع (میلادی)">
                <input
                  type="date"
                  className={inp}
                  value={yearForm.start_date}
                  onChange={(e) =>
                    setYearForm({ ...yearForm, start_date: e.target.value })
                  }
                />
              </F>
              <F label="پایان (میلادی)">
                <input
                  type="date"
                  className={inp}
                  value={yearForm.end_date}
                  onChange={(e) =>
                    setYearForm({ ...yearForm, end_date: e.target.value })
                  }
                />
              </F>
              <div className="flex items-end">
                <button
                  onClick={addYear}
                  disabled={
                    !yearForm.title ||
                    !yearForm.start_date ||
                    !yearForm.end_date
                  }
                  className="px-4 py-2.5 bg-slate-600 hover:bg-slate-500 disabled:opacity-40 text-white text-sm rounded-xl transition-all w-full"
                >
                  افزودن سال مالی
                </button>
              </div>
            </div>
          </Section>

          <Section title={`اعضا — ${selected.name}`} icon="👥">
            <div className="space-y-2 mb-4">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between bg-slate-700/30 rounded-xl px-4 py-2.5 text-sm"
                >
                  <span className="text-white">{member.username}</span>
                  <span className="text-slate-400 text-xs">
                    {ROLE_LABELS[member.role] ?? member.role}
                    {member.is_default && " · پیش‌فرض او"}
                  </span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <F label="نام کاربری">
                <input
                  className={inp}
                  value={memberForm.username}
                  onChange={(e) =>
                    setMemberForm({ ...memberForm, username: e.target.value })
                  }
                />
              </F>
              <F label="نقش">
                <select
                  className={inp}
                  value={memberForm.role}
                  onChange={(e) =>
                    setMemberForm({ ...memberForm, role: e.target.value })
                  }
                >
                  <option value="owner">مالک</option>
                  <option value="manager">مدیر</option>
                  <option value="operator">اپراتور</option>
                  <option value="viewer">مشاهده‌گر</option>
                </select>
              </F>
              <div className="flex items-end">
                <button
                  onClick={addMember}
                  disabled={!memberForm.username.trim()}
                  className="px-4 py-2.5 bg-slate-600 hover:bg-slate-500 disabled:opacity-40 text-white text-sm rounded-xl transition-all w-full"
                >
                  افزودن / به‌روزرسانی عضو
                </button>
              </div>
            </div>
          </Section>
        </>
      )}
    </div>
  );
};
