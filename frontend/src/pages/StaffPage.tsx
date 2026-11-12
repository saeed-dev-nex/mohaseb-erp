import React, { useEffect, useState } from "react";
import { staffAPI } from "../services/api";
import { Button, Spinner } from "../components/ui";

const fmt = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("fa-IR").format(Number(n) || 0);
const inp =
  "w-full px-3 py-2.5 bg-slate-700/50 border border-slate-600/50 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all";

type StaffRow = {
  id: number;
  name: string;
  phone?: string | null;
  specialty?: string | null;
  commission_rate: number | string;
  is_active: boolean;
};

type StaffForm = {
  id?: number;
  name: string;
  phone: string;
  specialty: string;
  commission_rate: number | string;
  is_active: boolean;
};

type StaffPerformance = {
  total_items: number;
  total_revenue: number;
  commission_earned: number;
};

type StaffModalProps = {
  initial: StaffRow | null;
  onSave: (form: StaffForm) => void;
  onClose: () => void;
  saving?: boolean;
};

const StaffModal = ({ initial, onSave, onClose, saving }: StaffModalProps) => {
  const [form, setForm] = useState<StaffForm>(
    (initial as StaffForm | null) || {
      name: "",
      phone: "",
      specialty: "",
      commission_rate: 0,
      is_active: true,
    },
  );
  const set = (k: keyof StaffForm, v: string | number | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700/60 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-slate-700/50">
          <h3 className="text-white font-semibold">
            {initial?.id ? "ویرایش پرسنل" : "افزودن پرسنل"}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xl"
          >
            ×
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">نام *</label>
            <input
              className={inp}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="نام و نام خانوادگی"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">تلفن</label>
              <input
                className={inp}
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="09..."
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">تخصص</label>
              <input
                className={inp}
                value={form.specialty}
                onChange={(e) => set("specialty", e.target.value)}
                placeholder="مکانیک، برقکار..."
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">
              درصد پورسانت (%)
            </label>
            <input
              type="number"
              step="0.5"
              min="0"
              max="100"
              className={inp}
              value={form.commission_rate}
              onChange={(e) => set("commission_rate", e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => set("is_active", !form.is_active)}
              className={`relative w-11 h-6 rounded-full transition-all ${form.is_active ? "bg-green-600" : "bg-slate-600"}`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${form.is_active ? "right-0.5" : "right-5"}`}
              />
            </button>
            <span className="text-slate-300 text-sm">
              {form.is_active ? "فعال" : "غیرفعال"}
            </span>
          </div>
        </div>
        <div className="flex gap-3 justify-end p-5 border-t border-slate-700/50">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-700 transition-all"
          >
            انصراف
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={saving || !form.name}
            className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm transition-all disabled:opacity-60"
          >
            {initial?.id ? "ذخیره" : "افزودن"}
          </button>
        </div>
      </div>
    </div>
  );
};

const StaffPage = () => {
  const [list, setList] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<StaffRow | "add" | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StaffRow | null>(null);
  const [performances, setPerformances] = useState<
    Record<number, StaffPerformance>
  >({});

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await staffAPI.list();
      const staffList = data.results || data;
      setList(staffList);
      // Load performance for each staff
      const perfs: Record<number, StaffPerformance> = {};
      for (const s of staffList) {
        try {
          const { data: perf } = await staffAPI.performance(s.id);
          perfs[s.id] = perf;
        } catch {}
      }
      setPerformances(perfs);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    load();
    window.addEventListener("mohaseb:data-changed", load);
    return () => window.removeEventListener("mohaseb:data-changed", load);
  }, []);

  const handleSave = async (form: StaffForm) => {
    setSaving(true);
    try {
      if (form.id) {
        await staffAPI.update(form.id, form);
      } else {
        await staffAPI.create(form);
      }
      setModal(null);
      load();
    } catch (e) {
      alert("خطا: " + JSON.stringify(e.response?.data));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await staffAPI.delete(deleteTarget.id);
      setDeleteTarget(null);
      load();
    } catch {}
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">👷 مدیریت پرسنل</h2>
          <p className="text-slate-400 text-sm mt-1">
            تکنسین‌ها، پورسانت و عملکرد
          </p>
        </div>
        <Button variant="primary" onClick={() => setModal("add")}>
          + افزودن پرسنل
        </Button>
      </div>

      {loading ? (
        <Spinner size="lg" />
      ) : list.length === 0 ? (
        <div className="text-center py-16 bg-slate-800/50 border border-slate-700/50 rounded-2xl">
          <p className="text-4xl mb-3">👷</p>
          <p className="text-slate-300 font-medium text-lg">
            پرسنلی تعریف نشده
          </p>
          <p className="text-slate-500 text-sm mt-1">
            با کلیک روی «افزودن پرسنل» شروع کنید
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {list.map((s) => {
            const perf = performances[s.id];
            return (
              <div
                key={s.id}
                className={`bg-slate-800/50 border rounded-2xl overflow-hidden transition-all group ${s.is_active ? "border-slate-700/50" : "border-slate-700/30 opacity-60"}`}
              >
                <div className="p-5 border-b border-slate-700/40">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-blue-500/20 border border-indigo-500/30 flex items-center justify-center text-lg">
                        👤
                      </div>
                      <div>
                        <h3 className="text-white font-semibold">{s.name}</h3>
                        {s.specialty && (
                          <p className="text-slate-500 text-xs">
                            {s.specialty}
                          </p>
                        )}
                      </div>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full border ${s.is_active ? "bg-green-500/10 text-green-400 border-green-500/30" : "bg-slate-500/10 text-slate-400 border-slate-500/30"}`}
                    >
                      {s.is_active ? "فعال" : "غیرفعال"}
                    </span>
                  </div>
                </div>
                <div className="p-5 space-y-2.5">
                  {s.phone && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">تلفن</span>
                      <span className="text-white font-mono text-xs">
                        {s.phone}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">پورسانت</span>
                    <span className="text-yellow-400 font-medium">
                      {s.commission_rate}%
                    </span>
                  </div>
                  {perf && (
                    <>
                      <div className="border-t border-slate-700/30 pt-2 mt-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-400">تعداد خدمات</span>
                          <span className="text-white">{perf.total_items}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-400">درآمدزایی</span>
                          <span className="text-blue-400">
                            {fmt(perf.total_revenue)} ت
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-yellow-400/80">
                            💰 پورسانت محاسبه‌شده
                          </span>
                          <span className="text-yellow-400 font-semibold">
                            {fmt(perf.commission_earned)} ت
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2 px-5 py-3 border-t border-slate-700/40 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setModal(s)}
                    className="flex-1 py-1.5 text-xs rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 transition-all"
                  >
                    ✏️ ویرایش
                  </button>
                  <button
                    onClick={() => setDeleteTarget(s)}
                    className="flex-1 py-1.5 text-xs rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-all"
                  >
                    🗑️ حذف
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <StaffModal
          initial={modal === "add" ? null : modal}
          onSave={handleSave}
          onClose={() => setModal(null)}
          saving={saving}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-sm">
            <p className="text-white font-semibold mb-2">حذف پرسنل</p>
            <p className="text-slate-400 text-sm mb-5">
              آیا از حذف «
              <span className="text-white">{deleteTarget.name}</span>» اطمینان
              دارید؟
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-700 transition-all"
              >
                انصراف
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm transition-all"
              >
                حذف
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StaffPage;
