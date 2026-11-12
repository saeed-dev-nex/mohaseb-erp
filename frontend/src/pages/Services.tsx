import React, { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useServices,
  useCreateService,
  useUpdateService,
  useDeleteService,
  serviceKeys,
} from "../hooks/useServices";
import PriceInput from "../components/PriceInput";
import { toPersianKeyboard } from "../utils/persian";
import {
  Button,
  ConfirmDialog,
  ErrorNotice,
  Modal,
  Spinner,
} from "../components/ui";
import { formatApiError } from "../utils/apiError";

const fmt = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("fa-IR").format(Number(n) || 0);

type ServiceRow = {
  id: number;
  title: string;
  description?: string | null;
  has_extra?: boolean;
  extra_label?: string | null;
  default_main_price: number;
  default_extra_price: number;
  default_commission: number;
  commission_label?: string | null;
  is_active: boolean;
};

type ServiceFormData = {
  title: string;
  description: string;
  has_extra: boolean;
  extra_label: string;
  default_main_price: number;
  default_extra_price: number;
  default_commission: number;
  commission_label: string;
  is_active: boolean;
};

type ServiceFormState = ServiceFormData & { id?: number };

const emptyForm: ServiceFormData = {
  title: "",
  description: "",
  has_extra: false,
  extra_label: "",
  default_main_price: 0,
  default_extra_price: 0,
  default_commission: 0,
  commission_label: "کارمزد",
  is_active: true,
};

// ── Inline Input ──
const F = ({
  label,
  children,
}: {
  label: string;
  children: ReactElement<{ id?: string }>;
}) => {
  const generatedId = React.useId();
  const id = children.props.id || generatedId;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs text-slate-400">
        {label}
      </label>
      {React.cloneElement(children, { id })}
    </div>
  );
};
const inp =
  "w-full px-3 py-2.5 bg-slate-700/50 border border-slate-600/50 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all";

// ── Service Modal ──
type ServiceModalProps = {
  initial: ServiceRow | null;
  onSave: (form: ServiceFormState) => void;
  onClose: () => void;
  loading?: boolean;
  error?: string;
};

const ServiceModal = ({
  initial,
  onSave,
  onClose,
  loading,
  error,
}: ServiceModalProps) => {
  const [form, setForm] = useState<ServiceFormState>(
    (initial as ServiceFormState | null) || emptyForm,
  );
  const set = (k: keyof ServiceFormData, v: string | number | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={initial?.id ? "ویرایش خدمت" : "افزودن خدمت جدید"}
      size="md"
      dismissible={!loading}
    >
      <ErrorNotice message={error} />
      <div className="space-y-4">
        <F label="عنوان خدمت *">
          <input
            className={inp}
            value={form.title}
            onChange={(e) => set("title", toPersianKeyboard(e.target.value))}
            placeholder="عنوان خدمت"
          />
        </F>
        <F label="توضیحات">
          <textarea
            className={inp}
            rows={2}
            value={form.description || ""}
            onChange={(e) =>
              set("description", toPersianKeyboard(e.target.value))
            }
            placeholder="توضیح کوتاه"
          />
        </F>

        <div className="grid grid-cols-2 gap-3">
          <F label="مبلغ پرداختی پیش‌فرض">
            <PriceInput
              value={form.default_main_price}
              onChange={(v) => set("default_main_price", v)}
            />
          </F>
          <F label="مبلغ استعلامی پیش‌فرض">
            <PriceInput
              value={form.default_extra_price}
              onChange={(v) => set("default_extra_price", v)}
            />
          </F>
        </div>

        {/* Commission */}
        <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-4 space-y-3">
          <p className="text-yellow-400 text-xs font-semibold flex items-center gap-1.5">
            💼 تنظیمات کارمزد
          </p>
          <div className="grid grid-cols-2 gap-3">
            <F label="کارمزد پیش‌فرض">
              <PriceInput
                value={form.default_commission}
                onChange={(v) => set("default_commission", v)}
                borderColor="border-yellow-500/30"
              />
            </F>
            <F label="برچسب کارمزد">
              <input
                type="text"
                className={inp}
                value={form.commission_label}
                onChange={(e) => set("commission_label", e.target.value)}
                placeholder="کارمزد"
              />
            </F>
          </div>
        </div>

        {/* Extra */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => set("has_extra", !form.has_extra)}
            aria-pressed={form.has_extra}
            aria-label="فعال‌سازی خدمت اضافه"
            className={`relative w-11 h-6 rounded-full transition-all ${form.has_extra ? "bg-blue-600" : "bg-slate-600"}`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${form.has_extra ? "right-0.5" : "right-5"}`}
            />
          </button>
          <span className="text-slate-300 text-sm">دارای خدمت اضافه</span>
        </div>
        {form.has_extra && (
          <F label="برچسب خدمت اضافه">
            <input
              className={inp}
              value={form.extra_label || ""}
              onChange={(e) => set("extra_label", e.target.value)}
              placeholder="مثال: هزینه ارسال"
            />
          </F>
        )}

        {/* Active toggle */}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={() => set("is_active", !form.is_active)}
            aria-pressed={form.is_active}
            aria-label="فعال‌سازی خدمت"
            className={`relative w-11 h-6 rounded-full transition-all ${form.is_active ? "bg-green-600" : "bg-slate-600"}`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${form.is_active ? "right-0.5" : "right-5"}`}
            />
          </button>
          <span className="text-slate-300 text-sm">
            {form.is_active ? "خدمت فعال" : "خدمت غیرفعال"}
          </span>
        </div>
      </div>

      <div className="flex gap-3 justify-end p-5 border-t border-slate-700/50">
        <Button variant="ghost" onClick={onClose} disabled={loading}>
          انصراف
        </Button>
        <Button
          variant="primary"
          onClick={() => onSave(form)}
          loading={loading}
        >
          {initial?.id ? "ذخیره تغییرات" : "افزودن"}
        </Button>
      </div>
    </Modal>
  );
};

// ── Main ──────────────────────────────────────────────────────
const Services = () => {
  const queryClient = useQueryClient();
  const { data, isFetching, error: loadError, refetch } = useServices();
  const list = (data ?? []) as ServiceRow[];
  const loading = isFetching;
  const createService = useCreateService();
  const updateService = useUpdateService();
  const deleteService = useDeleteService();
  const [modal, setModal] = useState<ServiceRow | "add" | null>(null); // null | 'add' | {service}

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
  const [deleteTarget, setDeleteTarget] = useState<ServiceRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const savingRef = useRef(false);
  const deletingRef = useRef(false);

  useEffect(() => {
    const refresh = () =>
      queryClient.invalidateQueries({ queryKey: serviceKeys.all });
    window.addEventListener("mohaseb:data-changed", refresh);
    return () => window.removeEventListener("mohaseb:data-changed", refresh);
  }, [queryClient]);

  const handleSave = async (form: ServiceFormState) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setFormError("");
    try {
      if (modal && modal !== "add" && modal.id) {
        await updateService.mutateAsync({ id: modal.id, data: form });
      } else {
        await createService.mutateAsync(form);
      }
      setModal(null);
    } catch (e) {
      setFormError(formatApiError(e, "ذخیره‌سازی خدمت انجام نشد."));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteService.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } catch (e) {
      setDeleteError(formatApiError(e, "حذف خدمت انجام نشد."));
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">⚙️ خدمات</h2>
          <p className="text-slate-400 text-sm mt-1">مدیریت خدمات و تعرفه‌ها</p>
        </div>
        <button
          onClick={() => {
            setFormError("");
            setModal("add");
          }}
          className="inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-all duration-200 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-lg shadow-blue-500/25 px-5 py-2.5 text-sm"
        >
          + افزودن خدمت
        </button>
      </div>

      {loadError && (
        <div>
          <ErrorNotice
            message={formatApiError(loadError, "دریافت خدمات انجام نشد.")}
          />
          <Button variant="ghost" onClick={() => refetch()} disabled={loading}>
            تلاش دوباره
          </Button>
        </div>
      )}

      {/* Services Grid */}
      {loading ? (
        <Spinner size="lg" />
      ) : loadError && data === undefined ? null : list.length === 0 ? (
        <div className="text-center py-16 bg-slate-800/50 border border-slate-700/50 rounded-2xl">
          <p className="text-4xl mb-3">⚙️</p>
          <p className="text-slate-300 font-medium text-lg">خدمتی تعریف نشده</p>
          <p className="text-slate-500 text-sm mt-1">
            با کلیک روی افزودن خدمت، اولین سرویس خود را ایجاد کنید
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {list.map((svc) => (
            <div
              key={svc.id}
              className={`bg-slate-800/50 border rounded-2xl overflow-hidden transition-all group ${svc.is_active ? "border-slate-700/50" : "border-slate-700/30 opacity-60"}`}
            >
              {/* Card Header */}
              <div className="p-5 border-b border-slate-700/40">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-white font-semibold text-base truncate">
                      {svc.title}
                    </h3>
                    {svc.description && (
                      <p className="text-slate-500 text-xs mt-0.5 truncate">
                        {svc.description}
                      </p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 text-xs px-2 py-0.5 rounded-full border ${svc.is_active ? "bg-green-500/10 text-green-400 border-green-500/30" : "bg-slate-500/10 text-slate-400 border-slate-500/30"}`}
                  >
                    {svc.is_active ? "فعال" : "غیرفعال"}
                  </span>
                </div>
              </div>

              {/* Pricing */}
              <div className="p-5 space-y-2.5">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">مبلغ پرداختی</span>
                  <span className="text-white font-medium">
                    {fmt(svc.default_main_price)} تومان
                  </span>
                </div>
                {svc.has_extra && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">
                      {svc.extra_label || "استعلام"}
                    </span>
                    <span className="text-slate-300">
                      {fmt(svc.default_extra_price)} تومان
                    </span>
                  </div>
                )}
                {Number(svc.default_commission) > 0 && (
                  <div className="flex justify-between text-sm bg-yellow-500/5 border border-yellow-500/20 rounded-xl px-3 py-2">
                    <span className="text-yellow-400/80">
                      💼 {svc.commission_label || "کارمزد"}
                    </span>
                    <span className="text-yellow-400 font-medium">
                      {fmt(svc.default_commission)} تومان
                    </span>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 px-5 py-3 border-t border-slate-700/40 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity">
                <button
                  onClick={() => {
                    setFormError("");
                    setModal(svc);
                  }}
                  className="flex-1 py-1.5 text-xs rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 transition-all"
                >
                  ✏️ ویرایش
                </button>
                <button
                  onClick={() => {
                    setDeleteError("");
                    setDeleteTarget(svc);
                  }}
                  className="flex-1 py-1.5 text-xs rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-all"
                >
                  🗑️ حذف
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <ServiceModal
          initial={modal === "add" ? null : modal}
          onSave={handleSave}
          onClose={() => {
            if (!savingRef.current) setModal(null);
          }}
          loading={saving}
          error={formError}
        />
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        <ConfirmDialog
          isOpen
          onClose={() => {
            if (!deletingRef.current) setDeleteTarget(null);
          }}
          onConfirm={handleDelete}
          title="حذف خدمت"
          message={
            <>
              آیا از حذف خدمت «
              <span className="text-white">{deleteTarget.title}</span>» اطمینان
              دارید؟
            </>
          }
          loading={deleting}
          error={deleteError}
        />
      )}
    </div>
  );
};

export default Services;
