import React, { useEffect, useState } from "react";
import { expensesAPI, expenseCategoriesAPI } from "../services/api";
import PriceInput from "../components/PriceInput";
import JalaliDatePicker from "../components/JalaliDatePicker";
import { toJalali, toPersianKeyboard } from "../utils/persian";
import { Button, EmptyState, Spinner, StatCard } from "../components/ui";

const fmt = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("fa-IR").format(Number(n) || 0);

const inp =
  "w-full px-3 py-2.5 bg-slate-700/50 border border-slate-600/50 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all";

type ExpenseCategory = {
  id: number;
  name: string;
  icon?: string;
  color?: string;
};

type ExpenseRow = {
  id: number;
  title: string;
  description?: string | null;
  category?: number | null;
  category_icon?: string;
  category_name?: string | null;
  amount: number;
  date: string;
};

type ExpenseForm = {
  id?: number;
  category: number | string | null;
  title: string;
  amount: number;
  date: string;
  description: string;
};

type CategorySummary = {
  category__icon?: string;
  category__name?: string | null;
  count: number;
  total: number;
};

type ExpenseSummary = {
  total: number;
  by_category: CategorySummary[];
};

const DEFAULT_CATEGORIES = [
  { name: "اجاره", icon: "🏠", color: "#ef4444" },
  { name: "حقوق پرسنل", icon: "👷", color: "#f59e0b" },
  { name: "قبوض", icon: "💡", color: "#10b981" },
  { name: "اقلام مصرفی", icon: "🔧", color: "#6366f1" },
  { name: "حمل و نقل", icon: "🚚", color: "#8b5cf6" },
  { name: "سایر", icon: "📦", color: "#64748b" },
];

// ── Expense Modal ──
type ExpenseModalProps = {
  initial: ExpenseRow | null;
  categories: ExpenseCategory[];
  onSave: (form: ExpenseForm) => void;
  onClose: () => void;
  saving?: boolean;
};

const ExpenseModal = ({
  initial,
  categories,
  onSave,
  onClose,
  saving,
}: ExpenseModalProps) => {
  const [form, setForm] = useState<ExpenseForm>(
    (initial as ExpenseForm | null) || {
      category: "",
      title: "",
      amount: 0,
      date: new Date().toISOString().slice(0, 10),
      description: "",
    },
  );
  const set = (k: keyof ExpenseForm, v: string | number | null) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700/60 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-slate-700/50">
          <h3 className="text-white font-semibold">
            {initial?.id ? "ویرایش هزینه" : "ثبت هزینه جدید"}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors text-xl"
          >
            ×
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">عنوان *</label>
            <input
              className={inp}
              value={form.title}
              onChange={(e) => set("title", toPersianKeyboard(e.target.value))}
              placeholder="مثال: اجاره مغازه اردیبهشت"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">
                مبلغ *
              </label>
              <PriceInput
                value={form.amount}
                onChange={(v) => set("amount", v)}
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">تاریخ</label>
              <JalaliDatePicker
                value={form.date}
                onChange={(v) => set("date", v)}
                required
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">
              دسته‌بندی
            </label>
            <select
              className={inp}
              value={form.category || ""}
              onChange={(e) => set("category", e.target.value || null)}
            >
              <option value="">بدون دسته</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">توضیحات</label>
            <textarea
              className={inp}
              rows={2}
              value={form.description}
              onChange={(e) =>
                set("description", toPersianKeyboard(e.target.value))
              }
              placeholder="توضیح اختیاری"
            />
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
            disabled={saving || !form.title || !form.amount}
            className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm transition-all disabled:opacity-60 flex items-center gap-2"
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : null}
            {initial?.id ? "ذخیره" : "ثبت هزینه"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main ──
const Expenses = () => {
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary>({
    total: 0,
    by_category: [],
  });
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ExpenseRow | "add" | null>(null); // null | 'add' | {expense}

  // Keyboard shortcut (Settings -> keyboard shortcuts) lands here with ?new=1.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("new")) {
      setModal("add");
      params.delete("new");
      const qs = params.toString();
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (qs ? `?${qs}` : ""),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ExpenseRow | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [expRes, catRes, sumRes] = await Promise.all([
        expensesAPI.list(),
        expenseCategoriesAPI.list(),
        expensesAPI.summary(),
      ]);
      setExpenses(expRes.data.results || expRes.data);
      setCategories(catRes.data.results || catRes.data);
      setSummary(sumRes.data);
    } catch (e) {}
    setLoading(false);
  };

  useEffect(() => {
    load();
    window.addEventListener("mohaseb:data-changed", load);
    // Seed default categories if empty
    expenseCategoriesAPI.list().then(({ data }) => {
      const list = data.results || data;
      if (list.length === 0) {
        Promise.all(
          DEFAULT_CATEGORIES.map((c) => expenseCategoriesAPI.create(c)),
        ).then(() => load());
      }
    });
    return () => window.removeEventListener("mohaseb:data-changed", load);
  }, []);

  const handleSave = async (form: ExpenseForm) => {
    setSaving(true);
    try {
      if (form.id) {
        await expensesAPI.update(form.id, form);
      } else {
        await expensesAPI.create(form);
      }
      setModal(null);
      load();
    } catch (e) {
      alert("خطا: " + JSON.stringify(e.response?.data || e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await expensesAPI.delete(deleteTarget.id);
      setDeleteTarget(null);
      load();
    } catch {}
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">💰 مدیریت هزینه‌ها</h2>
          <p className="text-slate-400 text-sm mt-1">
            ثبت و پیگیری هزینه‌های کسب‌وکار
          </p>
        </div>
        <Button variant="primary" onClick={() => setModal("add")}>
          + ثبت هزینه
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          label="کل هزینه‌ها"
          value={fmt(summary.total) + " تومان"}
          icon="💸"
          color="red"
        />
        <StatCard
          label="تعداد هزینه‌ها"
          value={expenses.length}
          icon="🧾"
          color="blue"
        />
        <StatCard
          label="دسته‌بندی‌ها"
          value={categories.length}
          icon="🗂️"
          color="purple"
        />
      </div>

      {/* Category Breakdown */}
      {summary.by_category.length > 0 && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
          <h3 className="text-white font-semibold text-sm mb-4">
            📊 هزینه به تفکیک دسته
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {summary.by_category.map((c, i) => (
              <div
                key={i}
                className="flex items-center gap-3 bg-slate-700/30 rounded-xl p-3"
              >
                <span className="text-xl">{c.category__icon || "📁"}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm truncate">
                    {c.category__name || "بدون دسته"}
                  </p>
                  <p className="text-slate-400 text-xs">{c.count} مورد</p>
                </div>
                <span className="text-white text-sm font-semibold">
                  {fmt(c.total)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expenses List */}
      {loading ? (
        <Spinner size="lg" />
      ) : expenses.length === 0 ? (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl">
          <EmptyState
            icon="💸"
            title="هنوز هزینه‌ای ثبت نشده"
            description="با دکمه «ثبت هزینه» اولین هزینه خود را ثبت کنید"
          />
        </div>
      ) : (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-700/30 text-slate-400 border-b border-slate-700/50">
                  <th className="text-right py-3.5 px-4 font-medium">عنوان</th>
                  <th className="text-right py-3.5 px-4 font-medium">دسته</th>
                  <th className="text-right py-3.5 px-4 font-medium">مبلغ</th>
                  <th className="text-right py-3.5 px-4 font-medium">تاریخ</th>
                  <th className="text-right py-3.5 px-4 font-medium">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {expenses.map((exp) => (
                  <tr
                    key={exp.id}
                    className="hover:bg-slate-700/20 transition-colors group"
                  >
                    <td className="py-3.5 px-4">
                      <p className="text-white font-medium">{exp.title}</p>
                      {exp.description && (
                        <p className="text-slate-500 text-xs mt-0.5 truncate max-w-[200px]">
                          {exp.description}
                        </p>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="text-sm">
                        {exp.category_icon} {exp.category_name || "بدون دسته"}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-red-400 font-semibold">
                      {fmt(exp.amount)} تومان
                    </td>
                    <td className="py-3.5 px-4 text-slate-400">
                      {toJalali(exp.date)}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setModal(exp)}
                          className="px-2 py-1 text-xs rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => setDeleteTarget(exp)}
                          className="px-2 py-1 text-xs rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal */}
      {modal && (
        <ExpenseModal
          initial={modal === "add" ? null : modal}
          categories={categories}
          onSave={handleSave}
          onClose={() => setModal(null)}
          saving={saving}
        />
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-sm">
            <p className="text-white font-semibold mb-2">حذف هزینه</p>
            <p className="text-slate-400 text-sm mb-5">
              آیا از حذف «
              <span className="text-white">{deleteTarget.title}</span>» اطمینان
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

export default Expenses;
