import { useCallback, useEffect, useState } from "react";
import { servicePackagesAPI, servicesAPI } from "../../services/api";
import { F, Section, inp } from "./shared";

type PkgService = { id: number; title: string; is_active: boolean };
type Pkg = {
  id: number;
  name: string;
  services: number[];
  service_titles: { id: number; title: string }[];
  is_active: boolean;
};

// Manager-arranged ready-made service bundles. Applied with one click from
// the invoice form / quick invoice; editing them lives here in Settings.
export const ServicePackagesSection = () => {
  const [pkgs, setPkgs] = useState<Pkg[]>([]);
  const [allServices, setAllServices] = useState<PkgService[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [pkgName, setPkgName] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    servicePackagesAPI
      .list()
      .then(({ data }) => setPkgs(data?.results || data || []))
      .catch(() => {});
    servicesAPI
      .list()
      .then(({ data }) => setAllServices(data?.results || data || []))
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  const resetEditor = () => {
    setEditingId(null);
    setPkgName("");
    setSelected([]);
  };

  const handleSave = async () => {
    if (!pkgName.trim()) {
      setErr("نام پکیج را وارد کنید");
      return;
    }
    if (selected.length === 0) {
      setErr("حداقل یک خدمت برای پکیج انتخاب کنید");
      return;
    }
    setSaving(true);
    setErr("");
    setMsg("");
    try {
      if (editingId)
        await servicePackagesAPI.update(editingId, {
          name: pkgName.trim(),
          services: selected,
        });
      else
        await servicePackagesAPI.create({
          name: pkgName.trim(),
          services: selected,
        });
      setMsg(editingId ? "✅ پکیج ویرایش شد" : "✅ پکیج ساخته شد");
      resetEditor();
      load();
    } catch {
      setErr("خطا در ذخیره پکیج؛ دوباره تلاش کنید");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (pkg: Pkg) => {
    if (!window.confirm(`پکیج «${pkg.name}» حذف شود؟`)) return;
    try {
      await servicePackagesAPI.delete(pkg.id);
      if (editingId === pkg.id) resetEditor();
      load();
    } catch {
      setErr("خطا در حذف پکیج");
    }
  };

  const toggleService = (sid: number) =>
    setSelected((prev) =>
      prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid],
    );

  return (
    <Section title="پکیج‌های خدمات آماده" icon="📦">
      <p className="text-xs text-slate-400 leading-6 mb-4">
        برای هر نیاز تکرارشونده یک بستهٔ آماده از خدمات بچینید؛ موقع صدور فاکتور
        (فرم کامل و فاکتور سریع) با یک کلیک، همهٔ خدمات پکیج با قیمت‌های پیش‌فرض
        به ردیف‌های فاکتور اضافه می‌شوند.
      </p>
      {err && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-400 text-sm mb-4">
          {err}
        </div>
      )}
      {msg && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 text-emerald-400 text-sm mb-4">
          {msg}
        </div>
      )}
      {pkgs.length > 0 && (
        <div className="space-y-2 mb-5">
          {pkgs.map((pkg) => (
            <div
              key={pkg.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-600/50 bg-slate-700/30 px-4 py-3"
            >
              <span className="text-sm text-white font-medium">
                📦 {pkg.name}
              </span>
              <span className="text-xs text-slate-400 flex-1">
                {pkg.service_titles.map((t) => t.title).join("، ") ||
                  "بدون خدمت"}
              </span>
              <button
                type="button"
                onClick={() => {
                  setEditingId(pkg.id);
                  setPkgName(pkg.name);
                  setSelected(pkg.services);
                  setErr("");
                  setMsg("");
                }}
                className="text-xs px-2.5 py-1 rounded-lg bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 border border-indigo-500/20 transition-all"
              >
                ✏️ ویرایش
              </button>
              <button
                type="button"
                onClick={() => handleDelete(pkg)}
                className="text-xs px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-all"
              >
                🗑️ حذف
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-4 rounded-xl border border-slate-600/40 p-4">
        <F label={editingId ? "ویرایش پکیج" : "پکیج جدید"}>
          <input
            value={pkgName}
            onChange={(e) => setPkgName(e.target.value)}
            placeholder="مثال: خلافی و عوارض"
            className={inp}
          />
        </F>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-2">
            خدمات پکیج
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-56 overflow-y-auto pl-1">
            {allServices
              .filter((s) => s.is_active)
              .map((s) => (
                <label
                  key={s.id}
                  className="flex items-center gap-2 text-sm text-slate-200 bg-slate-700/30 border border-slate-600/40 rounded-lg px-3 py-2 cursor-pointer hover:bg-slate-700/50"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(s.id)}
                    onChange={() => toggleService(s.id)}
                    className="accent-violet-500"
                  />
                  {s.title}
                </label>
              ))}
            {allServices.length === 0 && (
              <p className="text-xs text-slate-500">خدمتی یافت نشد</p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium disabled:opacity-60 transition-all"
          >
            {saving
              ? "در حال ذخیره..."
              : editingId
                ? "💾 ذخیره ویرایش"
                : "➕ ساخت پکیج"}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetEditor}
              className="px-4 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm"
            >
              انصراف
            </button>
          )}
        </div>
      </div>
    </Section>
  );
};
