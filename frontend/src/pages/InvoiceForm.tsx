import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import type { ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useServices, serviceKeys } from "../hooks/useServices";
import { Spinner } from "../components/ui";
import {
  useCustomers,
  useCreateCustomer,
  customerKeys,
} from "../hooks/useCustomers";
import {
  invoicesAPI,
  vehicleTypesAPI,
  invoiceSettingsAPI,
  documentsAPI,
  servicePackagesAPI,
} from "../services/api";
import PriceInput from "../components/PriceInput";
import JalaliDatePicker from "../components/JalaliDatePicker";
import SearchableSelect from "../components/SearchableSelect";
import { toPersianKeyboard } from "../utils/persian";
import { computeRoundingAdjustment } from "../utils/money";
import { isMotoPlate } from "../lib/vehicle";
import { hideWaiting, showWaiting } from "../lib/waiting";
import { VehicleInfoFields } from "../components/VehicleInfoFields";
import { Field, Section, inputCls, selectCls } from "../components/FormSection";

const fmt = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("fa-IR").format(Number(n) || 0) + " تومان";

// ── Speed helpers: draft autosave + remembered operator defaults ──
const DRAFT_KEY = "mohaseb:invoice-draft:v1";
const DEFAULTS_KEY = "mohaseb:invoice-defaults:v1";

type InvoiceDefaults = { status?: string; card_payment_source?: string };

function loadInvoiceDefaults(): InvoiceDefaults {
  try {
    return JSON.parse(localStorage.getItem(DEFAULTS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

type ServicePackageOption = {
  id: number;
  name: string;
  services: number[];
  is_active: boolean;
};

const STATUS_OPTIONS = [
  { value: "draft", label: "پیش‌نویس" },
  { value: "pending", label: "پرداخت نشده" },
  { value: "paid", label: "پرداخت شده" },
  { value: "cancelled", label: "لغو شده" },
];
const PAPER_SIZES = [
  { value: "a5", label: "A5" },
  { value: "a4", label: "A4" },
  { value: "a6", label: "A6" },
];

type ServiceOption = {
  id: number;
  title: string;
  description?: string | null;
  is_active: boolean;
  default_main_price: number;
  default_extra_price: number;
};

type CustomerOption = {
  id: number;
  name: string;
  phone?: string | null;
  national_id?: string | null;
};

type VehicleType = {
  id?: number;
  name: string;
};

type InvoiceItemForm = {
  _key: number;
  service: string;
  service_title_snapshot: string;
  quantity: number | string;
  main_price: number | string;
  extra_price: number | string;
  notes: string;
};

type InvoiceFormState = {
  customer: string;
  status: string;
  card_payment_source: string;
  date: string;
  due_date: string;
  description: string;
  discount: number | string;
  tax: number | string;
  commission_total: number | string;
  rounding_enabled: boolean;
  rounding_target: number | string;
  rounding_show_amount: boolean;
  paper_size: string;
  vehicle_plate: string;
  vehicle_vin: string;
  vehicle_model: string;
  vehicle_type: string;
  vehicle_year: string;
  green_card_owner_name: string;
  green_card_owner_national_id: string;
  tags: string[];
};

type NewCustomerData = {
  name: string;
  phone: string;
  national_id: string;
  address: string;
};

type CreatedOption = {
  value: string;
  label: string;
};

type NewCustomerModalState = {
  pendingName: string;
  resolve: (value: CreatedOption | null) => void;
};

// ─── New Customer Modal ───────────────────────────────────────
type NewCustomerModalProps = {
  initialName?: string;
  onConfirm: (data: NewCustomerData) => void;
  onCancel: () => void;
  saving?: boolean;
  error?: string;
};

const NewCustomerModal = ({
  initialName,
  onConfirm,
  onCancel,
  saving,
  error,
}: NewCustomerModalProps) => {
  const [name, setName] = React.useState(initialName || "");
  const [phone, setPhone] = React.useState("");
  const [nationalId, setNationalId] = React.useState("");
  const [address, setAddress] = React.useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !name.trim()) return;
    onConfirm({
      name: name.trim(),
      phone: phone.trim(),
      national_id: nationalId.trim(),
      address: address.trim(),
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-customer-title"
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
    >
      <div className="bg-slate-800 border border-slate-700/60 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center gap-3 p-5 border-b border-slate-700/50">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500/30 to-blue-600/20 border border-indigo-500/30 flex items-center justify-center text-lg">
            👤
          </div>
          <div>
            <h3
              id="new-customer-title"
              className="text-white font-semibold text-sm"
            >
              افزودن مشتری جدید
            </h3>
            <p className="text-slate-500 text-xs mt-0.5">
              ثبت نام مشتری کافی است؛ سایر اطلاعات اختیاری هستند
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            aria-label="بستن پنجره مشتری"
            className="mr-auto text-slate-400 hover:text-white text-xl transition-colors disabled:opacity-50"
          >
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div
              role="alert"
              className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-400 text-sm"
            >
              {error}
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 font-medium">
              نام مشتری <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="نام کامل مشتری"
              className={inputCls}
              autoFocus
              required
              maxLength={255}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 font-medium">
              📞 شماره تماس <span className="text-slate-600">(اختیاری)</span>
            </label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="09xxxxxxxxx"
              className={inputCls}
              dir="ltr"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">
                کد ملی <span className="text-slate-600">(اختیاری)</span>
              </label>
              <input
                type="text"
                value={nationalId}
                onChange={(e) => setNationalId(e.target.value)}
                placeholder="کد ملی"
                className={inputCls}
                dir="ltr"
                maxLength={15}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">
                آدرس <span className="text-slate-600">(اختیاری)</span>
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="آدرس کوتاه"
                className={inputCls}
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-700 transition-all"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                "✅"
              )}
              ثبت مشتری
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─── Service Picker Modal ────────────────────────────────────
type ServicePickerModalProps = {
  services: ServiceOption[];
  onAdd: (rows: InvoiceItemForm[]) => void;
  onClose: () => void;
};

const ServicePickerModal = ({
  services,
  onAdd,
  onClose,
}: ServicePickerModalProps) => {
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [search, setSearch] = useState("");

  const toggle = (id: number) =>
    setSelected((p) => {
      const copy = { ...p };
      if (copy[id]) delete copy[id];
      else copy[id] = true;
      return copy;
    });

  const selectAll = () => {
    const obj: Record<number, boolean> = {};
    filtered.forEach((s) => {
      obj[s.id] = true;
    });
    setSelected(obj);
  };

  const filtered = services.filter(
    (s) => s.is_active && s.title.toLowerCase().includes(search.toLowerCase()),
  );
  const count = Object.keys(selected).length;

  const handleAdd = () => {
    const rows = services
      .filter((s) => selected[s.id])
      .map((s) => ({
        _key: Math.random(),
        service: String(s.id),
        service_title_snapshot: s.title,
        quantity: 1,
        main_price:
          Number(s.default_main_price) > 0 ? s.default_main_price : "",
        extra_price: s.default_extra_price || 0,
        notes: "",
      }));
    onAdd(rows);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700/60 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-700/50">
          <h3 className="text-white font-semibold">انتخاب خدمات</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xl transition-colors"
          >
            ×
          </button>
        </div>

        {/* Search + Select All */}
        <div className="px-5 pt-4 space-y-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجوی خدمت..."
            className={inputCls}
            autoFocus
          />
          <div className="flex items-center justify-between">
            <button
              onClick={selectAll}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              انتخاب همه ({filtered.length})
            </button>
            {count > 0 && (
              <span className="text-xs bg-blue-500/20 text-blue-300 px-2.5 py-1 rounded-full border border-blue-500/30">
                {count} خدمت انتخاب شده
              </span>
            )}
          </div>
        </div>

        {/* Service List */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1.5">
          {filtered.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-8">
              خدمتی یافت نشد
            </p>
          ) : (
            filtered.map((svc) => (
              <button
                key={svc.id}
                type="button"
                onClick={() => toggle(svc.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-all text-right ${
                  selected[svc.id]
                    ? "bg-blue-500/15 border border-blue-500/40 text-blue-200"
                    : "bg-slate-700/30 border border-slate-700/30 text-slate-300 hover:bg-slate-700/50"
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-md border-2 flex items-center justify-center text-xs shrink-0 transition-all ${
                    selected[svc.id]
                      ? "bg-blue-500 border-blue-500 text-white"
                      : "border-slate-500"
                  }`}
                >
                  {selected[svc.id] && "✓"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{svc.title}</p>
                  {svc.description && (
                    <p className="text-slate-500 text-xs truncate mt-0.5">
                      {svc.description}
                    </p>
                  )}
                </div>
                <span className="text-xs text-slate-400 shrink-0">
                  {fmt(svc.default_main_price)}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 justify-between items-center p-5 border-t border-slate-700/50">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-700 transition-all"
          >
            انصراف
          </button>
          <button
            onClick={handleAdd}
            disabled={count === 0}
            className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm transition-all disabled:opacity-40 flex items-center gap-2"
          >
            ➕ افزودن {count > 0 ? `${count} خدمت` : ""}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Compact Item Row ────────────────────────────────────────
type ItemRowProps = {
  item: InvoiceItemForm;
  idx: number;
  services: ServiceOption[];
  onChange: (idx: number, item: InvoiceItemForm) => void;
  onRemove: (idx: number) => void;
};

const ItemRow = ({ item, idx, services, onChange, onRemove }: ItemRowProps) => {
  const lineTotal =
    ((Number(item.main_price) || 0) + (Number(item.extra_price) || 0)) *
    (Number(item.quantity) || 1);

  return (
    <div className="flex items-start gap-2 group">
      <span className="text-xs text-slate-500 bg-slate-700/50 px-2 py-1 rounded-lg mt-2.5 shrink-0">
        {idx + 1}
      </span>
      <div className="flex-1 grid grid-cols-12 gap-2 items-end">
        {/* Title */}
        <div className="col-span-12 sm:col-span-4">
          <label className="text-[10px] text-slate-500 mb-0.5 block">
            خدمت
          </label>
          <input
            type="text"
            value={item.service_title_snapshot}
            onChange={(e) =>
              onChange(idx, {
                ...item,
                service_title_snapshot: toPersianKeyboard(e.target.value),
              })
            }
            placeholder="عنوان خدمت"
            className={inputCls}
          />
        </div>
        {/* Qty */}
        <div className="col-span-3 sm:col-span-2">
          <label className="text-[10px] text-slate-500 mb-0.5 block">
            تعداد
          </label>
          <input
            type="number"
            min="1"
            value={item.quantity}
            onChange={(e) =>
              onChange(idx, { ...item, quantity: e.target.value })
            }
            className={inputCls}
          />
        </div>
        {/* Main Price */}
        <div className="col-span-4 sm:col-span-2">
          <label className="text-[10px] text-slate-500 mb-0.5 block">
            مبلغ پرداختی
          </label>
          <PriceInput
            value={item.main_price}
            blankWhenZero
            placeholder="مبلغ را وارد کنید"
            onChange={(v) => onChange(idx, { ...item, main_price: v })}
          />
        </div>
        {/* Extra Price */}
        <div className="col-span-4 sm:col-span-2">
          <label className="text-[10px] text-slate-500 mb-0.5 block">
            مبلغ استعلامی
          </label>
          <PriceInput
            value={item.extra_price}
            onChange={(v) => onChange(idx, { ...item, extra_price: v })}
          />
        </div>
        {/* Line Total */}
        <div className="col-span-3 sm:col-span-1 flex items-end pb-1">
          <span className="text-xs text-slate-400 whitespace-nowrap">
            {fmt(lineTotal)}
          </span>
        </div>
        {/* Remove */}
        <div className="col-span-2 sm:col-span-1 flex items-end pb-0.5">
          <button
            type="button"
            onClick={() => onRemove(idx)}
            className="text-red-400/60 hover:text-red-400 hover:bg-red-500/10 rounded-lg p-2 transition-all text-xs opacity-0 group-hover:opacity-100"
          >
            🗑️
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Main Component ──────────────────────────────────────────
const InvoiceForm = () => {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const [searchParams] = useSearchParams();
  // «صدور مشابه»: /invoices/new?clone=<id> prefills the form from that invoice.
  const cloneId = !isEdit ? searchParams.get("clone") : null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: servicesData } = useServices();
  const services = (servicesData ?? []) as ServiceOption[];
  const { data: customersData } = useCustomers();
  const customers = (customersData ?? []) as CustomerOption[];
  const { mutateAsync: createCustomerAsync } = useCreateCustomer();

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [creatingVehicleType, setCreatingVehicleType] = useState(false);
  const [inlineNotice, setInlineNotice] = useState("");
  // Snapshot of the rounding rule the loaded invoice had: its
  // pre-rounding base and its manual target ("" = auto). A stored manual
  // target is one-shot — once the amounts move, it is dropped live (see
  // the effect below) and the server drops it on save.
  const [loadedRoundingBase, setLoadedRoundingBase] = useState<number | null>(
    null,
  );
  const [loadedRoundingTarget, setLoadedRoundingTarget] = useState("");
  const [roundingClearedNotice, setRoundingClearedNotice] = useState(false);
  const [invoiceDocuments, setInvoiceDocuments] = useState<File[]>([]);
  // New customer modal state
  const [newCustomerModal, setNewCustomerModal] =
    useState<NewCustomerModalState | null>(null); // null | { pendingName, resolve }
  const [customerError, setCustomerError] = useState("");

  useEffect(() => {
    vehicleTypesAPI
      .list()
      .then(({ data }) => setVehicleTypes(data))
      .catch(() => {});
  }, []);

  // ── Auto-create customer (opens modal for phone/details) ─────────
  const handleCreateCustomer = useCallback(async (name: string) => {
    // Open modal to collect optional customer details
    setCustomerError("");
    return new Promise<CreatedOption | null>((resolve) => {
      setNewCustomerModal({ pendingName: name, resolve });
    });
  }, []);

  const handleCustomerModalConfirm = useCallback(
    async (customerData: NewCustomerData) => {
      if (!newCustomerModal || creatingCustomer) return;
      const { resolve } = newCustomerModal;
      setCreatingCustomer(true);
      setCustomerError("");
      setInlineNotice("");
      try {
        const data = (await createCustomerAsync(customerData)) as {
          id: number;
          name: string;
        };
        setError("");
        setNewCustomerModal(null);
        setInlineNotice(`✅ مشتری جدید «${data.name}» ثبت شد`);
        setTimeout(() => setInlineNotice(""), 4000);
        resolve({ value: String(data.id), label: data.name });
      } catch (err) {
        const details =
          typeof err === "object" && err !== null
            ? Object.values(err)
                .flat()
                .filter((message) => typeof message === "string")
                .join("، ")
            : err;
        setCustomerError(details || "خطا در ثبت مشتری؛ دوباره تلاش کنید");
      } finally {
        setCreatingCustomer(false);
      }
    },
    [createCustomerAsync, newCustomerModal, creatingCustomer],
  );

  const handleCustomerModalCancel = useCallback(() => {
    if (creatingCustomer) return;
    if (newCustomerModal?.resolve) newCustomerModal.resolve(null);
    setNewCustomerModal(null);
  }, [newCustomerModal, creatingCustomer]);

  // ── Auto-create vehicle type ──────────────────────────────────
  const handleCreateVehicleType = useCallback(async (name: string) => {
    setCreatingVehicleType(true);
    setInlineNotice("");
    try {
      const { data } = await vehicleTypesAPI.create({ name });
      setVehicleTypes((prev) => [...prev, data]);
      setInlineNotice(`✅ نوع خودرو «${data.name}» به لیست اضافه شد`);
      setTimeout(() => setInlineNotice(""), 4000);
      return { value: data.name, label: data.name };
    } catch (err) {
      const msg = err.response?.data?.name?.[0] || "خطا در ثبت نوع خودرو";
      setError(msg);
      return null;
    } finally {
      setCreatingVehicleType(false);
    }
  }, []);

  const [form, setForm] = useState<InvoiceFormState>(() => {
    // New invoices always start UNPAID (pending): the operator marks an
    // invoice paid explicitly. Only the card source is remembered from
    // the operator defaults — a remembered "paid" status here silently
    // hid invoices from the default (pending) list filter.
    const defaults = loadInvoiceDefaults();
    return {
      customer: "",
      status: "pending",
      card_payment_source: defaults.card_payment_source || "customer",
      date: new Date().toISOString().slice(0, 10),
      due_date: "",
      description: "",
      discount: 0,
      tax: 0,
      commission_total: 0,
      rounding_enabled: false,
      rounding_target: "",
      rounding_show_amount: false,
      paper_size: "a5",
      vehicle_plate: "",
      vehicle_vin: "",
      vehicle_model: "",
      vehicle_type: "",
      vehicle_year: "",
      green_card_owner_name: "",
      green_card_owner_national_id: "",
      tags: [],
    };
  });
  const [items, setItems] = useState<InvoiceItemForm[]>([]);
  const [packages, setPackages] = useState<ServicePackageOption[]>([]);
  const [plateSuggestion, setPlateSuggestion] = useState<any>(null);
  const [plateDismissedFor, setPlateDismissedFor] = useState("");
  const [draftRestored, setDraftRestored] = useState(false);
  const [showGreenCard, setShowGreenCard] = useState(false);
  const appliedPlateRef = useRef("");
  const [officeCardThreshold, setOfficeCardThreshold] = useState(0);
  const [invoiceFields, setInvoiceFields] = useState({
    show_discount_field: true,
    show_tax_field: true,
  });
  // null = invoice settings not loaded yet; clone prefill waits for it.
  const [cloneEnabled, setCloneEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    const refreshReferences = () => {
      queryClient.invalidateQueries({ queryKey: serviceKeys.all });
      queryClient.invalidateQueries({ queryKey: customerKeys.all });
    };
    window.addEventListener("mohaseb:data-changed", refreshReferences);
    invoiceSettingsAPI
      .get()
      .then(({ data }) => {
        setOfficeCardThreshold(Number(data.office_card_fee_threshold) || 0);
        setInvoiceFields({
          show_discount_field: data.show_discount_field !== false,
          show_tax_field: data.show_tax_field !== false,
        });
        setCloneEnabled(data.enable_invoice_clone !== false);
      })
      .catch(() => setCloneEnabled(true));
    return () =>
      window.removeEventListener("mohaseb:data-changed", refreshReferences);
  }, [queryClient]);

  // Maps an API invoice into form state. In clone mode the copy becomes a
  // fresh invoice: today's date, no due date, and status reset to unpaid
  // (pending) — payments are never carried over.
  const applyInvoiceData = useCallback((data: any, forClone: boolean) => {
    setForm({
      customer: data.customer || "",
      status: forClone ? "pending" : data.status || "pending",
      card_payment_source: data.card_payment_source || "customer",
      date: forClone
        ? new Date().toISOString().slice(0, 10)
        : data.date
          ? data.date.slice(0, 10)
          : "",
      due_date: forClone ? "" : data.due_date || "",
      description: data.description || "",
      discount: data.discount || 0,
      tax: data.tax || 0,
      commission_total: data.commission_total || 0,
      // The stored rounding RULE loads as-is: a manual target only when
      // the invoice actually has one; auto mode loads with an empty
      // target. Never pin the current payable here — that froze the
      // rounded total against later amount changes.
      rounding_enabled: !!data.rounding_enabled,
      rounding_target:
        data.rounding_target != null ? String(data.rounding_target) : "",
      rounding_show_amount: !!data.rounding_show_amount,
      paper_size: data.paper_size || "a5",
      vehicle_plate: data.vehicle_plate || "",
      vehicle_vin: data.vehicle_vin || "",
      vehicle_model: data.vehicle_model || "",
      vehicle_type: data.vehicle_type || "",
      vehicle_year: data.vehicle_year || "",
      green_card_owner_name: data.green_card_owner_name || "",
      green_card_owner_national_id: data.green_card_owner_national_id || "",
      tags: data.tags || [],
    });
    // Remember the loaded rounding rule so amount changes can drop a
    // stale manual target (a clone carries the same amounts, so the
    // snapshot stays valid for it too).
    setLoadedRoundingBase(
      data.rounding_enabled
        ? Number(data.final_amount || 0) - Number(data.rounding_amount || 0)
        : null,
    );
    setLoadedRoundingTarget(
      data.rounding_target != null ? String(data.rounding_target) : "",
    );
    setRoundingClearedNotice(false);
    setItems(
      (data.items || [])
        .filter((it: any) => !it.is_office_card_fee)
        .map((it: any) => ({
          _key: Math.random(),
          service: it.service || "",
          service_title_snapshot:
            it.service_title_snapshot || it.service_title || "",
          quantity: it.quantity || 1,
          main_price: it.main_price || "",
          extra_price: it.extra_price || "",
          notes: it.notes || "",
        })),
    );
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    invoicesAPI
      .detail(id)
      .then(({ data }) => applyInvoiceData(data, false))
      .catch(() => navigate("/invoices"))
      .finally(() => setLoading(false));
  }, [id, isEdit, applyInvoiceData, navigate]);

  // Clone mode («صدور مشابه»): prefill from the referenced invoice.
  // Gated on the enable_invoice_clone setting (Settings → تنظیمات فاکتور).
  useEffect(() => {
    if (isEdit || !cloneId || cloneEnabled !== true) return;
    invoicesAPI
      .detail(cloneId)
      .then(({ data }) => {
        applyInvoiceData(data, true);
        setInlineNotice(
          `📋 بر اساس فاکتور ${data.invoice_number} بارگذاری شد — بررسی کنید و ثبت بزنید`,
        );
        setTimeout(() => setInlineNotice(""), 6000);
      })
      .catch(() => setError("بارگذاری فاکتور مرجع ممکن نشد"));
  }, [cloneId, isEdit, applyInvoiceData, cloneEnabled]);

  // Service packages (arranged by the manager in Settings).
  useEffect(() => {
    servicePackagesAPI
      .list({ active: 1 })
      .then(({ data }) =>
        setPackages((data?.results || data || []) as ServicePackageOption[]),
      )
      .catch(() => {});
  }, []);

  // Plate-first: once a complete plate is typed, offer the latest invoice
  // issued for it so the operator can reuse its customer/vehicle/rows.
  useEffect(() => {
    if (isEdit) return undefined;
    const plate = (form.vehicle_plate || "").trim();
    const isComplete =
      /^\d{2}\s+\S+\s+\d{3}\s*-\s*ایران\s*\d{2}$/.test(plate) ||
      /^\d{3}-\d{5}$/.test(plate);
    if (
      !isComplete ||
      plate === plateDismissedFor ||
      plate === appliedPlateRef.current
    ) {
      setPlateSuggestion(null);
      return undefined;
    }
    const timer = setTimeout(() => {
      invoicesAPI
        .list({ vehicle_plate: plate })
        .then(({ data }) => {
          const rows = (data?.results || data || []) as any[];
          const found =
            rows.find((r) => (r.vehicle_plate || "").trim() === plate) ||
            rows[0];
          setPlateSuggestion(
            found && String(found.id) !== String(cloneId) ? found : null,
          );
        })
        .catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [form.vehicle_plate, isEdit, plateDismissedFor, cloneId]);

  const handleUsePlateSuggestion = useCallback(() => {
    if (!plateSuggestion) return;
    invoicesAPI
      .detail(plateSuggestion.id)
      .then(({ data }) => {
        applyInvoiceData(data, true);
        appliedPlateRef.current = (form.vehicle_plate || "").trim();
        setPlateSuggestion(null);
        setInlineNotice(
          `🔁 مشخصات و ردیف‌های فاکتور ${data.invoice_number} بارگذاری شد`,
        );
        setTimeout(() => setInlineNotice(""), 6000);
      })
      .catch(() => setError("بارگذاری فاکتور قبلی ممکن نشد"));
  }, [plateSuggestion, applyInvoiceData, form.vehicle_plate]);

  const handleApplyPackage = useCallback(
    (pkg: ServicePackageOption) => {
      const rows = pkg.services
        .map((serviceId) => services.find((s) => s.id === serviceId))
        .filter((s): s is ServiceOption => Boolean(s && s.is_active))
        .map((s) => ({
          _key: Math.random(),
          service: String(s.id),
          service_title_snapshot: s.title,
          quantity: 1,
          main_price:
            Number(s.default_main_price) > 0 ? s.default_main_price : "",
          extra_price: s.default_extra_price || 0,
          notes: "",
        }));
      if (rows.length === 0) {
        setError("این پکیج خدمت فعالی ندارد");
        return;
      }
      setItems((prev) => [...prev, ...rows]);
      setInlineNotice(`📦 پکیج «${pkg.name}» اضافه شد (${rows.length} ردیف)`);
      setTimeout(() => setInlineNotice(""), 4000);
    },
    [services],
  );

  // ── Draft autosave (new invoices only) ──────────────────────────
  const draftReadyRef = useRef(false);
  // In-flight lock + waiting modal: while this user's save is running,
  // no second submit (double click / Enter / shortcut) can start.
  const submitLockRef = useRef(false);
  useEffect(() => {
    if (!isEdit && !cloneId) {
      try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (raw) {
          const draft = JSON.parse(raw);
          if (
            draft?.form &&
            (draft.form.customer ||
              draft.form.vehicle_plate ||
              draft.form.vehicle_vin ||
              draft.form.vehicle_model ||
              draft.form.description ||
              draft.form.green_card_owner_name ||
              Number(draft.form.discount) > 0 ||
              Number(draft.form.tax) > 0 ||
              Number(draft.form.commission_total) > 0 ||
              (draft.items || []).length > 0)
          ) {
            setForm(draft.form);
            setItems(draft.items || []);
            setDraftRestored(true);
          }
        }
      } catch {
        /* corrupted draft: ignore */
      }
    }
    draftReadyRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isEdit || !draftReadyRef.current) return undefined;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ form, items, savedAt: Date.now() }),
        );
      } catch {
        /* storage full/blocked: autosave is best-effort */
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [form, items, isEdit]);

  const handleDiscardDraft = useCallback(() => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    const defaults = loadInvoiceDefaults();
    setForm({
      customer: "",
      status: "pending",
      card_payment_source: defaults.card_payment_source || "customer",
      date: new Date().toISOString().slice(0, 10),
      due_date: "",
      description: "",
      discount: 0,
      tax: 0,
      commission_total: 0,
      rounding_enabled: false,
      rounding_target: "",
      rounding_show_amount: false,
      paper_size: "a5",
      vehicle_plate: "",
      vehicle_vin: "",
      vehicle_model: "",
      vehicle_type: "",
      vehicle_year: "",
      green_card_owner_name: "",
      green_card_owner_national_id: "",
      tags: [],
    });
    setItems([]);
    setDraftRestored(false);
  }, []);

  // Expand the optional green-card section once it carries values.
  useEffect(() => {
    if (form.green_card_owner_name || form.green_card_owner_national_id)
      setShowGreenCard(true);
  }, [form.green_card_owner_name, form.green_card_owner_national_id]);

  // Calculations
  const subtotal = items.reduce(
    (s, it) =>
      s +
      ((Number(it.main_price) || 0) + (Number(it.extra_price) || 0)) *
        (Number(it.quantity) || 1),
    0,
  );
  const commissionAmt = Number(form.commission_total || 0);
  const officeCardFee =
    form.card_payment_source === "office" &&
    officeCardThreshold > 0 &&
    subtotal > officeCardThreshold
      ? Math.floor(subtotal / 100)
      : 0;
  const taxAmount = ((subtotal + officeCardFee) * Number(form.tax || 0)) / 100;
  const finalAmount =
    subtotal +
    officeCardFee +
    commissionAmt +
    taxAmount -
    Number(form.discount || 0);
  // Optional rounding (user's choice): a typed target wins; otherwise the
  // final rounds to the nearest 10,000 Toman (5,000+ rounds up). The
  // server re-derives the same adjustment — this is the live preview.
  const roundingAdjustment = form.rounding_enabled
    ? computeRoundingAdjustment(
        finalAmount,
        Number(form.rounding_target) > 0 ? Number(form.rounding_target) : null,
      )
    : 0;
  const payableAmount = finalAmount + roundingAdjustment;

  // A stored manual rounding is one-shot: once the amounts move, the
  // server drops it on save. Mirror that live — clear the field and
  // warn, so the operator sees it before saving instead of after.
  useEffect(() => {
    // Compare whole Tomans: the client total is a float, the server
    // base can carry fractions — float dust must not drop the target.
    if (
      loadedRoundingTarget !== "" &&
      loadedRoundingBase != null &&
      Math.round(finalAmount) !== Math.round(loadedRoundingBase) &&
      form.rounding_target !== ""
    ) {
      setField("rounding_target", "");
      setRoundingClearedNotice(true);
    }
    // Intentionally only on the live base changing; setField is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalAmount, loadedRoundingBase, loadedRoundingTarget]);

  const handleItemChange = useCallback(
    (idx: number, updated: InvoiceItemForm) => {
      setItems((prev) => prev.map((it, i) => (i === idx ? updated : it)));
    },
    [],
  );
  const handleRemoveItem = useCallback((idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }, []);
  const handleAddManualRow = () => {
    setItems((prev) => [
      ...prev,
      {
        _key: Math.random(),
        service: "",
        service_title_snapshot: "",
        quantity: 1,
        main_price: "",
        extra_price: "",
        notes: "",
      },
    ]);
  };
  const handleAddFromPicker = (rows: InvoiceItemForm[]) =>
    setItems((prev) => [...prev, ...rows]);

  const setField = (
    k: keyof InvoiceFormState,
    v: string | number | string[] | boolean,
  ) => setForm((f) => ({ ...f, [k]: v }) as InvoiceFormState);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current) return;
    if (!form.customer) {
      setError("لطفاً مشتری را انتخاب کنید");
      return;
    }
    if (items.length === 0) {
      setError("حداقل یک ردیف وارد کنید");
      return;
    }
    setError("");
    setSaving(true);
    submitLockRef.current = true;
    showWaiting(isEdit ? "در حال ذخیرهٔ فاکتور…" : "در حال ثبت فاکتور…");
    const payload = {
      ...form,
      customer: Number(form.customer),
      discount: Number(form.discount) || 0,
      tax: Number(form.tax) || 0,
      commission_total: Number(form.commission_total) || 0,
      rounding_enabled: !!form.rounding_enabled,
      rounding_target:
        form.rounding_enabled && Number(form.rounding_target) > 0
          ? Number(form.rounding_target)
          : null,
      rounding_show_amount: !!form.rounding_show_amount,
      due_date: form.due_date || null,
      vehicle_year: form.vehicle_year || "",
      green_card_owner_name: form.green_card_owner_name || "",
      green_card_owner_national_id: form.green_card_owner_national_id || "",
      tags: form.tags || [],
      items: items.map((it) => ({
        service: it.service ? Number(it.service) : null,
        service_title_snapshot: it.service_title_snapshot || "",
        quantity: Number(it.quantity) || 1,
        main_price: Number(it.main_price) || 0,
        extra_price: Number(it.extra_price) || 0,
        commission: 0,
        notes: it.notes || "",
      })),
    };
    try {
      if (isEdit) {
        const { data } = await invoicesAPI.update(id, payload);
        // The server drops a stale manual rounding on save; the form
        // already warned live, but flag it for the details page too so
        // the message survives the navigation.
        if (data?.rounding_cleared) {
          try {
            sessionStorage.setItem("mohaseb:rounding-cleared", "1");
          } catch {
            /* storage blocked: non-fatal */
          }
        }
        navigate(`/invoices/${id}`);
      } else {
        const { data } = await invoicesAPI.create(payload);
        // A saved invoice ends the draft; remember the operator's
        // status/card choices as the next invoice's defaults.
        try {
          localStorage.removeItem(DRAFT_KEY);
          localStorage.setItem(
            DEFAULTS_KEY,
            JSON.stringify({
              status: form.status,
              card_payment_source: form.card_payment_source,
            }),
          );
        } catch {
          /* storage blocked: non-fatal */
        }
        for (const file of invoiceDocuments) {
          const fd = new FormData();
          fd.append("customer", String(form.customer));
          fd.append("invoice", String(data.id));
          fd.append("title", file.name);
          fd.append("file", file);
          await documentsAPI.create(fd);
        }
        navigate(`/invoices/${data.id}`);
      }
    } catch (err) {
      const msg = err.response?.data;
      setError(
        typeof msg === "object" ? JSON.stringify(msg) : "خطا در ذخیره فاکتور",
      );
    } finally {
      submitLockRef.current = false;
      hideWaiting();
      setSaving(false);
    }
  };

  if (loading)
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );

  return (
    <>
      <form
        onSubmit={handleSubmit}
        onKeyDown={(e) => {
          // Ctrl+Enter submits the invoice from any field.
          if (e.ctrlKey && e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.requestSubmit();
            return;
          }
          // Enter moves to the next field instead of submitting, so the
          // whole form can be filled keyboard-only. Left alone: textareas,
          // buttons, open combobox dropdowns (Enter picks an option there),
          // and anything inside a listbox.
          if (e.key !== "Enter" || e.shiftKey || e.altKey || e.metaKey) return;
          const target = e.target as HTMLElement;
          if (
            target.tagName === "TEXTAREA" ||
            target.tagName === "BUTTON" ||
            target.closest('[role="listbox"]') ||
            target.getAttribute("aria-expanded") === "true" ||
            (!(target instanceof HTMLInputElement) &&
              target.tagName !== "SELECT")
          )
            return;
          const input = target as HTMLInputElement;
          if (input.type === "file" || input.type === "checkbox") return;
          const focusables = Array.from(
            e.currentTarget.querySelectorAll<HTMLElement>(
              'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])',
            ),
          ).filter((el) => el.offsetParent !== null);
          const idx = focusables.indexOf(target);
          if (idx >= 0 && idx < focusables.length - 1) {
            e.preventDefault();
            const next = focusables[idx + 1];
            next.focus();
            if (next instanceof HTMLInputElement) next.select?.();
          }
        }}
        className="space-y-5 max-w-5xl mx-auto"
      >
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={() => navigate(isEdit ? `/invoices/${id}` : "/invoices")}
              className="text-slate-400 hover:text-white text-sm mb-1 flex items-center gap-1 transition-colors"
            >
              ← بازگشت
            </button>
            <h2 className="text-2xl font-bold text-white">
              {isEdit ? `ویرایش فاکتور` : "صدور فاکتور جدید"}
            </h2>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => navigate(isEdit ? `/invoices/${id}` : "/invoices")}
              className="px-4 py-2 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-700 transition-all"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-all disabled:opacity-60 flex items-center gap-2"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{" "}
                  ذخیره...
                </>
              ) : isEdit ? (
                "💾 ذخیره"
              ) : (
                "✅ ثبت فاکتور"
              )}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
            {error}
          </div>
        )}
        {inlineNotice && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 text-emerald-400 text-sm flex items-center gap-2">
            {inlineNotice}
          </div>
        )}
        {draftRestored && !isEdit && (
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-3 text-blue-300 text-sm flex flex-wrap items-center gap-3">
            <span>💾 پیش‌نویس ناتمام شما بازیابی شد تا از اول شروع نکنید.</span>
            <button
              type="button"
              onClick={handleDiscardDraft}
              className="px-3 py-1 rounded-lg border border-blue-500/40 text-blue-200 text-xs hover:bg-blue-500/20 transition-all"
            >
              شروع تازه (حذف پیش‌نویس)
            </button>
          </div>
        )}

        {/* Customer + Status */}
        <Section title="مشتری و وضعیت" icon="👤">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Field label="مشتری" required className="lg:col-span-2">
              <SearchableSelect
                value={form.customer}
                onChange={(v) => setField("customer", v)}
                options={customers.map((c) => ({
                  value: String(c.id),
                  label: c.name,
                  sub: c.phone || c.national_id || undefined,
                }))}
                placeholder="— انتخاب مشتری —"
                searchPlaceholder="جستجو یا افزودن مشتری جدید..."
                required
                clearable={false}
                creatable
                createFirst
                onCreateOption={handleCreateCustomer}
                creating={creatingCustomer}
                createLabel={(name) =>
                  name ? (
                    <>
                      <span className="text-slate-400">
                        افزودن مشتری جدید:{" "}
                      </span>
                      <span className="font-medium">«{name}»</span>
                    </>
                  ) : (
                    <span className="font-medium">افزودن مشتری جدید</span>
                  )
                }
              />
            </Field>
            <Field label="وضعیت فاکتور">
              <SearchableSelect
                value={form.status}
                onChange={(v) => setField("status", v)}
                options={STATUS_OPTIONS.map((s) => ({
                  value: s.value,
                  label: s.label,
                }))}
                placeholder="وضعیت"
                clearable={false}
              />
            </Field>
            <Field label="کارت پرداخت">
              <SearchableSelect
                value={form.card_payment_source}
                onChange={(v) => setField("card_payment_source", v)}
                options={[
                  { value: "customer", label: "کارت مشتری" },
                  { value: "office", label: "کارت دفتر" },
                ]}
                placeholder="انتخاب کارت"
                clearable={false}
              />
            </Field>
            <Field label="سایز کاغذ">
              <SearchableSelect
                value={form.paper_size}
                onChange={(v) => setField("paper_size", v)}
                options={PAPER_SIZES.map((p) => ({
                  value: p.value,
                  label: p.label,
                }))}
                placeholder="سایز"
                clearable={false}
              />
            </Field>
            <Field label="تاریخ فاکتور">
              <JalaliDatePicker
                value={form.date}
                onChange={(v) => setField("date", v)}
                required
              />
            </Field>
            <Field label="تاریخ سررسید">
              <JalaliDatePicker
                value={form.due_date}
                onChange={(v) => setField("due_date", v)}
                placeholder="بدون سررسید"
              />
            </Field>
          </div>
        </Section>

        {/* Vehicle */}
        <VehicleInfoFields
          values={{
            vehicle_plate: form.vehicle_plate,
            vehicle_vin: form.vehicle_vin,
            vehicle_model: form.vehicle_model,
            vehicle_type: form.vehicle_type,
            vehicle_year: form.vehicle_year,
          }}
          onPlateChange={(v) => {
            const wasMoto = isMotoPlate(form.vehicle_plate || "");
            const isMotoNow = isMotoPlate(v || "");
            // Atomically update both fields to avoid stale-closure double-setState bug
            setForm((f) => ({
              ...f,
              vehicle_plate: v,
              ...(wasMoto !== isMotoNow ? { vehicle_type: "" } : {}),
            }));
          }}
          onFieldChange={(name, value) => setField(name, value)}
          vehicleTypes={vehicleTypes}
          onCreateVehicleType={handleCreateVehicleType}
          creatingVehicleType={creatingVehicleType}
          plateSuggestion={plateSuggestion}
          onUsePlateSuggestion={handleUsePlateSuggestion}
          onDismissPlateSuggestion={() =>
            setPlateDismissedFor((form.vehicle_plate || "").trim())
          }
          formatAmount={fmt}
        />

        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowGreenCard((v) => !v)}
            className="w-full flex items-center gap-2 px-6 py-4 bg-slate-700/20 hover:bg-slate-700/30 transition-colors text-right"
            aria-expanded={showGreenCard}
          >
            <span className="text-lg">🪪</span>
            <h3 className="text-white font-semibold text-sm">صاحب برگ سبز</h3>
            <span className="text-[11px] text-slate-500">(اختیاری)</span>
            <span className="mr-auto text-slate-400 text-xs">
              {showGreenCard ? "▾ بستن" : "▸ باز کردن"}
            </span>
          </button>
          {showGreenCard && (
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="نام مندرج روی برگ سبز">
                  <input
                    type="text"
                    value={form.green_card_owner_name}
                    onChange={(e) =>
                      setField(
                        "green_card_owner_name",
                        toPersianKeyboard(e.target.value),
                      )
                    }
                    className={inputCls}
                    placeholder="نام صاحب خودرو"
                    maxLength={255}
                  />
                </Field>
                <Field label="کد ملی صاحب خودرو">
                  <input
                    type="text"
                    value={form.green_card_owner_national_id}
                    onChange={(e) =>
                      setField("green_card_owner_national_id", e.target.value)
                    }
                    className={inputCls}
                    placeholder="کد ملی"
                    dir="ltr"
                    maxLength={20}
                  />
                </Field>
              </div>
            </div>
          )}
        </div>

        {/* Items */}
        <Section title={`ردیف‌های فاکتور (${items.length})`} icon="🧾">
          {packages.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className="text-xs text-slate-400">📦 پکیج‌های آماده:</span>
              {packages.map((pkg) => (
                <button
                  key={pkg.id}
                  type="button"
                  onClick={() => handleApplyPackage(pkg)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-violet-500/10 text-violet-300 border border-violet-500/25 hover:bg-violet-500/20 transition-all"
                >
                  📦 {pkg.name}
                  <span className="opacity-60">
                    {" "}
                    ({pkg.services.length} خدمت)
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="space-y-2">
            {items.map((item, idx) => (
              <ItemRow
                key={item._key}
                item={item}
                idx={idx}
                services={services}
                onChange={handleItemChange}
                onRemove={handleRemoveItem}
              />
            ))}
          </div>

          {items.length === 0 && (
            <div className="text-center py-8 text-slate-500">
              <p className="text-3xl mb-2">📋</p>
              <p className="text-sm">
                هنوز خدمتی اضافه نشده — از دکمه‌های زیر استفاده کنید
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-3 mt-4">
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              className="flex-1 min-w-[200px] py-3 rounded-xl bg-blue-500/10 border-2 border-dashed border-blue-500/40 text-blue-400 hover:bg-blue-500/15 hover:border-blue-500/60 transition-all text-sm font-medium flex items-center justify-center gap-2"
            >
              ⚡ انتخاب از لیست خدمات
            </button>
            <button
              type="button"
              onClick={handleAddManualRow}
              className="py-3 px-5 rounded-xl border-2 border-dashed border-slate-600 text-slate-400 hover:border-slate-500 hover:text-slate-300 transition-all text-sm"
            >
              + ردیف دستی
            </button>
          </div>
        </Section>

        {form.card_payment_source === "office" && officeCardFee > 0 && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            با توجه به مبلغ خدمات و کارت دفتر، ردیف «واریزی» به مبلغ{" "}
            {fmt(officeCardFee)} به‌صورت خودکار به فاکتور اضافه می‌شود.
          </div>
        )}

        {/* Financial Summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Section title="خلاصه مالی" icon="💰">
            <div className="space-y-3">
              <div
                className={`grid grid-cols-1 ${invoiceFields.show_discount_field && invoiceFields.show_tax_field ? "sm:grid-cols-2" : ""} gap-3`}
              >
                {invoiceFields.show_discount_field && (
                  <Field label="تخفیف">
                    <PriceInput
                      value={form.discount}
                      onChange={(v) => setField("discount", v)}
                    />
                  </Field>
                )}
                {invoiceFields.show_tax_field && (
                  <Field label="مالیات (%)">
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      placeholder="0"
                      value={form.tax}
                      onChange={(e) => setField("tax", e.target.value)}
                      className={inputCls}
                    />
                  </Field>
                )}
              </div>

              {/* Global Commission */}
              <div className="bg-yellow-500/5 border border-yellow-500/25 rounded-xl p-4">
                <Field label="💼 کارمزد (درآمد شما)">
                  <PriceInput
                    value={form.commission_total}
                    onChange={(v) => setField("commission_total", v)}
                    borderColor="border-yellow-500/30 focus:ring-yellow-500/30"
                  />
                </Field>
                <p className="text-yellow-500/60 text-[10px] mt-2">
                  کارمزد به مبلغ کل فاکتور اضافه می‌شود — فقط این مبلغ به عنوان
                  درآمد شما محاسبه می‌گردد
                </p>
              </div>

              {/* Optional rounding of the final amount */}
              <div className="mt-4 bg-sky-500/5 border border-sky-500/25 rounded-xl p-4">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={!!form.rounding_enabled}
                    onChange={(e) =>
                      setField("rounding_enabled", e.target.checked)
                    }
                    className="accent-sky-500"
                  />
                  🔢 رند کردن مبلغ فاکتور
                </label>
                {form.rounding_enabled && (
                  <div className="mt-3">
                    <Field label="مبلغ نهایی دلخواه (اختیاری)">
                      <PriceInput
                        value={form.rounding_target}
                        onChange={(v) => {
                          setField("rounding_target", v);
                          setRoundingClearedNotice(false);
                        }}
                        borderColor="border-sky-500/30 focus:ring-sky-500/30"
                        blankWhenZero
                      />
                    </Field>
                    <p className="text-sky-500/60 text-[10px] mt-2">
                      اگر مبلغی وارد نکنید، مبلغ فاکتور به نزدیک‌ترین ۱۰ هزار
                      تومان رند می‌شود: ریزِ کمتر از ۵ هزار تومان به پایین و ۵
                      هزار تومان یا بیشتر به بالا. اگر مبلغ نهایی دلخواه را وارد
                      کنید و بعد مبلغ فاکتور عوض شود، رند دستی حذف می‌شود و باید
                      دوباره واردش کنید.
                    </p>
                    {roundingClearedNotice && (
                      <p className="text-amber-400 text-xs mt-2">
                        ⚠️ رند دستی قبلی با تغییر مبلغ فاکتور حذف شد؛ در صورت
                        تمایل مبلغ جدید را دوباره وارد کنید.
                      </p>
                    )}
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 mt-3">
                      <input
                        type="checkbox"
                        checked={!!form.rounding_show_amount}
                        onChange={(e) =>
                          setField("rounding_show_amount", e.target.checked)
                        }
                        className="accent-sky-500"
                      />
                      نمایش مبلغ رند در فاکتور
                      <span className="text-slate-500">
                        (پیش‌فرض: نمایش داده نمی‌شود؛ رند فقط در مبلغ نهایی
                        اعمال می‌شود)
                      </span>
                    </label>
                    <p className="text-sky-300 text-xs mt-2">
                      مبلغ نهایی پس از رند: {fmt(payableAmount)}
                      {roundingAdjustment !== 0 &&
                        ` (${roundingAdjustment > 0 ? "+" : "−"}${fmt(Math.abs(roundingAdjustment))} تومان)`}
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-4 space-y-2 pt-4 border-t border-slate-700/50">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">جمع خدمات</span>
                  <span className="text-slate-200">{fmt(subtotal)}</span>
                </div>
                {officeCardFee > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-amber-300">واریزی کارت دفتر</span>
                    <span className="text-amber-300">
                      +{fmt(officeCardFee)}
                    </span>
                  </div>
                )}
                {Number(form.commission_total) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-yellow-400/80">
                      💼 کارمزد (درآمد شما)
                    </span>
                    <span className="text-yellow-400">
                      +{fmt(Number(form.commission_total))}
                    </span>
                  </div>
                )}
                {invoiceFields.show_tax_field && Number(form.tax) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">مالیات ({form.tax}%)</span>
                    <span className="text-orange-400">+{fmt(taxAmount)}</span>
                  </div>
                )}
                {invoiceFields.show_discount_field &&
                  Number(form.discount) > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">تخفیف</span>
                      <span className="text-green-400">
                        −{fmt(Number(form.discount))}
                      </span>
                    </div>
                  )}
                {form.rounding_enabled &&
                  form.rounding_show_amount &&
                  roundingAdjustment !== 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-sky-400/80">رند مبلغ</span>
                      <span className="text-sky-400">
                        {roundingAdjustment > 0 ? "+" : "−"}
                        {fmt(Math.abs(roundingAdjustment))}
                      </span>
                    </div>
                  )}
                <div className="flex justify-between text-base font-bold border-t border-slate-600 pt-3">
                  <span className="text-white">جمع قابل پرداخت توسط مشتری</span>
                  <span className="text-blue-400 text-lg">
                    {fmt(payableAmount)}
                  </span>
                </div>
                {Number(form.commission_total) > 0 && (
                  <div className="flex justify-between text-xs text-emerald-400/70 pt-1">
                    <span>🏦 درآمد خالص شما</span>
                    <span>{fmt(Number(form.commission_total))}</span>
                  </div>
                )}
              </div>
            </div>
          </Section>

          <Section title="توضیحات فاکتور" icon="📝">
            <textarea
              value={form.description}
              onChange={(e) =>
                setField("description", toPersianKeyboard(e.target.value))
              }
              rows={5}
              placeholder="توضیحات اختیاری فاکتور..."
              className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600/50 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-none min-h-[120px]"
            />

            {/* Tags */}
            <div className="mt-4">
              <label className="text-xs text-slate-400 mb-1.5 block">
                🏷️ برچسب‌ها (با کاما جدا کنید)
              </label>
              <input
                value={(form.tags || []).join("، ")}
                onChange={(e) => {
                  const raw = e.target.value;
                  const tags = raw
                    .split(/[,،]/)
                    .map((t) => t.trim())
                    .filter(Boolean);
                  setField("tags", tags);
                }}
                placeholder="مثال: فوری، VIP، گارانتی"
                className="w-full px-3 py-2.5 bg-slate-700/50 border border-slate-600/50 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
              {form.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {form.tags.map((tag, i) => (
                    <span
                      key={i}
                      className="text-xs bg-blue-500/15 text-blue-300 border border-blue-500/25 px-2 py-0.5 rounded-lg flex items-center gap-1"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() =>
                          setField(
                            "tags",
                            form.tags.filter((_, j) => j !== i),
                          )
                        }
                        className="text-blue-400 hover:text-red-400 text-[10px]"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            {!isEdit && (
              <div className="mt-4 space-y-2">
                <label className="text-xs text-slate-400 block">
                  📎 مدارک پیوست فاکتور (اختیاری)
                </label>
                <input
                  type="file"
                  multiple
                  onChange={(event) =>
                    setInvoiceDocuments(Array.from(event.target.files || []))
                  }
                  className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-white"
                />
                {invoiceDocuments.length > 0 && (
                  <p className="text-xs text-slate-400">
                    {invoiceDocuments.map((file) => file.name).join("، ")} — پس
                    از ثبت فاکتور در پوشه مدارک مشتری ذخیره می‌شوند.
                  </p>
                )}
              </div>
            )}
          </Section>
        </div>

        {/* Service Picker Modal */}
        {showPicker && (
          <ServicePickerModal
            services={services}
            onAdd={handleAddFromPicker}
            onClose={() => setShowPicker(false)}
          />
        )}

        <div className="flex justify-end gap-3 border-t border-slate-700/50 pt-4 pb-2">
          <button
            type="button"
            onClick={() => navigate(isEdit ? `/invoices/${id}` : "/invoices")}
            className="px-4 py-2 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-700 transition-all"
          >
            انصراف
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-all disabled:opacity-60"
          >
            {saving ? "در حال ذخیره..." : isEdit ? "💾 ذخیره" : "✅ ثبت فاکتور"}
          </button>
        </div>
      </form>

      {/* New Customer Modal */}
      {newCustomerModal && (
        <NewCustomerModal
          initialName={newCustomerModal.pendingName}
          onConfirm={handleCustomerModalConfirm}
          onCancel={handleCustomerModalCancel}
          saving={creatingCustomer}
          error={customerError}
        />
      )}
    </>
  );
};

export default InvoiceForm;
