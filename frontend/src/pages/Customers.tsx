import React, { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  useCustomers,
  useCreateCustomer,
  useUpdateCustomer,
  useDeleteCustomer,
  customerKeys,
} from "../hooks/useCustomers";
import {
  formatPrice,
  Button,
  Modal,
  InputField,
  Spinner,
  EmptyState,
  ConfirmDialog,
} from "../components/ui";
import { toPersianKeyboard } from "../utils/persian";

type CustomerRow = {
  id: number;
  name: string;
  phone?: string | null;
  email?: string | null;
  national_id?: string | null;
  address?: string | null;
  notes?: string | null;
  total_invoices?: number;
  total_paid?: number;
};

type CustomerFormData = {
  name: string;
  phone: string;
  email: string;
  national_id: string;
  address: string;
  notes: string;
};

type CustomerFormState = CustomerFormData & { id?: number };

const defaultForm: CustomerFormData = {
  name: "",
  phone: "",
  email: "",
  national_id: "",
  address: "",
  notes: "",
};

type CustomerFormProps = {
  initial: CustomerRow | null;
  onSave: (form: CustomerFormState) => void;
  onClose: () => void;
  loading?: boolean;
};

const CustomerForm = ({
  initial,
  onSave,
  onClose,
  loading,
}: CustomerFormProps) => {
  const [form, setForm] = useState<CustomerFormState>(
    (initial as CustomerFormState | null) || defaultForm,
  );

  const set = (k: keyof CustomerFormData, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <InputField
          label="نام *"
          value={form.name}
          onChange={(e) => set("name", toPersianKeyboard(e.target.value))}
          placeholder="نام مشتری"
          required
        />
        <InputField
          label="تلفن"
          value={form.phone || ""}
          onChange={(e) => set("phone", e.target.value)}
          placeholder="09XXXXXXXXX"
        />
        <InputField
          label="ایمیل"
          type="email"
          value={form.email || ""}
          onChange={(e) => set("email", e.target.value)}
          placeholder="example@email.com"
        />
        <InputField
          label="کد ملی / شناسه"
          value={form.national_id || ""}
          onChange={(e) => set("national_id", e.target.value)}
          placeholder="کد ملی یا شناسه"
        />
      </div>
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-300">آدرس</label>
        <textarea
          value={form.address || ""}
          onChange={(e) => set("address", toPersianKeyboard(e.target.value))}
          rows={2}
          className="w-full px-4 py-2.5 bg-slate-700/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none"
          placeholder="آدرس کامل"
        />
      </div>
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-300">
          یادداشت
        </label>
        <textarea
          value={form.notes || ""}
          onChange={(e) => set("notes", toPersianKeyboard(e.target.value))}
          rows={2}
          className="w-full px-4 py-2.5 bg-slate-700/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none"
          placeholder="یادداشت‌های مربوط به مشتری"
        />
      </div>
      <div className="flex gap-3 justify-end pt-2">
        <Button variant="ghost" onClick={onClose}>
          انصراف
        </Button>
        <Button
          variant="primary"
          loading={loading}
          onClick={() => onSave(form)}
        >
          {initial?.id ? "ذخیره تغییرات" : "افزودن مشتری"}
        </Button>
      </div>
    </div>
  );
};

const Customers = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const { data, isFetching } = useCustomers({ search });
  const list = (data ?? []) as CustomerRow[];
  const loading = isFetching;
  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();
  const deleteCustomer = useDeleteCustomer();
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CustomerRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomerRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const refresh = () =>
      queryClient.invalidateQueries({ queryKey: customerKeys.all });
    window.addEventListener("mohaseb:data-changed", refresh);
    return () => window.removeEventListener("mohaseb:data-changed", refresh);
  }, [queryClient]);

  // Keyboard shortcut (Settings -> keyboard shortcuts) lands here with ?new=1.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("new")) {
      openAdd();
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
  const openAdd = () => {
    setEditTarget(null);
    setModalOpen(true);
  };
  const openEdit = (c: CustomerRow) => {
    setEditTarget(c);
    setModalOpen(true);
  };

  const handleSave = async (form: CustomerFormState) => {
    setSaving(true);
    try {
      if (editTarget?.id) {
        await updateCustomer.mutateAsync({ id: editTarget.id, data: form });
      } else {
        await createCustomer.mutateAsync(form);
      }
      setModalOpen(false);
    } catch (e) {
      alert("خطا در ذخیره: " + JSON.stringify(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteCustomer.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">👥 مشتریان</h2>
          <p className="text-slate-400 text-sm mt-1">مدیریت اطلاعات مشتریان</p>
        </div>
        <Button variant="primary" onClick={openAdd}>
          + افزودن مشتری
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="جستجو بر اساس نام، تلفن یا کد ملی..."
          className="w-full px-4 py-3 pr-12 bg-slate-800/50 border border-slate-700/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        />
        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500">
          🔍
        </span>
      </div>

      {/* Table */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
        {loading ? (
          <Spinner />
        ) : list.length === 0 ? (
          <EmptyState
            icon="👥"
            title="مشتری‌ای یافت نشد"
            description="با کلیک روی دکمه افزودن مشتری، اولین مشتری را ثبت کنید"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-700/30 text-slate-400">
                  <th className="text-right py-3.5 px-4 font-medium">#</th>
                  <th className="text-right py-3.5 px-4 font-medium">نام</th>
                  <th className="text-right py-3.5 px-4 font-medium">تلفن</th>
                  <th className="text-right py-3.5 px-4 font-medium">ایمیل</th>
                  <th className="text-right py-3.5 px-4 font-medium">کد ملی</th>
                  <th className="text-right py-3.5 px-4 font-medium">
                    تعداد فاکتور
                  </th>
                  <th className="text-right py-3.5 px-4 font-medium">
                    مجموع پرداختی
                  </th>
                  <th className="py-3.5 px-4" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {list.map((c, i) => (
                  <tr
                    key={c.id}
                    className="hover:bg-slate-700/20 transition-colors group"
                  >
                    <td className="py-3.5 px-4 text-slate-500">
                      {new Intl.NumberFormat("fa-IR").format(i + 1)}
                    </td>
                    <td className="py-3.5 px-4">
                      <Link
                        to={`/customers/${c.id}`}
                        className="text-white font-medium hover:text-blue-400 transition-colors"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="py-3.5 px-4 text-slate-300">
                      {c.phone || "---"}
                    </td>
                    <td className="py-3.5 px-4 text-slate-300">
                      {c.email || "---"}
                    </td>
                    <td className="py-3.5 px-4 text-slate-400 font-mono text-xs">
                      {c.national_id || "---"}
                    </td>
                    <td className="py-3.5 px-4 text-slate-300">
                      {new Intl.NumberFormat("fa-IR").format(
                        c.total_invoices || 0,
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-green-400 text-xs">
                      {formatPrice(c.total_paid || 0)}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Link
                          to={`/customers/${c.id}`}
                          className="p-1.5 rounded-lg text-blue-400 hover:bg-blue-500/10 transition-all text-xs"
                        >
                          👁️ مشاهده
                        </Link>
                        <button
                          onClick={() => openEdit(c)}
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-500/10 transition-all text-xs"
                        >
                          ✏️ ویرایش
                        </button>
                        <button
                          onClick={() => setDeleteTarget(c)}
                          className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-all text-xs"
                        >
                          🗑️ حذف
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editTarget ? "ویرایش مشتری" : "افزودن مشتری جدید"}
        size="lg"
      >
        <CustomerForm
          initial={editTarget}
          onSave={handleSave}
          onClose={() => setModalOpen(false)}
          loading={saving}
        />
      </Modal>

      {/* Delete Confirm */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="حذف مشتری"
        message={`آیا از حذف مشتری "${deleteTarget?.name}" اطمینان دارید؟ این عمل قابل بازگشت نیست.`}
        loading={deleting}
      />
    </div>
  );
};

export default Customers;
