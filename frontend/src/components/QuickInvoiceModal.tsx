import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  BUSINESS_STORAGE_KEY,
  invoicesAPI,
  servicesAPI,
  servicePackagesAPI,
  customersAPI,
  invoiceSettingsAPI,
  vehicleTypesAPI,
} from "../services/api";
import PriceInput from "./PriceInput";
import PlateInput from "./PlateInput";
import SearchableSelect from "./SearchableSelect";
import {
  toPersianKeyboard,
  jalaliYearRange,
  currentJalaliYear,
} from "../utils/persian";
import { MOTO_BRANDS } from "../lib/vehicle";
import { enqueueQuickInvoice } from "../lib/offlineQueue";
import { hideWaiting, showWaiting } from "../lib/waiting";

const YEAR_OPTIONS = jalaliYearRange(1360, currentJalaliYear());

// Same operator-defaults store the full invoice form uses, so the
// status/card choices carry over between both flows.
const DEFAULTS_KEY = "mohaseb:invoice-defaults:v1";
const LAST_COMMISSION_KEY = "mohaseb:quick-commission:v1";
function loadDefaults(): { status?: string; card_payment_source?: string } {
  try {
    return JSON.parse(localStorage.getItem(DEFAULTS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

const fmt = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("fa-IR").format(Number(n) || 0);
const inp =
  "w-full px-3 py-2.5 bg-slate-700/50 border border-slate-600/50 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all";

type QuickItem = {
  _key: number;
  service: number | null;
  service_title_snapshot: string;
  quantity: number;
  main_price: number;
  extra_price: number;
  notes: string;
};

type ServiceOption = {
  id: number;
  title: string;
  is_active: boolean;
  default_main_price?: number | null;
  default_extra_price?: number | null;
};

type CustomerSuggestion = {
  id: number;
  name: string;
  phone?: string;
};

// ── Customer Autocomplete ──
type CustomerAutoCompleteProps = {
  value?: string;
  onChange: (value: string) => void;
  onPhoneChange: (phone: string) => void;
  phone?: string;
};

const CustomerAutoComplete = ({
  value,
  onChange,
  onPhoneChange,
  phone,
}: CustomerAutoCompleteProps) => {
  const [query, setQuery] = useState(value || "");
  const [suggestions, setSuggestions] = useState<CustomerSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const { data } = await customersAPI.list({ search: query });
        const list = data.results || data;
        setSuggestions(list.slice(0, 6));
        setOpen(list.length > 0);
      } catch {}
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={ref} className="relative">
      <input
        className={inp}
        value={query}
        onChange={(e) => {
          const val = toPersianKeyboard(e.target.value);
          setQuery(val);
          onChange(val);
        }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder="نام مشتری (جدید یا موجود)"
        autoFocus
      />
      {query && !suggestions.find((s) => s.name === query) && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-emerald-400/80 pointer-events-none">
          + مشتری جدید
        </span>
      )}
      {open && suggestions.length > 0 && (
        <div className="absolute top-full right-0 left-0 mt-1 bg-slate-800 border border-slate-700 rounded-xl overflow-hidden z-50 shadow-xl max-h-48 overflow-y-auto">
          {suggestions.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setQuery(c.name);
                onChange(c.name);
                if (c.phone) onPhoneChange(c.phone);
                setOpen(false);
              }}
              className="w-full text-right px-4 py-2.5 hover:bg-slate-700/50 transition-colors flex items-center justify-between gap-2"
            >
              <span className="text-white text-sm">{c.name}</span>
              <span className="text-slate-500 text-xs font-mono">
                {c.phone || ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Quick Service Row ──
type ServiceRowProps = {
  item: QuickItem;
  index: number;
  services: ServiceOption[];
  onChange: (index: number, item: QuickItem) => void;
  onRemove: (index: number) => void;
  onDuplicate: (index: number) => void;
};

const ServiceRow = ({
  item,
  index,
  services,
  onChange,
  onRemove,
  onDuplicate,
}: ServiceRowProps) => {
  const [showSvcList, setShowSvcList] = useState(false);
  const filteredSvc = services.filter(
    (s) =>
      s.is_active &&
      s.title
        .toLowerCase()
        .includes((item.service_title_snapshot || "").toLowerCase()),
  );

  return (
    <div className="bg-slate-700/30 rounded-xl p-3 space-y-2 group relative">
      {/* Remove + duplicate buttons */}
      <button
        type="button"
        onClick={() => onRemove(index)}
        title="حذف ردیف"
        className="absolute top-2 left-2 z-10 w-6 h-6 rounded-lg bg-red-500/10 text-red-400 flex items-center justify-center hover:bg-red-500/20 transition-all text-xs opacity-0 group-hover:opacity-100"
      >
        ×
      </button>
      <button
        type="button"
        onClick={() => onDuplicate(index)}
        title="تکثیر ردیف"
        className="absolute top-2 left-9 z-10 w-6 h-6 rounded-lg bg-slate-500/10 text-slate-300 flex items-center justify-center hover:bg-slate-500/20 transition-all text-xs opacity-0 group-hover:opacity-100"
      >
        ⧉
      </button>

      {/* Service title + auto-suggest */}
      <div className="relative">
        <input
          value={item.service_title_snapshot}
          onChange={(e) => {
            const val = toPersianKeyboard(e.target.value);
            onChange(index, {
              ...item,
              service_title_snapshot: val,
              service: null,
            });
            setShowSvcList(val.length > 0);
          }}
          onFocus={() => item.service_title_snapshot && setShowSvcList(true)}
          onBlur={() => setTimeout(() => setShowSvcList(false), 200)}
          placeholder="عنوان خدمت (تایپ کنید یا از لیست انتخاب کنید)"
          className={`${inp} text-xs`}
        />
        {showSvcList && filteredSvc.length > 0 && (
          <div className="absolute top-full right-0 left-0 mt-1 bg-slate-800 border border-slate-700 rounded-xl overflow-hidden z-50 shadow-xl max-h-36 overflow-y-auto">
            {filteredSvc.slice(0, 5).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  onChange(index, {
                    ...item,
                    service: s.id,
                    service_title_snapshot: s.title,
                    main_price: s.default_main_price || 0,
                    extra_price: s.default_extra_price || 0,
                  });
                  setShowSvcList(false);
                }}
                className="w-full text-right px-3 py-2 hover:bg-slate-700/50 text-sm text-white transition-colors flex justify-between"
              >
                <span>{s.title}</span>
                <span className="text-slate-500 text-xs">
                  {fmt(s.default_main_price)} ت
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Price + Quantity */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] text-slate-500 mb-0.5 block">
            قیمت اصلی
          </label>
          <PriceInput
            value={item.main_price}
            onChange={(v) => onChange(index, { ...item, main_price: v })}
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-500 mb-0.5 block">
            قیمت اضافی
          </label>
          <PriceInput
            value={item.extra_price}
            onChange={(v) => onChange(index, { ...item, extra_price: v })}
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-500 mb-0.5 block">
            تعداد
          </label>
          <input
            type="number"
            min="1"
            value={item.quantity}
            onChange={(e) =>
              onChange(index, {
                ...item,
                quantity: Math.max(1, Number(e.target.value) || 1),
              })
            }
            className={`${inp} text-xs`}
          />
        </div>
      </div>

      {/* Line total */}
      <div className="text-left">
        <span className="text-blue-400 text-xs font-medium">
          {fmt(
            ((Number(item.main_price) || 0) + (Number(item.extra_price) || 0)) *
              (Number(item.quantity) || 1),
          )}{" "}
          تومان
        </span>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════
// ══  Quick Invoice Modal  ════════════════════
// ══════════════════════════════════════════════
type QuickInvoiceModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (data: any) => void;
};

const QuickInvoiceModal = ({
  isOpen,
  onClose,
  onSuccess,
}: QuickInvoiceModalProps) => {
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [items, setItems] = useState<QuickItem[]>([
    {
      _key: Math.random(),
      service: null,
      service_title_snapshot: "",
      quantity: 1,
      main_price: 0,
      extra_price: 0,
      notes: "",
    },
  ]);
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("pending");
  const [cardPaymentSource, setCardPaymentSource] = useState("customer");
  const [officeCardThreshold, setOfficeCardThreshold] = useState(0);
  const [commissionTotal, setCommissionTotal] = useState(0);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [queuedOffline, setQueuedOffline] = useState(false);
  // One idempotency key per draft: retries (manual or from the offline
  // queue) resend the same key and the server dedupes them.
  const draftKeyRef = useRef<string | null>(null);
  // In-flight lock + waiting modal: while this user's save is running,
  // no second submit (double click / Ctrl+Enter / shortcut) can start.
  const submitLockRef = useRef(false);
  const ensureDraftKey = () => {
    if (!draftKeyRef.current) {
      draftKeyRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    return draftKeyRef.current;
  };
  const [error, setError] = useState("");
  const [packages, setPackages] = useState<any[]>([]);
  const [step, setStep] = useState(1);
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [vehicleVin, setVehicleVin] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [vehicleYear, setVehicleYear] = useState("");
  const [vehicleTypes, setVehicleTypes] = useState<
    { id: number; name: string }[]
  >([]);
  const [creatingVehicleType, setCreatingVehicleType] = useState(false);
  const [commissionEntered, setCommissionEntered] = useState(false);
  const [notice, setNotice] = useState("");
  const [plateSuggestion, setPlateSuggestion] = useState<any>(null);
  const [plateDismissedFor, setPlateDismissedFor] = useState("");
  const [lastCommission, setLastCommission] = useState(0);
  const appliedPlateRef = useRef("");
  const panelRef = useRef<HTMLDivElement>(null);

  const resetForm = useCallback(() => {
    setCustomerName("");
    setCustomerPhone("");
    setDescription("");
    setItems([
      {
        _key: Math.random(),
        service: null,
        service_title_snapshot: "",
        quantity: 1,
        main_price: 0,
        extra_price: 0,
        notes: "",
      },
    ]);
    setCommissionTotal(0);
    setCommissionEntered(false);
    setResult(null);
    setQueuedOffline(false);
    draftKeyRef.current = null;
    setError("");
    const defaults = loadDefaults();
    setStatus(defaults.status || "pending");
    setCardPaymentSource(defaults.card_payment_source || "customer");
    try {
      setLastCommission(Number(localStorage.getItem(LAST_COMMISSION_KEY)) || 0);
    } catch {
      setLastCommission(0);
    }
    setNotice("");
    setPlateSuggestion(null);
    setPlateDismissedFor("");
    appliedPlateRef.current = "";
    setStep(1);
    setVehiclePlate("");
    setVehicleVin("");
    setVehicleModel("");
    setVehicleType("");
    setVehicleYear("");
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    servicesAPI
      .list()
      .then(({ data }) => setServices(data.results || data))
      .catch(() => {});
    invoiceSettingsAPI
      .get()
      .then(({ data }) =>
        setOfficeCardThreshold(Number(data.office_card_fee_threshold) || 0),
      )
      .catch(() => {});
    servicePackagesAPI
      .list({ active: 1 })
      .then(({ data }) => setPackages(data?.results || data || []))
      .catch(() => {});
    vehicleTypesAPI
      .list()
      .then(({ data }) => setVehicleTypes(data))
      .catch(() => {});
    // Reset form on open
    resetForm();
  }, [isOpen, resetForm]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const refreshReferences = () => {
      servicesAPI
        .list()
        .then(({ data }) => setServices(data.results || data))
        .catch(() => {});
      invoiceSettingsAPI
        .get()
        .then(({ data }) =>
          setOfficeCardThreshold(Number(data.office_card_fee_threshold) || 0),
        )
        .catch(() => {});
    };
    window.addEventListener("mohaseb:data-changed", refreshReferences);
    return () =>
      window.removeEventListener("mohaseb:data-changed", refreshReferences);
  }, [isOpen]);

  const addRow = () => {
    setItems((prev) => [
      ...prev,
      {
        _key: Math.random(),
        service: null,
        service_title_snapshot: "",
        quantity: 1,
        main_price: 0,
        extra_price: 0,
        notes: "",
      },
    ]);
  };

  const applyPackage = (pkg: any) => {
    const rows: QuickItem[] = (pkg.services || [])
      .map((sid: number) => services.find((s) => s.id === sid))
      .filter((s: any) => s && s.is_active !== false)
      .map((s: any) => ({
        _key: Math.random(),
        service: s.id,
        service_title_snapshot: s.title,
        quantity: 1,
        main_price: s.default_main_price || 0,
        extra_price: s.default_extra_price || 0,
        notes: "",
      }));
    if (rows.length === 0) return;
    setItems((prev) => [
      ...prev.filter(
        (it) => it.service || it.service_title_snapshot || it.main_price,
      ),
      ...rows,
    ]);
    setNotice(`📦 پکیج «${pkg.name}» اضافه شد (${fmt(rows.length)} خدمت)`);
  };

  const updateRow = (idx: number, updated: QuickItem) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? updated : it)));
  const removeRow = (idx: number) =>
    setItems((prev) => prev.filter((_, i) => i !== idx));
  const duplicateRow = (idx: number) =>
    setItems((prev) => {
      const copy = { ...prev[idx], _key: Math.random() };
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
    });

  // Plate-first reuse, mirroring the full form: once a complete plate is
  // typed, offer the latest invoice issued for it.
  useEffect(() => {
    if (!isOpen) return undefined;
    const plate = (vehiclePlate || "").trim();
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
          setPlateSuggestion(found || null);
        })
        .catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [vehiclePlate, isOpen, plateDismissedFor]);

  const handleUsePlateSuggestion = useCallback(() => {
    if (!plateSuggestion) return;
    invoicesAPI
      .detail(plateSuggestion.id)
      .then(({ data }) => {
        if (data.customer_name) setCustomerName(data.customer_name);
        setVehicleVin(data.vehicle_vin || "");
        setVehicleModel(data.vehicle_model || "");
        setVehicleType(data.vehicle_type || "");
        setVehicleYear(data.vehicle_year || "");
        setDescription(data.description || "");
        if (Number(data.commission_total) > 0) {
          setCommissionTotal(Number(data.commission_total));
          setCommissionEntered(true);
        }
        const rows: QuickItem[] = (data.items || [])
          .filter((it: any) => !it.is_office_card_fee)
          .map((it: any) => ({
            _key: Math.random(),
            service: it.service || null,
            service_title_snapshot:
              it.service_title_snapshot || it.service_title || "",
            quantity: it.quantity || 1,
            main_price: Number(it.main_price) || 0,
            extra_price: Number(it.extra_price) || 0,
            notes: it.notes || "",
          }));
        if (rows.length > 0) setItems(rows);
        appliedPlateRef.current = (vehiclePlate || "").trim();
        setPlateSuggestion(null);
        setNotice(
          `🔁 مشخصات و ردیف‌های فاکتور ${data.invoice_number} بارگذاری شد`,
        );
        setStep(2);
      })
      .catch(() => setError("بارگذاری فاکتور قبلی ممکن نشد"));
  }, [plateSuggestion, vehiclePlate]);

  // Vehicle section mirrors the full invoice form: same fields, same
  // car/moto switch, same auto-saved vehicle-type list.
  const isMotoPlate = (p: string) => p === "-" || /^\d+-\d+$/.test(p);
  const plateTrimmed = (vehiclePlate || "").trim();
  const isMoto = isMotoPlate(plateTrimmed);
  const handlePlateChange = (v: string) => {
    const typeChanged =
      isMotoPlate(plateTrimmed) !== isMotoPlate((v || "").trim());
    setVehiclePlate(v);
    if (typeChanged) setVehicleType("");
  };
  const handleCreateVehicleType = useCallback(async (name: string) => {
    setCreatingVehicleType(true);
    try {
      const { data } = await vehicleTypesAPI.create({ name });
      setVehicleTypes((prev) => [...prev, data]);
      return { value: data.name, label: data.name };
    } catch (err: any) {
      setError(err?.response?.data?.name?.[0] || "خطا در ثبت نوع خودرو");
      return null;
    } finally {
      setCreatingVehicleType(false);
    }
  }, []);

  const subtotal = items.reduce(
    (s, it) =>
      s +
      ((Number(it.main_price) || 0) + (Number(it.extra_price) || 0)) *
        (Number(it.quantity) || 1),
    0,
  );
  const commissionAmt = Number(commissionTotal) || 0;
  const officeCardFee =
    cardPaymentSource === "office" &&
    officeCardThreshold > 0 &&
    subtotal > officeCardThreshold
      ? Math.floor(subtotal / 100)
      : 0;
  const grandTotal = subtotal + commissionAmt + officeCardFee;

  const goNext = () => {
    if (step === 1 && !customerName.trim()) {
      setError("نام مشتری الزامی است");
      return;
    }
    if (
      step === 2 &&
      items.every((it) => !it.service_title_snapshot && !it.main_price)
    ) {
      setError("حداقل یک ردیف خدمت لازم است");
      return;
    }
    if (step === 3 && !commissionEntered) {
      setError("وارد کردن کارمزد الزامی است");
      return;
    }
    setError("");
    setStep((s) => Math.min(4, s + 1));
  };

  const goBack = () => {
    setError("");
    setStep((s) => Math.max(1, s - 1));
  };

  const handleSubmit = async () => {
    if (submitLockRef.current) return;
    if (!customerName.trim()) {
      setError("نام مشتری الزامی است");
      setStep(1);
      return;
    }
    if (items.every((it) => !it.service_title_snapshot && !it.main_price)) {
      setError("حداقل یک ردیف خدمت لازم است");
      setStep(2);
      return;
    }
    if (!commissionEntered) {
      setError("وارد کردن کارمزد الزامی است");
      setStep(3);
      return;
    }
    setError("");
    setSaving(true);
    submitLockRef.current = true;
    showWaiting("در حال ثبت فاکتور…");
    let payload: any = null;
    try {
      payload = {
        idempotency_key: ensureDraftKey(),
        customer_name: customerName,
        customer_phone: customerPhone,
        status,
        card_payment_source: cardPaymentSource,
        description,
        commission_total: commissionAmt,
        vehicle_plate: vehiclePlate,
        vehicle_vin: vehicleVin,
        vehicle_model: vehicleModel,
        vehicle_type: vehicleType,
        vehicle_year: vehicleYear,
        items: items
          .filter((it) => it.service_title_snapshot || it.main_price)
          .map((it) => ({
            service: it.service || null,
            service_title_snapshot: it.service_title_snapshot,
            quantity: Number(it.quantity) || 1,
            main_price: Number(it.main_price) || 0,
            extra_price: Number(it.extra_price) || 0,
            notes: it.notes || "",
          })),
      };
      const { data } = await invoicesAPI.quickCreate(payload);
      draftKeyRef.current = null;
      setResult(data);
      // Remember the operator's status/card choices (shared with the full
      // form) and this commission for one-click reuse next time.
      try {
        localStorage.setItem(
          DEFAULTS_KEY,
          JSON.stringify({
            status,
            card_payment_source: cardPaymentSource,
          }),
        );
        if (commissionAmt > 0)
          localStorage.setItem(LAST_COMMISSION_KEY, String(commissionAmt));
      } catch {
        /* storage blocked: non-fatal */
      }
      if (onSuccess) onSuccess(data);
    } catch (e) {
      if (!e?.response) {
        // Network failure (offline or server unreachable): park the draft
        // in the local queue instead of losing it. It is sent
        // automatically on reconnect; the idempotency key prevents a
        // duplicate if this attempt actually reached the server.
        try {
          await enqueueQuickInvoice({
            key: payload.idempotency_key,
            payload,
            queuedAt: Date.now(),
            businessId: (() => {
              try {
                const raw = localStorage.getItem(BUSINESS_STORAGE_KEY);
                const parsed = raw ? Number(raw) : NaN;
                return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
              } catch {
                return null;
              }
            })(),
          });
          setQueuedOffline(true);
          window.dispatchEvent(new Event("mohaseb:queue-updated"));
          return;
        } catch {
          /* IndexedDB unavailable: fall through to the plain error */
        }
      }
      const msg = e.response?.data;
      setError(
        typeof msg === "object"
          ? msg.error || JSON.stringify(msg)
          : "خطا در صدور فاکتور",
      );
    } finally {
      submitLockRef.current = false;
      hideWaiting();
      setSaving(false);
    }
  };

  // Ctrl+Enter runs the primary action: next step, or submit on step 4.
  const primaryRef = useRef<() => void>(() => {});
  primaryRef.current = step < 4 ? goNext : handleSubmit;
  useEffect(() => {
    if (!isOpen || result || queuedOffline) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        void primaryRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, result]);

  // Keep the operator's hands on the keyboard: focus the field that
  // matters most on each step.
  useEffect(() => {
    if (!isOpen || result) return undefined;
    const t = setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const target =
        step === 2
          ? panel.querySelector<HTMLInputElement>(
              "input[placeholder*='عنوان خدمت']",
            )
          : step === 3
            ? panel.querySelector<HTMLInputElement>("[data-commission] input")
            : step === 4
              ? panel.querySelector<HTMLButtonElement>("[data-submit]")
              : null;
      target?.focus();
    }, 60);
    return () => clearTimeout(t);
  }, [step, isOpen, result]);

  if (!isOpen) return null;

  // Success view
  if (result) {
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
        <div
          className="bg-slate-800 border border-slate-700/60 rounded-2xl shadow-2xl w-full max-w-md"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-8 text-center space-y-4">
            <div className="w-16 h-16 mx-auto bg-emerald-500/20 border border-emerald-500/30 rounded-2xl flex items-center justify-center text-3xl animate-bounce">
              ✅
            </div>
            <h3 className="text-white font-bold text-lg">{result.message}</h3>
            <div className="bg-slate-700/40 rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">شماره فاکتور</span>
                <span className="text-blue-400 font-mono">
                  {result.invoice?.invoice_number}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">مشتری</span>
                <span className="text-white">{result.customer?.name}</span>
              </div>
              {result.customer?.is_new && (
                <span className="inline-block text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-lg">
                  🆕 مشتری جدید ایجاد شد
                </span>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">مبلغ کل</span>
                <span className="text-white font-semibold">
                  {fmt(result.invoice?.total_amount)} تومان
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={resetForm}
                autoFocus
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm transition-all"
              >
                ⚡ ایجاد فاکتور جدید
              </button>
              <button
                onClick={() => {
                  window.location.href = `/invoices/${result.invoice?.id}`;
                }}
                className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm transition-all"
              >
                🧾 رفتن به جزئیات فاکتور
              </button>
              <button
                onClick={() => {
                  window.location.href = `/invoices/${result.invoice?.id}?print=1`;
                }}
                className="px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm transition-all"
              >
                🖨️ مشاهده و چاپ
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm transition-all"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Queued-offline view: the draft is parked in the local queue and will
  // be submitted automatically when the connection returns.
  if (queuedOffline) {
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
        <div
          className="bg-slate-800 border border-slate-700/60 rounded-2xl shadow-2xl w-full max-w-md"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-8 text-center space-y-4">
            <div className="w-16 h-16 mx-auto bg-amber-500/20 border border-amber-500/30 rounded-2xl flex items-center justify-center text-3xl">
              📥
            </div>
            <h3 className="text-white font-bold text-lg">
              فاکتور در صف ارسال ذخیره شد
            </h3>
            <p className="text-slate-400 text-sm leading-6">
              ارتباط با سرور برقرار نیست؛ این فاکتور روی همین دستگاه ذخیره شد و
              به‌محض برگشت اینترنت به‌صورت خودکار ارسال می‌شود. نگران ثبت تکراری
              نباشید؛ سیستم جلوی صدور دوبارهٔ آن را می‌گیرد.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={resetForm}
                autoFocus
                className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm transition-all"
              >
                ⚡ ایجاد فاکتور جدید
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-sm transition-all"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div
        ref={panelRef}
        className="bg-slate-800 border border-slate-700/60 rounded-2xl shadow-2xl w-full max-w-[calc(100vw-2rem)] sm:max-w-xl max-h-[90vh] flex flex-col min-w-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-700/50 shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/30 to-indigo-500/30 border border-blue-500/30 flex items-center justify-center text-lg">
              ⚡
            </span>
            <div>
              <h3 className="text-white font-semibold text-sm">فاکتور سریع</h3>
              <p className="text-slate-500 text-[10px]">
                صدور فاکتور بدون نیاز به تنظیمات کامل
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xl transition-colors"
          >
            ×
          </button>
        </div>

        {/* Steps */}
        <div className="flex items-center gap-1.5 px-5 pt-4 shrink-0 overflow-x-auto min-w-0 w-full">
          {[
            { n: 1, l: "مشتری و خودرو" },
            { n: 2, l: "خدمات" },
            { n: 3, l: "کارمزد و توضیحات" },
            { n: 4, l: "وضعیت و ثبت" },
          ].map((s, i) => (
            <React.Fragment key={s.n}>
              <button
                type="button"
                onClick={() => {
                  if (s.n < step) {
                    setError("");
                    setStep(s.n);
                  }
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] whitespace-nowrap transition-all ${
                  step === s.n
                    ? "bg-blue-500/20 border border-blue-500/40 text-blue-300"
                    : s.n < step
                      ? "bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/20"
                      : "bg-slate-700/30 border border-slate-600/30 text-slate-500"
                }`}
              >
                <span className="font-bold">{fmt(s.n)}</span> {s.l}
              </button>
              {i < 3 && <div className="flex-1 min-w-3 h-px bg-slate-700/60" />}
            </React.Fragment>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-3 py-2 rounded-xl">
              ⚠️ {error}
            </div>
          )}
          {notice && (
            <div className="bg-teal-500/10 border border-teal-500/30 text-teal-200 text-sm px-3 py-2 rounded-xl flex items-center justify-between gap-2">
              <span>{notice}</span>
              <button
                type="button"
                onClick={() => setNotice("")}
                className="text-teal-300/70 hover:text-teal-100 shrink-0"
              >
                ✕
              </button>
            </div>
          )}

          {step === 1 && (
            <>
              {/* Customer */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">
                    👤 نام مشتری *
                  </label>
                  <CustomerAutoComplete
                    value={customerName}
                    onChange={setCustomerName}
                    onPhoneChange={setCustomerPhone}
                    phone={customerPhone}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">
                    📱 تلفن مشتری
                  </label>
                  <input
                    className={inp}
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="09..."
                  />
                </div>
              </div>

              {/* Vehicle — same fields & behavior as the full invoice form */}
              <div className="bg-slate-700/20 border border-slate-700/50 rounded-xl p-3 space-y-3">
                <label className="text-xs text-slate-400 font-medium block">
                  {isMoto
                    ? "🏍️ اطلاعات موتورسیکلت (اختیاری)"
                    : "🚗 اطلاعات خودرو (اختیاری)"}
                </label>
                <div>
                  <label className="text-[10px] text-slate-500 mb-1 block">
                    شماره پلاک
                  </label>
                  <PlateInput
                    value={vehiclePlate}
                    onChange={handlePlateChange}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-slate-500 mb-1 block">
                      شماره شاسی (VIN)
                    </label>
                    <input
                      className={inp}
                      dir="ltr"
                      maxLength={17}
                      value={vehicleVin}
                      onChange={(e) => setVehicleVin(e.target.value)}
                      placeholder="17 کاراکتر"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 mb-1 block">
                      {isMoto ? "برند و مدل موتور" : "نوع خودرو"}
                    </label>
                    {isMoto ? (
                      <SearchableSelect
                        key="moto-type"
                        value={vehicleType}
                        onChange={(v) => setVehicleType(String(v))}
                        options={MOTO_BRANDS}
                        placeholder="— انتخاب یا افزودن برند/مدل —"
                        searchPlaceholder="جستجو در موتورسیکلت‌ها..."
                        emptyText="موتوری یافت نشد"
                        creatable
                        onCreateOption={handleCreateVehicleType}
                        creating={creatingVehicleType}
                        createLabel={(name) => (
                          <>
                            <span className="text-slate-400">افزودن: </span>
                            <span className="font-medium">«{name}»</span>
                            <span className="text-xs text-emerald-600 mr-2">
                              (ذخیره خودکار)
                            </span>
                          </>
                        )}
                      />
                    ) : (
                      <SearchableSelect
                        key="car-type"
                        value={vehicleType}
                        onChange={(v) => setVehicleType(String(v))}
                        options={vehicleTypes.map((vt) => ({
                          value: vt.name,
                          label: vt.name,
                        }))}
                        placeholder="— انتخاب یا افزودن نوع —"
                        searchPlaceholder="جستجو یا افزودن نوع خودرو..."
                        creatable
                        onCreateOption={handleCreateVehicleType}
                        creating={creatingVehicleType}
                        createLabel={(name) => (
                          <>
                            <span className="text-slate-400">
                              افزودن نوع جدید:{" "}
                            </span>
                            <span className="font-medium">«{name}»</span>
                            <span className="text-xs text-emerald-600 mr-2">
                              (ذخیره خودکار)
                            </span>
                          </>
                        )}
                      />
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 mb-1 block">
                      {isMoto ? "اطلاعات تکمیلی موتور" : "نام / مدل خودرو"}
                    </label>
                    <input
                      className={inp}
                      value={vehicleModel}
                      onChange={(e) =>
                        setVehicleModel(toPersianKeyboard(e.target.value))
                      }
                      placeholder={
                        isMoto
                          ? "مثال: رنگ، سال، موتور ویژه"
                          : "مثال: پراید، سمند، پژو ۲۰۶"
                      }
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 mb-1 block">
                      سال ساخت (شمسی)
                    </label>
                    <SearchableSelect
                      value={vehicleYear || ""}
                      onChange={(v) => setVehicleYear(String(v))}
                      options={YEAR_OPTIONS.map((y) => ({
                        value: String(y),
                        label: String(y),
                      }))}
                      placeholder="— انتخاب سال —"
                      searchPlaceholder="جستجوی سال..."
                    />
                  </div>
                </div>
              </div>

              {plateSuggestion && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-200">
                  <span>
                    🔁 برای این پلاک، فاکتور {plateSuggestion.invoice_number}{" "}
                    برای «{plateSuggestion.customer_name}» ثبت شده (
                    {fmt(plateSuggestion.final_amount)})
                  </span>
                  <button
                    type="button"
                    onClick={handleUsePlateSuggestion}
                    className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium transition-all"
                  >
                    استفاده از همان مشخصات و ردیف‌ها
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPlateDismissedFor((vehiclePlate || "").trim())
                    }
                    className="text-teal-300/70 hover:text-teal-200 text-xs"
                  >
                    ✕ صرف‌نظر
                  </button>
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              {/* Services */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-slate-400 font-medium">
                    🔧 خدمات
                  </label>
                  <button
                    type="button"
                    onClick={addRow}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-all"
                  >
                    + ردیف جدید
                  </button>
                </div>
                {packages.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 mb-2">
                    <span className="text-[11px] text-slate-500">
                      📦 پکیج آماده:
                    </span>
                    {packages.map((pkg: any) => (
                      <button
                        key={pkg.id}
                        type="button"
                        onClick={() => applyPackage(pkg)}
                        className="text-[11px] px-2.5 py-1 rounded-lg bg-violet-500/10 text-violet-300 border border-violet-500/25 hover:bg-violet-500/20 transition-all"
                      >
                        📦 {pkg.name}
                      </button>
                    ))}
                  </div>
                )}
                <div className="space-y-2">
                  {items.map((item, idx) => (
                    <ServiceRow
                      key={item._key}
                      item={item}
                      index={idx}
                      services={services}
                      onChange={updateRow}
                      onRemove={removeRow}
                      onDuplicate={duplicateRow}
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              {/* Commission */}
              <div
                data-commission
                className="bg-yellow-500/5 border border-yellow-500/25 rounded-xl p-3"
              >
                <label className="text-xs text-yellow-400/80 mb-1 block">
                  💼 کارمزد کلی (اصلی) *
                </label>
                {lastCommission > 0 && !commissionEntered && (
                  <button
                    type="button"
                    onClick={() => {
                      setCommissionTotal(lastCommission);
                      setCommissionEntered(true);
                    }}
                    className="mb-2 text-[11px] px-2.5 py-1 rounded-lg bg-yellow-500/10 text-yellow-300 border border-yellow-500/25 hover:bg-yellow-500/20 transition-all"
                  >
                    💼 استفاده از کارمزد قبلی: {fmt(lastCommission)} تومان
                  </button>
                )}
                <PriceInput
                  value={commissionTotal}
                  onChange={(v) => {
                    setCommissionTotal(v);
                    setCommissionEntered(true);
                  }}
                />
                <p className="text-yellow-500/50 text-[10px] mt-1">
                  کارمزد به مبلغ کل اضافه می‌شود — وارد کردن آن الزامی است
                </p>
              </div>

              {/* Description */}
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  📝 توضیحات
                </label>
                <textarea
                  className={inp}
                  rows={2}
                  value={description}
                  onChange={(e) =>
                    setDescription(toPersianKeyboard(e.target.value))
                  }
                  placeholder="توضیحات اختیاری..."
                />
              </div>
            </>
          )}

          {step === 4 && (
            <>
              {/* Payment source */}
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  کارت پرداخت
                </label>
                <div className="flex gap-2">
                  {[
                    { value: "customer", label: "کارت مشتری" },
                    { value: "office", label: "کارت دفتر" },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setCardPaymentSource(option.value)}
                      className={`flex-1 text-xs py-2 rounded-xl border transition-all ${cardPaymentSource === option.value ? "bg-blue-500/20 border-blue-500/40 text-blue-300" : "bg-slate-700/30 border-slate-600/30 text-slate-400"}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {officeCardFee > 0 && (
                  <p className="text-amber-300 text-[11px] mt-2">
                    ردیف واریزی خودکار: {fmt(officeCardFee)} تومان
                  </p>
                )}
              </div>

              {/* Status */}
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  وضعیت
                </label>
                <div className="flex gap-2">
                  {[
                    { v: "pending", l: "پرداخت نشده", c: "yellow" },
                    { v: "paid", l: "پرداخت شده", c: "green" },
                  ].map((s) => (
                    <button
                      key={s.v}
                      type="button"
                      onClick={() => setStatus(s.v)}
                      className={`flex-1 text-xs py-2 rounded-xl border transition-all ${
                        status === s.v
                          ? `bg-${s.c}-500/20 border-${s.c}-500/40 text-${s.c}-400`
                          : "bg-slate-700/30 border-slate-600/30 text-slate-400 hover:bg-slate-700/50"
                      }`}
                    >
                      {s.l}
                    </button>
                  ))}
                </div>
              </div>

              {/* Totals recap */}
              <div className="bg-slate-700/30 rounded-xl p-4 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">جمع خدمات</span>
                  <span className="text-slate-200">
                    {fmt(subtotal)}{" "}
                    <span className="text-xs font-normal">تومان</span>
                  </span>
                </div>
                {officeCardFee > 0 && (
                  <div className="flex justify-between text-sm text-amber-300">
                    <span>واریزی کارت دفتر</span>
                    <span>+{fmt(officeCardFee)} تومان</span>
                  </div>
                )}
                {commissionAmt > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-yellow-400/80">💼 کارمزد</span>
                    <span className="text-yellow-400">
                      +{fmt(commissionAmt)}{" "}
                      <span className="text-xs font-normal">تومان</span>
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold border-t border-slate-600/50 pt-1.5">
                  <span className="text-slate-100">مبلغ کل قابل پرداخت</span>
                  <span className="text-white text-lg">
                    {fmt(grandTotal)}{" "}
                    <span className="text-xs font-normal">تومان</span>
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-slate-700/50 p-4 space-y-3">
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-400">
              مبلغ کل قابل پرداخت
              <span className="text-slate-500 text-[11px]">
                {" "}
                (مرحله {fmt(step)} از {fmt(4)})
              </span>
            </span>
            <span className="text-white font-bold text-lg">
              {fmt(grandTotal)}{" "}
              <span className="text-xs font-normal">تومان</span>
            </span>
          </div>
          <div className="flex gap-3">
            {step > 1 ? (
              <button
                onClick={goBack}
                className="px-5 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-700 transition-all"
              >
                مرحله قبل
              </button>
            ) : (
              <button
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-700 transition-all"
              >
                انصراف
              </button>
            )}
            {step < 4 ? (
              <button
                onClick={goNext}
                className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-l from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-sm font-medium transition-all shadow-lg shadow-blue-500/25"
              >
                مرحله بعد
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={saving}
                data-submit
                className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-l from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-sm font-medium transition-all disabled:opacity-60 flex items-center justify-center gap-2 shadow-lg shadow-blue-500/25"
              >
                {saving ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  "⚡"
                )}
                صدور فاکتور
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuickInvoiceModal;
