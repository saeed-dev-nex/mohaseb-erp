import React, { useEffect, useRef, useState } from "react";
import {
  useParams,
  useNavigate,
  Link,
  useSearchParams,
} from "react-router-dom";
import {
  invoicesAPI,
  profileAPI,
  customersAPI,
  invoiceSettingsAPI,
  documentsAPI,
  downloadDocumentFile,
} from "../services/api";
import { useSelector } from "react-redux";
import { toJalali, numberToWords } from "../utils/persian";
import { computeRoundingAdjustment } from "../utils/money";
import { fmt, persianDate } from "./invoice-detail/format";
import { buildPrintCSS } from "./invoice-detail/print";
import { STATUS_MAP, StatusBadge } from "./invoice-detail/status";
import { auditDescription } from "./invoice-detail/audit";
import type { AuditEvent } from "./invoice-detail/audit";
import { PaymentDescriptions } from "./invoice-detail/PaymentDescriptions";
import { PaymentHistorySection } from "./invoice-detail/PaymentHistorySection";
import type { InvoicePayment, PaymentFormData } from "./invoice-detail/types";
import { InvoiceExportSheet } from "./invoice-detail/InvoiceExportSheet";
import type {
  BusinessProfile,
  CustomerInfo,
  InvoiceData,
  InvoiceItem,
  InvoiceFields,
} from "./invoice-detail/types";

import PriceInput from "../components/PriceInput";
import {
  Button,
  ErrorNotice,
  InputField,
  Modal,
  Spinner,
} from "../components/ui";

// ─── helpers ──────────────────────────────────────────────────

type InvoiceDocument = {
  id: number;
  title?: string | null;
  file_name?: string;
  file_url: string;
  preview_url?: string | null;
  is_image?: boolean;
  content_type?: string;
};

type PendingDocument = {
  file: File;
  title: string;
};

// ─── Main Component ───────────────────────────────────────────
const InvoiceDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const currentUser = useSelector((s: any) => s.auth.currentUser);
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [paperSize, setPaperSize] = useState("a5");
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [invoiceFields, setInvoiceFields] = useState<InvoiceFields>({
    show_discount_field: true,
    show_tax_field: true,
    show_seller_signature: true,
    show_buyer_signature: true,
    enable_invoice_clone: true,
  });
  const [loading, setLoading] = useState(true);
  const [statusChanging, setStatusChanging] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "jpg" | null>(null); // 'pdf' | 'jpg' | null
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  // Optional rounding of the payable amount (same control as the form).
  const [roundingOn, setRoundingOn] = useState(false);
  const [roundingShow, setRoundingShow] = useState(false);
  const [roundingTarget, setRoundingTarget] = useState<number | string>("");
  const [roundingSaving, setRoundingSaving] = useState(false);
  const [roundingMsg, setRoundingMsg] = useState("");

  useEffect(() => {
    if (!invoice) return;
    setRoundingOn(!!invoice.rounding_enabled);
    setRoundingShow(!!invoice.rounding_show_amount);
    // The stored rounding RULE loads as-is: a manual target only when
    // the invoice actually has one; auto mode loads with an empty
    // target. Never pin the current payable here — that froze the
    // rounded total against later amount changes.
    setRoundingTarget(
      invoice.rounding_target != null ? String(invoice.rounding_target) : "",
    );
    // The edit form flags a dropped manual rounding here so the message
    // survives the navigation from the form to this page.
    try {
      if (sessionStorage.getItem("mohaseb:rounding-cleared") === "1") {
        sessionStorage.removeItem("mohaseb:rounding-cleared");
        setRoundingMsg(
          "⚠️ رند دستی قبلی با تغییر مبلغ فاکتور حذف شد؛ در صورت تمایل مبلغ جدید را دوباره وارد کنید.",
        );
      }
      if (sessionStorage.getItem("mohaseb:upload-warning") === "1") {
        sessionStorage.removeItem("mohaseb:upload-warning");
        setRoundingMsg(
          "⚠️ فاکتور ثبت شد، اما بارگذاری یک یا چند پیوست ناموفق بود؛ پیوست‌ها را از بخش اسناد همین صفحه دوباره بارگذاری کنید.",
        );
      }
    } catch {
      /* storage blocked: non-fatal */
    }
  }, [
    invoice?.id,
    invoice?.rounding_enabled,
    invoice?.rounding_amount,
    invoice?.rounding_target,
    invoice?.rounding_show_amount,
  ]);

  const handleApplyRounding = async () => {
    if (!invoice) return;
    setRoundingSaving(true);
    setRoundingMsg("");
    try {
      const { data } = await invoicesAPI.patch(id, {
        rounding_enabled: roundingOn,
        rounding_target:
          roundingOn && Number(roundingTarget) > 0
            ? Number(roundingTarget)
            : null,
        rounding_show_amount: roundingShow,
      });
      setInvoice(data);
      window.dispatchEvent(new Event("mohaseb:data-changed"));
      setRoundingMsg(
        data?.rounding_cleared
          ? "⚠️ رند دستی قبلی با تغییر مبلغ فاکتور حذف شد؛ در صورت تمایل مبلغ جدید را دوباره وارد کنید."
          : "✅ رند مبلغ اعمال شد",
      );
    } catch {
      setRoundingMsg("❌ خطا در اعمال رند مبلغ");
    } finally {
      setRoundingSaving(false);
    }
  };
  const [requestingEdit, setRequestingEdit] = useState(false);
  const [paymentForm, setPaymentForm] = useState<PaymentFormData>({
    amount: "",
    method: "cash",
    reference: "",
    note: "",
  });
  const [paymentEditId, setPaymentEditId] = useState<number | null>(null);
  const [paymentEditForm, setPaymentEditForm] = useState<PaymentFormData>({
    amount: "",
    method: "cash",
    reference: "",
    note: "",
  });
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [history, setHistory] = useState<AuditEvent[]>([]);
  const [restoringVersionId, setRestoringVersionId] = useState<number | null>(
    null,
  );
  const [expandedVersionId, setExpandedVersionId] = useState<number | null>(
    null,
  );
  const [showPriorSnapshot, setShowPriorSnapshot] = useState(false);
  const [invoiceDocuments, setInvoiceDocuments] = useState<InvoiceDocument[]>(
    [],
  );
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsUploading, setDocumentsUploading] = useState(false);
  const [documentError, setDocumentError] = useState("");
  const [pendingDocuments, setPendingDocuments] = useState<PendingDocument[]>(
    [],
  );
  const [documentPreviews, setDocumentPreviews] = useState<
    Record<number, string>
  >({});
  const [activeDocument, setActiveDocument] = useState<InvoiceDocument | null>(
    null,
  );
  const [activeDocumentUrl, setActiveDocumentUrl] = useState<string | null>(
    null,
  );
  const printRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    invoiceSettingsAPI
      .get()
      .then(({ data }) =>
        setInvoiceFields({
          show_discount_field: data.show_discount_field !== false,
          show_tax_field: data.show_tax_field !== false,
          show_seller_signature: data.show_seller_signature !== false,
          show_buyer_signature: data.show_buyer_signature !== false,
          enable_invoice_clone: data.enable_invoice_clone !== false,
        }),
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    const refreshProfile = () =>
      profileAPI
        .get()
        .then(({ data }) => {
          const p = Array.isArray(data) ? data[0] : data;
          if (p) setProfile(p);
        })
        .catch(() => {});
    refreshProfile();
    window.addEventListener("mohaseb:data-changed", refreshProfile);
    return () =>
      window.removeEventListener("mohaseb:data-changed", refreshProfile);
  }, []);

  useEffect(() => {
    invoicesAPI
      .history(id)
      .then(({ data }) => setHistory(data))
      .catch(() => setHistory([]));
  }, [id]);

  useEffect(() => {
    const refresh = () => {
      invoicesAPI
        .detail(id)
        .then((res) => {
          setInvoice(res.data);
          setPaperSize(res.data.paper_size || "a5");
        })
        .catch(() => {});
      invoicesAPI
        .history(id)
        .then(({ data }) => setHistory(data))
        .catch(() => setHistory([]));
    };
    window.addEventListener("mohaseb:data-changed", refresh);
    return () => window.removeEventListener("mohaseb:data-changed", refresh);
  }, [id]);

  useEffect(() => {
    invoicesAPI
      .detail(id)
      .then((res) => {
        setInvoice(res.data);
        setPaperSize(res.data.paper_size || "a5");
      })
      .catch(() => navigate("/invoices"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    const isOperatorWaiting =
      invoice?.status === "paid" &&
      invoice.edit_request_status === "pending" &&
      !currentUser?.is_staff &&
      !currentUser?.is_superuser;
    if (!isOperatorWaiting) return undefined;
    let active = true;
    const refresh = () =>
      invoicesAPI
        .detail(id)
        .then((res) => {
          if (active) setInvoice(res.data);
        })
        .catch(() => {});
    window.addEventListener("mohaseb:data-changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("mohaseb:data-changed", refresh);
    };
  }, [
    id,
    invoice?.status,
    invoice?.edit_request_status,
    currentUser?.is_staff,
    currentUser?.is_superuser,
  ]);

  // Fetch customer details (phone/email) for display
  useEffect(() => {
    if (invoice?.customer) {
      customersAPI
        .detail(invoice.customer)
        .then(({ data }) => setCustomerInfo(data))
        .catch(() => {});
    }
  }, [invoice?.customer]);

  const loadInvoiceDocuments = async () => {
    if (!id) return;
    setDocumentsLoading(true);
    try {
      const { data } = await documentsAPI.list({ invoice: id });
      setInvoiceDocuments(Array.isArray(data) ? data : data.results || []);
    } catch {
      setDocumentError("دریافت مدارک فاکتور انجام نشد.");
    } finally {
      setDocumentsLoading(false);
    }
  };

  useEffect(() => {
    loadInvoiceDocuments();
  }, [id]);

  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    const loadPreviews = async () => {
      const imageDocuments = invoiceDocuments.filter(
        (document) => document.is_image,
      );
      const entries = await Promise.all(
        imageDocuments.map(async (document) => {
          try {
            const { data } = await documentsAPI.preview(document.id);
            const url = URL.createObjectURL(data);
            urls.push(url);
            return [document.id, url] as const;
          } catch {
            return null;
          }
        }),
      );
      if (!active) return;
      setDocumentPreviews(
        Object.fromEntries(entries.filter(Boolean) as [number, string][]),
      );
    };
    loadPreviews();
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [invoiceDocuments]);

  useEffect(
    () => () => {
      if (activeDocumentUrl) URL.revokeObjectURL(activeDocumentUrl);
    },
    [activeDocumentUrl],
  );

  const handleDocumentUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    if (!invoice?.customer) {
      setDocumentError(
        "برای بارگذاری مدرک، ابتدا یک مشتری برای فاکتور ثبت کنید.",
      );
      event.target.value = "";
      return;
    }
    setDocumentError("");
    setPendingDocuments(
      files.map((file) => ({
        file,
        title: file.name.replace(/\.[^.]+$/, ""),
      })),
    );
    if (documentInputRef.current) documentInputRef.current.value = "";
  };

  const handleSubmitDocuments = async () => {
    if (!invoice?.customer || !pendingDocuments.length) return;
    if (pendingDocuments.some(({ title }) => !title.trim())) {
      setDocumentError("برای هر مدرک یک عنوان وارد کنید.");
      return;
    }
    setDocumentsUploading(true);
    setDocumentError("");
    try {
      await Promise.all(
        pendingDocuments.map(({ file, title }) => {
          const formData = new FormData();
          formData.append("customer", String(invoice.customer));
          formData.append("invoice", String(invoice.id));
          formData.append("title", title.trim());
          formData.append("file", file);
          return documentsAPI.create(formData);
        }),
      );
      setPendingDocuments([]);
      await loadInvoiceDocuments();
      window.dispatchEvent(new Event("mohaseb:data-changed"));
    } catch (error) {
      setDocumentError(
        (error as any)?.response?.data?.file?.[0] ||
          (error as any)?.response?.data?.title?.[0] ||
          "بارگذاری مدرک انجام نشد.",
      );
    } finally {
      setDocumentsUploading(false);
    }
  };

  const handleOpenDocument = async (document: InvoiceDocument) => {
    setDocumentError("");
    try {
      const { data } = await documentsAPI.preview(document.id);
      if (activeDocumentUrl) URL.revokeObjectURL(activeDocumentUrl);
      setActiveDocumentUrl(URL.createObjectURL(data));
      setActiveDocument(document);
    } catch {
      setDocumentError("نمایش مدرک ممکن نشد.");
    }
  };

  const handleDeleteDocument = async (document: InvoiceDocument) => {
    if (!window.confirm(`مدرک «${document.title}» حذف شود؟`)) return;
    setDocumentError("");
    try {
      await documentsAPI.delete(document.id);
      setInvoiceDocuments((items) =>
        items.filter((item) => item.id !== document.id),
      );
      window.dispatchEvent(new Event("mohaseb:data-changed"));
    } catch {
      setDocumentError("حذف مدرک انجام نشد.");
    }
  };

  const handleChangeStatus = async (newStatus: string) => {
    setStatusChanging(true);
    setShowStatusMenu(false);
    try {
      const res = await invoicesAPI.changeStatus(id, newStatus);
      setInvoice(res.data);
    } finally {
      setStatusChanging(false);
    }
  };

  const handleCardSourceChange = async (
    event: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const card_payment_source = event.target.value;
    setStatusChanging(true);
    try {
      const { data } = await invoicesAPI.patch(id, { card_payment_source });
      setInvoice(data);
    } catch (error) {
      setPaymentError(
        error.response?.data?.detail || "ذخیره نوع کارت پرداخت انجام نشد.",
      );
    } finally {
      setStatusChanging(false);
    }
  };

  const handleRequestEdit = async () => {
    setRequestingEdit(true);
    try {
      await invoicesAPI.requestEdit(id);
      const res = await invoicesAPI.detail(id);
      setInvoice(res.data);
    } finally {
      setRequestingEdit(false);
    }
  };

  const handleAddPayment = async (event: React.FormEvent) => {
    event.preventDefault();
    setPaymentSaving(true);
    setPaymentError("");
    try {
      await invoicesAPI.addPayment(id, {
        ...paymentForm,
        amount: Number(paymentForm.amount),
      });
      const [invoiceRes, historyRes] = await Promise.all([
        invoicesAPI.detail(id),
        invoicesAPI.history(id),
      ]);
      setInvoice(invoiceRes.data);
      setHistory(historyRes.data);
      setPaymentForm({ amount: "", method: "cash", reference: "", note: "" });
    } catch (error) {
      setPaymentError(
        error.response?.data?.amount ||
          error.response?.data?.detail ||
          "ثبت پرداخت انجام نشد.",
      );
    } finally {
      setPaymentSaving(false);
    }
  };

  const refreshPaymentData = async () => {
    const [invoiceRes, historyRes] = await Promise.all([
      invoicesAPI.detail(id),
      invoicesAPI.history(id),
    ]);
    setInvoice(invoiceRes.data);
    setHistory(historyRes.data);
  };

  const startPaymentEdit = (payment: InvoicePayment) => {
    setPaymentError("");
    setPaymentEditId(payment.id);
    setPaymentEditForm({
      amount: String(payment.amount),
      method: payment.method,
      reference: payment.reference || "",
      note: payment.note || "",
    });
  };

  const handleUpdatePayment = async (event: React.FormEvent) => {
    event.preventDefault();
    setPaymentSaving(true);
    setPaymentError("");
    try {
      await invoicesAPI.updatePayment(id, paymentEditId, {
        ...paymentEditForm,
        amount: Number(paymentEditForm.amount),
      });
      await refreshPaymentData();
      setPaymentEditId(null);
    } catch (error) {
      setPaymentError(
        error.response?.data?.amount ||
          error.response?.data?.detail ||
          "ویرایش پرداخت انجام نشد.",
      );
    } finally {
      setPaymentSaving(false);
    }
  };

  const handleDeletePayment = async (payment: InvoicePayment) => {
    if (!window.confirm(`پرداخت ${fmt(payment.amount)} حذف شود؟`)) return;
    setPaymentSaving(true);
    setPaymentError("");
    try {
      await invoicesAPI.deletePayment(id, payment.id);
      await refreshPaymentData();
      if (paymentEditId === payment.id) setPaymentEditId(null);
    } catch (error) {
      setPaymentError(error.response?.data?.detail || "حذف پرداخت انجام نشد.");
    } finally {
      setPaymentSaving(false);
    }
  };

  const handleRestoreVersion = async (event: AuditEvent) => {
    if (
      !window.confirm(
        "نسخهٔ پیش از ویرایش جایگزین اطلاعات فعلی فاکتور شود؟ این عملیات در تاریخچه ثبت می‌شود.",
      )
    )
      return;
    setRestoringVersionId(event.id);
    try {
      const invoiceRes = await invoicesAPI.restoreVersion(id, event.id);
      const historyRes = await invoicesAPI.history(id);
      setInvoice(invoiceRes.data);
      setHistory(historyRes.data);
      setPaperSize(invoiceRes.data.paper_size || "a5");
    } catch (error) {
      window.alert(error.response?.data?.detail || "بازیابی نسخه انجام نشد.");
    } finally {
      setRestoringVersionId(null);
    }
  };

  const handlePrint = () => window.print();

  // ?print=1 (e.g. from the quick-invoice success screen) prints once the
  // invoice has loaded.
  const [searchParams] = useSearchParams();
  const autoPrintedRef = useRef(false);
  useEffect(() => {
    if (
      !loading &&
      invoice &&
      searchParams.get("print") === "1" &&
      !autoPrintedRef.current
    ) {
      autoPrintedRef.current = true;
      const timer = setTimeout(() => window.print(), 400);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [loading, invoice, searchParams]);

  const captureCanvas = async () => {
    const { default: html2canvas } = await import("html2canvas");
    const el = exportRef.current;
    if (!el) return null;
    return html2canvas(el, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
    });
  };

  const handleSavePDF = async () => {
    setExporting("pdf");
    try {
      const canvas = await captureCanvas();
      if (!canvas) return;
      const { jsPDF } = await import("jspdf");
      const fmt = paperSize.toUpperCase();
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: fmt,
      });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      // Scale image to fill page width
      const ratio = canvas.height / canvas.width;
      const imgH = pageW * ratio;
      let y = 0;
      let remaining = imgH;
      // handle multi-page
      while (remaining > 0) {
        pdf.addImage(
          imgData,
          "JPEG",
          0,
          y === 0
            ? 0
            : -imgH +
                remaining +
                pageH *
                  (Math.ceil(imgH / pageH) - Math.ceil(remaining / pageH)),
          pageW,
          imgH,
        );
        remaining -= pageH;
        if (remaining > 0) pdf.addPage();
        y += pageH;
      }
      pdf.save(`${invoice.invoice_number || "invoice"}.pdf`);
    } finally {
      setExporting(null);
    }
  };

  const handleSaveJPG = async () => {
    setExporting("jpg");
    try {
      const canvas = await captureCanvas();
      if (!canvas) return;
      const link = document.createElement("a");
      link.download = `${invoice.invoice_number || "invoice"}.jpg`;
      link.href = canvas.toDataURL("image/jpeg", 0.95);
      link.click();
    } finally {
      setExporting(null);
    }
  };

  if (loading)
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  if (!invoice) return null;

  const isPaidOperator =
    invoice.status === "paid" &&
    !currentUser?.is_staff &&
    !currentUser?.is_superuser;
  const isManager = !!(currentUser?.is_staff || currentUser?.is_superuser);
  const latestInvoiceVersion = isManager
    ? history.find((event) => event.is_invoice_version)
    : null;
  const priorSnapshot = latestInvoiceVersion?.changes?.before;
  const editDateText = latestInvoiceVersion?.created_at
    ? new Intl.DateTimeFormat("fa-IR", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(latestInvoiceVersion.created_at))
    : null;
  const priorSnapshotCustomer =
    priorSnapshot?.customer_name ||
    (priorSnapshot?.customer === invoice.customer
      ? invoice.customer_name
      : `شناسه ${priorSnapshot?.customer || "---"}`);
  const priorSnapshotSubtotal = (priorSnapshot?.items || []).reduce(
    (sum, item) =>
      sum +
      (Number(item.main_price) + Number(item.extra_price)) *
        Number(item.quantity || 1),
    0,
  );
  const priorSnapshotFinal =
    priorSnapshotSubtotal +
    Number(priorSnapshot?.commission_total || 0) +
    (priorSnapshotSubtotal * Number(priorSnapshot?.tax || 0)) / 100 -
    Number(priorSnapshot?.discount || 0);

  const subtotal =
    invoice.items?.reduce(
      (s, it) =>
        s +
        ((Number(it.main_price) || 0) + (Number(it.extra_price) || 0)) *
          (Number(it.quantity) || 1),
      0,
    ) || 0;
  const taxAmount = (subtotal * Number(invoice.tax || 0)) / 100;
  const commissionAmt = Number(invoice.commission_total || 0);
  const finalAmount =
    subtotal +
    commissionAmt +
    taxAmount -
    Number(invoice.discount || 0) +
    Number(invoice.rounding_amount || 0);
  // Pre-rounding payable (the API final already includes the adjustment).
  const roundingBase =
    Number(invoice.final_amount || 0) - Number(invoice.rounding_amount || 0);
  const roundingPreview = roundingOn
    ? computeRoundingAdjustment(
        roundingBase,
        Number(roundingTarget) > 0 ? Number(roundingTarget) : null,
      )
    : 0;
  const finalAmountWords = numberToWords(finalAmount);

  return (
    <>
      <style>{buildPrintCSS(paperSize)}</style>

      {/* ── Toolbar (no-print) ── */}
      <div className="no-print space-y-4 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <Link
              to="/invoices"
              className="text-slate-400 hover:text-white text-sm flex items-center gap-1 mb-2 transition-colors"
            >
              ← بازگشت به فاکتورها
            </Link>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-white whitespace-nowrap">
                {invoice.invoice_number}
              </h2>
              <StatusBadge
                status={
                  invoice.commission_paid && invoice.status !== "paid"
                    ? "commission_paid"
                    : invoice.status
                }
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {Number(invoice.commission_total) > 0 && !isPaidOperator && (
              <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-600/20 text-emerald-300 text-sm border border-emerald-500/30 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(invoice.commission_paid)}
                  disabled={statusChanging}
                  onChange={async (event) => {
                    setStatusChanging(true);
                    try {
                      const { data } = await invoicesAPI.markCommissionPaid(
                        id,
                        event.target.checked,
                      );
                      setInvoice(data);
                      window.dispatchEvent(new Event("mohaseb:data-changed"));
                    } finally {
                      setStatusChanging(false);
                    }
                  }}
                />
                کارمزد توسط مشتری پرداخت شده است
              </label>
            )}
            {!isPaidOperator && (
              <label className="flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-slate-300">
                <span>کارت پرداخت</span>
                <select
                  aria-label="کارت پرداخت فاکتور"
                  value={invoice.card_payment_source || "customer"}
                  onChange={handleCardSourceChange}
                  disabled={statusChanging}
                  className="rounded-lg border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-white disabled:opacity-60"
                >
                  <option value="customer">کارت مشتری</option>
                  <option value="office">کارت دفتر</option>
                </select>
              </label>
            )}
            {/* Status Change Dropdown */}
            {!isPaidOperator && (
              <div className="relative">
                <button
                  onClick={() => setShowStatusMenu((v) => !v)}
                  disabled={statusChanging}
                  className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm border border-slate-600 transition-all flex items-center gap-2"
                >
                  {statusChanging ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    "⚡"
                  )}
                  تغییر وضعیت
                </button>
                {showStatusMenu && (
                  <div className="absolute left-0 top-full mt-1 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl z-50 overflow-hidden w-48">
                    {Object.entries(STATUS_MAP)
                      .filter(([val]) => val !== "commission_paid")
                      .map(([val, { label, color }]) => (
                        <button
                          key={val}
                          onClick={() => handleChangeStatus(val)}
                          className={`w-full text-right px-4 py-2.5 text-sm hover:bg-slate-700 transition-colors flex items-center gap-2 ${invoice.status === val ? "bg-slate-700" : ""}`}
                        >
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs border ${color}`}
                          >
                            {label}
                          </span>
                          {invoice.status === val && (
                            <span className="text-blue-400 text-xs mr-auto">
                              ✓ فعلی
                            </span>
                          )}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            )}

            {invoice.can_edit && (
              <Link
                to={`/invoices/${id}/edit`}
                className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm transition-all flex items-center gap-2"
              >
                ✏️ ویرایش
              </Link>
            )}
            {isManager && latestInvoiceVersion && (
              <button
                type="button"
                onClick={() => setShowPriorSnapshot(true)}
                className="px-3 py-2 rounded-xl bg-sky-700/80 hover:bg-sky-600 text-white text-sm border border-sky-500/40 transition-all flex items-center gap-2"
              >
                ◷ نمایش فاکتور پیش از ویرایش
              </button>
            )}
            {invoice.status === "paid" &&
              !currentUser?.is_staff &&
              !currentUser?.is_superuser &&
              (invoice.edit_request_status === "approved" ? (
                <span className="px-3 py-2 rounded-xl bg-green-600/20 border border-green-500/30 text-green-300 text-sm">
                  درخواست ویرایش تأیید شد
                </span>
              ) : invoice.edit_request_status === "pending" ? (
                <button
                  disabled
                  className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 text-sm cursor-wait"
                >
                  درخواست ویرایش · در انتظار تأیید
                </button>
              ) : (
                <button
                  onClick={handleRequestEdit}
                  disabled={requestingEdit}
                  className="px-3 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-700 text-sm disabled:opacity-50"
                >
                  {requestingEdit
                    ? "در حال ارسال..."
                    : "درخواست ویرایش از مدیر"}
                </button>
              ))}

            {invoiceFields.enable_invoice_clone && (
              <Link
                to={`/invoices/new?clone=${id}`}
                className="px-3 py-2 rounded-xl bg-teal-600/80 hover:bg-teal-600 text-white text-sm border border-teal-500/50 transition-all flex items-center gap-2"
                title="صدور فاکتور جدید با همین مشخصات و ردیف‌ها"
              >
                📋 صدور مشابه
              </Link>
            )}

            <button
              onClick={handlePrint}
              className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm border border-slate-600 transition-all flex items-center gap-2"
            >
              🖨️ چاپ ({paperSize.toUpperCase()})
            </button>

            <button
              onClick={handleSavePDF}
              disabled={!!exporting}
              className="px-3 py-2 rounded-xl bg-red-700/80 hover:bg-red-600 text-white text-sm border border-red-600/50 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-wait"
            >
              {exporting === "pdf" ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                "📄"
              )}
              ذخیره PDF
            </button>

            <button
              onClick={handleSaveJPG}
              disabled={!!exporting}
              className="px-3 py-2 rounded-xl bg-emerald-700/80 hover:bg-emerald-600 text-white text-sm border border-emerald-600/50 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-wait"
            >
              {exporting === "jpg" ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                "🖼️"
              )}
              ذخیره تصویر
            </button>
          </div>
        </div>

        {/* Paper Size */}
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>📄 سایز چاپ:</span>
          {isPaidOperator ? (
            <select
              value={paperSize}
              onChange={(event) => setPaperSize(event.target.value)}
              aria-label="اندازهٔ چاپ فاکتور"
              className="rounded-lg border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-white"
            >
              <option value="a5">A5</option>
              <option value="a4">A4</option>
              <option value="a6">A6</option>
            </select>
          ) : (
            ["a4", "a5", "a6"].map((sz) => (
              <span
                key={sz}
                className={`px-2 py-0.5 rounded-lg border text-xs ${paperSize === sz ? "bg-blue-500/20 text-blue-300 border-blue-500/40" : "border-slate-700 text-slate-500"}`}
              >
                {sz.toUpperCase()}
              </span>
            ))
          )}
          {isPaidOperator && (
            <span className="text-slate-600">
              — برای چاپ همین اندازه استفاده می‌شود
            </span>
          )}
        </div>
      </div>

      {/* ── Printable Invoice Area ── */}
      <div id="invoice-print-area" ref={printRef}>
        {/* Invoice Card (screen) */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden no-print-border">
          {/* Header */}
          <div className="print-header bg-transparent border border-slate-900 rounded-2xl p-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                {profile?.logo_url ? (
                  <img
                    src={profile.logo_url}
                    alt="logo"
                    className="w-12 h-12 rounded-xl object-cover"
                    crossOrigin="anonymous"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-xl">
                    💎
                  </div>
                )}
                <div>
                  <h1 className="text-white font-bold text-lg">
                    {profile?.name || "محاسب پرو"}
                  </h1>
                  <p className="text-slate-400 text-xs">
                    {profile?.subtitle || "سیستم مدیریت مالی"}
                  </p>
                  {profile?.phone && (
                    <p className="text-slate-400 text-xs">📞 {profile.phone}</p>
                  )}
                  {profile?.mobile && (
                    <p className="text-slate-400 text-xs">
                      📱 {profile.mobile}
                    </p>
                  )}
                  {profile?.address && (
                    <p className="text-slate-400 text-xs">
                      📍 {profile.address}
                    </p>
                  )}
                </div>
              </div>
              <div className="text-left space-y-1">
                <p className="text-blue-400 font-mono text-lg font-bold whitespace-nowrap">
                  {invoice.invoice_number}
                </p>
                <StatusBadge
                  status={
                    invoice.commission_paid && invoice.status !== "paid"
                      ? "commission_paid"
                      : invoice.status
                  }
                />
                <p className="text-slate-500 text-xs">
                  تاریخ صدور: {persianDate(invoice.date)}
                </p>
                {editDateText && (
                  <p className="text-slate-400 text-[10px] mt-0.5">
                    ویرایش: {editDateText}
                  </p>
                )}
                {invoice.created_at && (
                  <p className="text-slate-500 text-xs mt-1">
                    ایجاد: {persianDate(invoice.created_at)}،{" "}
                    {new Intl.DateTimeFormat("fa-IR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(invoice.created_at))}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Customer + Vehicle Info — compact horizontal layout */}
          <div className="border-b border-slate-700/50 px-5 py-4">
            <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
              {/* Customer card */}
              <div className="flex items-center gap-3 min-w-[160px]">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500/30 to-blue-600/20 border border-indigo-500/30 flex items-center justify-center text-base shrink-0">
                  👤
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">
                    مشتری
                  </p>
                  <div className="flex items-center gap-2">
                    {invoice.customer ? (
                      <Link
                        to={`/customers/${invoice.customer}`}
                        className="text-white text-sm font-semibold leading-tight hover:text-blue-300 hover:underline"
                      >
                        {invoice.customer_name || "---"}
                      </Link>
                    ) : (
                      <span className="text-white text-sm font-semibold leading-tight">
                        {invoice.customer_name || "---"}
                      </span>
                    )}
                    {invoice.customer && (
                      <Link
                        to={`/customers/${invoice.customer}?tab=edit`}
                        className="rounded-md border border-slate-600 px-1.5 py-0.5 text-[10px] text-blue-300 hover:bg-slate-700"
                        title="مشاهده و ویرایش پروفایل مشتری"
                      >
                        پروفایل
                      </Link>
                    )}
                  </div>
                  {customerInfo?.phone && (
                    <p className="text-slate-400 text-[11px] mt-0.5 font-mono dir-ltr">
                      📞 {customerInfo.phone}
                    </p>
                  )}
                  {customerInfo?.email && (
                    <p className="text-slate-500 text-[10px] truncate max-w-[140px]">
                      ✉ {customerInfo.email}
                    </p>
                  )}
                </div>
              </div>

              {/* Divider */}
              <div className="hidden sm:block w-px self-stretch bg-slate-700/50" />

              {/* Vehicle chips */}
              <div className="flex flex-wrap gap-2 flex-1">
                {(invoice.green_card_owner_name ||
                  invoice.green_card_owner_national_id) && (
                  <div className="flex flex-wrap gap-2 w-full">
                    {invoice.green_card_owner_name && (
                      <span className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs text-indigo-200">
                        صاحب برگ سبز: {invoice.green_card_owner_name}
                      </span>
                    )}
                    {invoice.green_card_owner_national_id && (
                      <span className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs text-indigo-200">
                        کد ملی: {invoice.green_card_owner_national_id}
                      </span>
                    )}
                  </div>
                )}
                {invoice.vehicle_plate && (
                  <div className="flex items-center gap-1.5 bg-slate-700/40 border border-slate-600/40 rounded-lg px-3 py-1.5">
                    <span className="text-slate-500 text-[10px]">پلاک</span>
                    <span className="text-white font-mono text-xs">
                      {invoice.vehicle_plate}
                    </span>
                  </div>
                )}
                {invoice.vehicle_type && (
                  <div className="flex items-center gap-1.5 bg-slate-700/40 border border-slate-600/40 rounded-lg px-3 py-1.5">
                    <span className="text-slate-500 text-[10px]">نوع</span>
                    <span className="text-white text-xs">
                      {invoice.vehicle_type}
                    </span>
                  </div>
                )}
                {invoice.vehicle_model && (
                  <div className="flex items-center gap-1.5 bg-slate-700/40 border border-slate-600/40 rounded-lg px-3 py-1.5">
                    <span className="text-slate-500 text-[10px]">مدل</span>
                    <span className="text-white text-xs">
                      {invoice.vehicle_model}
                    </span>
                  </div>
                )}
                {invoice.vehicle_year && (
                  <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/25 rounded-lg px-3 py-1.5">
                    <span className="text-emerald-600/70 text-[10px]">سال</span>
                    <span className="text-emerald-400 text-xs font-medium">
                      {invoice.vehicle_year}
                    </span>
                  </div>
                )}
                {invoice.vehicle_vin && (
                  <div className="flex items-center gap-1.5 bg-slate-700/40 border border-slate-600/40 rounded-lg px-3 py-1.5">
                    <span className="text-slate-500 text-[10px]">VIN</span>
                    <span className="text-white font-mono text-[10px]">
                      {invoice.vehicle_vin}
                    </span>
                  </div>
                )}
                {invoice.due_date && (
                  <div className="flex items-center gap-1.5 bg-yellow-500/10 border border-yellow-500/25 rounded-lg px-3 py-1.5">
                    <span className="text-yellow-600/70 text-[10px]">
                      سررسید
                    </span>
                    <span className="text-yellow-400 text-xs">
                      {persianDate(invoice.due_date)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Items Table */}
          <div className="p-5 border-b border-slate-700/50">
            <div className="overflow-x-auto">
              <table className="print-table w-full text-sm">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700/50 text-xs">
                    <th className="text-right py-3 px-2 font-medium">#</th>
                    <th className="text-right py-3 px-2 font-medium">خدمت</th>
                    <th className="text-right py-3 px-2 font-medium">تعداد</th>
                    <th className="text-right py-3 px-2 font-medium">
                      مبلغ پرداختی
                    </th>
                    <th className="text-right py-3 px-2 font-medium">
                      مبلغ استعلامی
                    </th>
                    <th className="text-right py-3 px-2 font-medium">
                      جمع ردیف
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                  {invoice.items?.map((item, i) => (
                    <tr key={item.id || i}>
                      <td className="py-3 px-2 text-slate-500 text-xs">
                        {i + 1}
                      </td>
                      <td className="py-3 px-2 text-white font-medium">
                        {item.service_title_snapshot ||
                          item.service_title ||
                          "---"}
                        {item.notes && (
                          <p className="text-slate-500 text-xs mt-0.5">
                            {item.notes}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-2 text-slate-300">
                        {item.quantity}
                      </td>
                      <td className="py-3 px-2 text-slate-300">
                        {fmt(item.main_price)}
                      </td>
                      <td className="py-3 px-2 text-slate-400">
                        {Number(item.extra_price) > 0
                          ? fmt(item.extra_price)
                          : "—"}
                      </td>
                      <td className="py-3 px-2 text-white font-semibold">
                        {fmt(item.line_total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Description */}
          {invoice.description && (
            <div className="px-5 py-4 border-b border-slate-700/50">
              <p className="text-slate-500 text-xs mb-1">توضیحات</p>
              <p className="text-slate-300 text-sm">{invoice.description}</p>
            </div>
          )}

          <PaymentDescriptions payments={invoice.payments || []} />

          <section className="no-print border-b border-slate-700/50 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-white">
                  📎 مدارک پیوست فاکتور
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  مدارک در پوشهٔ مشتری و همراه این فاکتور ذخیره می‌شوند.
                </p>
              </div>
              <label
                className={`cursor-pointer rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 ${documentsUploading ? "pointer-events-none opacity-60" : ""}`}
              >
                {documentsUploading ? "در حال بارگذاری…" : "افزودن مدرک"}
                <input
                  ref={documentInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  disabled={documentsUploading}
                  onChange={handleDocumentUpload}
                />
              </label>
            </div>
            {documentError && (
              <div className="mt-3">
                <ErrorNotice message={documentError} />
              </div>
            )}
            {documentsLoading ? (
              <p className="mt-4 text-xs text-slate-500">
                در حال دریافت مدارک…
              </p>
            ) : invoiceDocuments.length > 0 ? (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {invoiceDocuments.map((document) => (
                  <div
                    key={document.id}
                    className="flex items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-900/30 px-3 py-2.5"
                  >
                    {document.is_image && documentPreviews[document.id] ? (
                      <button
                        type="button"
                        onClick={() => handleOpenDocument(document)}
                        aria-label={`نمایش ${document.title || "مدرک"}`}
                      >
                        <img
                          src={documentPreviews[document.id]}
                          alt=""
                          className="h-12 w-12 rounded-lg object-cover"
                        />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleOpenDocument(document)}
                        aria-label={`نمایش ${document.title || "مدرک"}`}
                        className="text-lg"
                      >
                        📄
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleOpenDocument(document)}
                      className="min-w-0 flex-1 truncate text-sm text-blue-300 hover:text-blue-200 hover:underline"
                    >
                      {document.title || "مدرک بدون عنوان"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        downloadDocumentFile(
                          document.id,
                          document.file_name || document.title || "document",
                        ).catch(() => setDocumentError("دانلود مدرک ممکن نشد."))
                      }
                      className="text-xs text-slate-300 hover:text-white"
                    >
                      دانلود
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteDocument(document)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      حذف
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-xs text-slate-500">
                مدرکی برای این فاکتور ثبت نشده است.
              </p>
            )}
          </section>

          <PaymentHistorySection
            payments={invoice.payments}
            paidAmount={invoice.paid_amount}
            remainingAmount={invoice.remaining_amount}
            invoiceStatus={invoice.status}
            paymentForm={paymentForm}
            setPaymentForm={setPaymentForm}
            paymentSaving={paymentSaving}
            paymentError={paymentError}
            paymentEditId={paymentEditId}
            setPaymentEditId={setPaymentEditId}
            paymentEditForm={paymentEditForm}
            setPaymentEditForm={setPaymentEditForm}
            startPaymentEdit={startPaymentEdit}
            isPaidOperator={isPaidOperator}
            onAddPayment={handleAddPayment}
            onDeletePayment={handleDeletePayment}
            onUpdatePayment={handleUpdatePayment}
          />

          {pendingDocuments.length > 0 && (
            <Modal
              isOpen
              onClose={() => {
                if (!documentsUploading) setPendingDocuments([]);
              }}
              title="عنوان‌گذاری مدارک فاکتور"
              size="md"
              dismissible={!documentsUploading}
            >
              <p className="mb-4 text-sm text-slate-400">
                برای هر فایل عنوان وارد کنید. نام ذخیره‌شده شامل شماره فاکتور و
                این عنوان خواهد بود.
              </p>
              <div className="space-y-3">
                {pendingDocuments.map((document, index) => (
                  <InputField
                    key={`${document.file.name}-${index}`}
                    label={document.file.name}
                    value={document.title}
                    disabled={documentsUploading}
                    onChange={(event) =>
                      setPendingDocuments((items) =>
                        items.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, title: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                ))}
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <Button
                  variant="ghost"
                  onClick={() => setPendingDocuments([])}
                  disabled={documentsUploading}
                >
                  انصراف
                </Button>
                <Button
                  onClick={handleSubmitDocuments}
                  loading={documentsUploading}
                >
                  ذخیره مدارک
                </Button>
              </div>
            </Modal>
          )}

          {activeDocument && activeDocumentUrl && (
            <Modal
              isOpen
              onClose={() => {
                URL.revokeObjectURL(activeDocumentUrl);
                setActiveDocumentUrl(null);
                setActiveDocument(null);
              }}
              title={activeDocument.title || "نمایش مدرک"}
              size="xl"
            >
              <div className="space-y-4">
                {activeDocument.is_image ? (
                  <img
                    src={activeDocumentUrl}
                    alt={activeDocument.title || "مدرک"}
                    className="mx-auto max-h-[65vh] max-w-full rounded-xl object-contain"
                  />
                ) : activeDocument.content_type === "application/pdf" ||
                  activeDocument.content_type?.startsWith("text/") ? (
                  <iframe
                    src={activeDocumentUrl}
                    title={activeDocument.title || "نمایش مدرک"}
                    className="h-[65vh] w-full rounded-xl bg-white"
                  />
                ) : (
                  <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-6 text-center text-sm text-slate-300">
                    پیش‌نمایش این نوع فایل در مرورگر ممکن نیست؛ برای دریافت آن
                    از دکمهٔ دانلود استفاده کنید.
                  </div>
                )}
                <div className="flex justify-end">
                  <Button
                    onClick={() =>
                      downloadDocumentFile(
                        activeDocument.id,
                        activeDocument.file_name ||
                          activeDocument.title ||
                          "document",
                      ).catch(() => setDocumentError("دانلود مدرک ممکن نشد."))
                    }
                  >
                    دانلود مدرک
                  </Button>
                </div>
              </div>
            </Modal>
          )}

          {/* Totals */}
          <div className="p-5">
            {invoice.can_edit && (
              <div className="print:hidden flex justify-end mb-4">
                <div className="w-full max-w-sm bg-sky-500/5 border border-sky-500/25 rounded-xl p-4">
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={roundingOn}
                      onChange={(e) => setRoundingOn(e.target.checked)}
                      className="accent-sky-500"
                    />
                    🔢 رند کردن مبلغ فاکتور
                  </label>
                  {roundingOn && (
                    <div className="mt-3 space-y-2">
                      <label className="text-xs text-slate-400 block">
                        مبلغ نهایی دلخواه (اختیاری)
                      </label>
                      <PriceInput
                        value={roundingTarget}
                        onChange={(v) => setRoundingTarget(v)}
                        borderColor="border-sky-500/30 focus:ring-sky-500/30"
                        blankWhenZero
                      />
                      <p className="text-sky-500/60 text-[10px]">
                        خالی بماند: رند به نزدیک‌ترین ۱۰ هزار تومان (ریزِ کمتر
                        از ۵ هزار به پایین، ۵ هزار و بیشتر به بالا). اگر مبلغ
                        نهایی دلخواه را وارد کنید و بعد مبلغ فاکتور عوض شود، رند
                        دستی حذف می‌شود و باید دوباره واردش کنید.
                      </p>
                      <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                        <input
                          type="checkbox"
                          checked={roundingShow}
                          onChange={(e) => setRoundingShow(e.target.checked)}
                          className="accent-sky-500"
                        />
                        نمایش مبلغ رند در فاکتور
                        <span className="text-slate-500">
                          (پیش‌فرض: بدون نمایش)
                        </span>
                      </label>
                      <p className="text-sky-300 text-xs">
                        مبلغ نهایی پس از رند:{" "}
                        {fmt(roundingBase + roundingPreview)}
                        {roundingPreview !== 0 &&
                          ` (${roundingPreview > 0 ? "+" : "−"}${fmt(Math.abs(roundingPreview))} تومان)`}
                      </p>
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-3">
                    <Button
                      variant="primary"
                      onClick={handleApplyRounding}
                      loading={roundingSaving}
                    >
                      {!roundingSaving && "اعمال رند"}
                    </Button>
                    {roundingMsg && (
                      <span className="text-xs text-slate-300">
                        {roundingMsg}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
            <div className="flex justify-end">
              <div className="w-full max-w-sm space-y-2.5">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">جمع خدمات</span>
                  <span className="text-slate-200">{fmt(subtotal)}</span>
                </div>
                {Number(invoice.commission_total) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400/80">
                      💼{" "}
                      <span className="print:hidden">کارمزد (درآمد شما)</span>
                      <span className="hidden print:inline">کارمزد</span>
                    </span>
                    <span className="text-gray-400">
                      +{fmt(invoice.commission_total)}
                    </span>
                  </div>
                )}
                {invoiceFields.show_tax_field && Number(invoice.tax) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">
                      مالیات ({invoice.tax}%)
                    </span>
                    <span className="text-orange-400">+{fmt(taxAmount)}</span>
                  </div>
                )}
                {invoiceFields.show_discount_field &&
                  Number(invoice.discount) > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">تخفیف</span>
                      <span className="text-green-400">
                        −{fmt(Number(invoice.discount))}
                      </span>
                    </div>
                  )}
                {invoice.rounding_show_amount &&
                  Number(invoice.rounding_amount || 0) !== 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">رند مبلغ</span>
                      <span className="text-sky-400">
                        {Number(invoice.rounding_amount) > 0 ? "+" : "−"}
                        {fmt(Math.abs(Number(invoice.rounding_amount)))}
                      </span>
                    </div>
                  )}
                <div className="flex justify-between text-base font-bold border-t border-slate-600 pt-3">
                  <span className="text-slate-100">
                    جمع قابل پرداخت توسط مشتری
                  </span>
                  <span className="text-blue-400 text-xl">
                    {fmt(finalAmount)}
                  </span>
                </div>
                {Number(invoice.paid_amount ?? 0) > 0 &&
                  Number(invoice.remaining_amount ?? 0) > 0 &&
                  !["cancelled", "draft"].includes(invoice.status) && (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-400">دریافت‌شده</span>
                        <span className="text-emerald-400">
                          {fmt(invoice.paid_amount)}
                        </span>
                      </div>
                      <div className="flex justify-between text-base font-bold">
                        <span className="text-amber-400">
                          مانده قابل پرداخت
                        </span>
                        <span className="text-amber-400">
                          {fmt(invoice.remaining_amount)}
                        </span>
                      </div>
                    </>
                  )}
                {/* Amount in words */}
                <div className="bg-slate-700/30 rounded-lg px-3 py-2 border border-slate-600/30">
                  <span className="text-slate-500 text-[10px]">به حروف: </span>
                  <span className="text-slate-300 text-[11px] font-medium">
                    {finalAmountWords}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Seller seal and buyer signature */}
        {(invoiceFields.show_seller_signature ||
          invoiceFields.show_buyer_signature) && (
          <div
            className={`grid ${invoiceFields.show_seller_signature && invoiceFields.show_buyer_signature ? "grid-cols-2" : "grid-cols-1"} gap-4 border-t border-slate-700/50 p-5 print-seller-signature`}
          >
            {invoiceFields.show_seller_signature && (
              <div className="flex min-h-28 flex-col justify-between rounded-xl border border-dashed border-slate-500/60 p-3">
                <span className="text-xs font-semibold text-slate-300">
                  مهر و امضای فروشنده
                </span>
                <span className="text-center text-[10px] text-slate-500">
                  محل مهر و امضا
                </span>
              </div>
            )}
            {invoiceFields.show_buyer_signature && (
              <div className="flex min-h-28 flex-col justify-between rounded-xl border border-dashed border-slate-500/60 p-3">
                <span className="text-xs font-semibold text-slate-300">
                  امضای خریدار
                </span>
                <span className="text-center text-[10px] text-slate-500">
                  نام و امضا
                </span>
              </div>
            )}
          </div>
        )}

        {/* Print Footer */}
        <div className="hidden print:block text-center text-sm font-semibold text-gray-600 mt-4 pt-2 border-t border-gray-200">
          {profile?.footer_text ||
            "این فاکتور توسط سیستم محاسب پرو صادر شده است"}
          {profile?.website && (
            <span className="mr-2">| {profile.website}</span>
          )}
          {!!profile?.social_links?.length && (
            <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 font-normal">
              {profile.social_links.map((item) => (
                <span
                  key={item.id}
                  className="inline-flex items-center gap-1.5"
                  dir="ltr"
                >
                  {item.logo_url && (
                    <img
                      src={item.logo_url}
                      alt=""
                      crossOrigin="anonymous"
                      className="h-4 w-4 object-contain"
                    />
                  )}
                  <span>
                    {item.name}: {item.url}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {isManager && showPriorSnapshot && priorSnapshot && (
        <div
          className="no-print fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="prior-invoice-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget)
              setShowPriorSnapshot(false);
          }}
        >
          <section className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-slate-600 bg-slate-900 shadow-2xl">
            <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-700 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <div>
                <h3
                  id="prior-invoice-title"
                  className="text-lg font-bold text-white"
                >
                  فاکتور پیش از ویرایش
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  این تصویر، اطلاعات فاکتور را پیش از آخرین ویرایش نشان می‌دهد.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPriorSnapshot(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
                aria-label="بستن پیش‌نمایش"
              >
                بستن ✕
              </button>
            </header>
            <div className="space-y-5 p-5 text-sm text-slate-200">
              <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-slate-700 bg-slate-800/60 p-4">
                <div>
                  <p className="text-xs text-slate-400">شماره فاکتور</p>
                  <p className="mt-1 font-mono text-lg font-bold text-blue-300">
                    {invoice.invoice_number}
                  </p>
                  <p className="mt-2 text-xs text-slate-400">
                    مشتری:{" "}
                    <span className="text-slate-200">
                      {priorSnapshotCustomer}
                    </span>
                  </p>
                </div>
                <div className="text-left text-xs">
                  <p className="text-slate-300">
                    تاریخ صدور:{" "}
                    {priorSnapshot.date
                      ? persianDate(priorSnapshot.date)
                      : "---"}
                  </p>
                  <p className="mt-1 text-sky-300">
                    تاریخ ویرایش: {editDateText}
                  </p>
                  <p className="mt-2">
                    <StatusBadge status={priorSnapshot.status} />
                  </p>
                </div>
              </div>

              {(priorSnapshot.vehicle_plate ||
                priorSnapshot.vehicle_type ||
                priorSnapshot.vehicle_model ||
                priorSnapshot.vehicle_year ||
                priorSnapshot.vehicle_vin ||
                priorSnapshot.due_date) && (
                <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-xl border border-slate-700 p-4 text-xs text-slate-300">
                  {priorSnapshot.vehicle_plate && (
                    <span>پلاک: {priorSnapshot.vehicle_plate}</span>
                  )}
                  {priorSnapshot.vehicle_type && (
                    <span>نوع خودرو: {priorSnapshot.vehicle_type}</span>
                  )}
                  {priorSnapshot.vehicle_model && (
                    <span>مدل: {priorSnapshot.vehicle_model}</span>
                  )}
                  {priorSnapshot.vehicle_year && (
                    <span>سال ساخت: {priorSnapshot.vehicle_year}</span>
                  )}
                  {priorSnapshot.vehicle_vin && (
                    <span>VIN: {priorSnapshot.vehicle_vin}</span>
                  )}
                  {priorSnapshot.due_date && (
                    <span>سررسید: {persianDate(priorSnapshot.due_date)}</span>
                  )}
                </div>
              )}

              <div className="overflow-x-auto rounded-xl border border-slate-700">
                <table className="w-full min-w-[620px] text-right text-xs">
                  <thead className="bg-slate-800 text-slate-300">
                    <tr>
                      <th className="p-3">شرح</th>
                      <th className="p-3">تعداد</th>
                      <th className="p-3">مبلغ پرداختی</th>
                      <th className="p-3">مبلغ استعلام</th>
                      <th className="p-3">کارمزد</th>
                      <th className="p-3">جمع ردیف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {(priorSnapshot.items || []).map((item, index) => (
                      <tr
                        key={`${latestInvoiceVersion.id}-${item.id || index}`}
                      >
                        <td className="p-3">
                          {item.title || "خدمت"}
                          {item.notes && (
                            <div className="mt-1 text-[10px] text-slate-500">
                              {item.notes}
                            </div>
                          )}
                        </td>
                        <td className="p-3">
                          {new Intl.NumberFormat("fa-IR").format(
                            item.quantity || 1,
                          )}
                        </td>
                        <td className="p-3">{fmt(item.main_price)}</td>
                        <td className="p-3">{fmt(item.extra_price)}</td>
                        <td className="p-3">
                          {fmt(
                            Number(item.commission) *
                              Number(item.quantity || 1),
                          )}
                        </td>
                        <td className="p-3">
                          {fmt(
                            (Number(item.main_price) +
                              Number(item.extra_price)) *
                              Number(item.quantity || 1),
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {priorSnapshot.description && (
                <p className="whitespace-pre-wrap rounded-xl border border-slate-700 p-4 text-xs text-slate-300">
                  توضیحات: {priorSnapshot.description}
                </p>
              )}
              <div className="ml-auto max-w-sm space-y-2 rounded-xl border border-slate-700 bg-slate-800/50 p-4 text-xs">
                <div className="flex justify-between">
                  <span>مبلغ کل</span>
                  <span>{fmt(priorSnapshotSubtotal)}</span>
                </div>
                {Number(priorSnapshot.commission_total) > 0 && (
                  <div className="flex justify-between">
                    <span>کارمزد</span>
                    <span>{fmt(priorSnapshot.commission_total)}</span>
                  </div>
                )}
                {invoiceFields.show_tax_field &&
                  Number(priorSnapshot.tax) > 0 && (
                    <div className="flex justify-between">
                      <span>مالیات ({priorSnapshot.tax}٪)</span>
                      <span>
                        {fmt(
                          (priorSnapshotSubtotal * Number(priorSnapshot.tax)) /
                            100,
                        )}
                      </span>
                    </div>
                  )}
                {invoiceFields.show_discount_field &&
                  Number(priorSnapshot.discount) > 0 && (
                    <div className="flex justify-between">
                      <span>تخفیف</span>
                      <span>−{fmt(priorSnapshot.discount)}</span>
                    </div>
                  )}
                <div className="flex justify-between border-t border-slate-700 pt-2 text-sm font-bold text-white">
                  <span>مبلغ نهایی</span>
                  <span>{fmt(priorSnapshotFinal)}</span>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {isManager && history.length > 0 && (
        <section className="no-print mt-6 rounded-2xl border border-slate-700/50 bg-slate-800/40 p-5">
          <h3 className="mb-3 font-semibold text-white">تاریخچهٔ فاکتور</h3>
          <div className="space-y-2">
            {history.map((event) => {
              const oldInvoice = event.changes?.before;
              const canRestore =
                event.is_invoice_version &&
                (currentUser?.is_staff || currentUser?.is_superuser);
              const expanded = expandedVersionId === event.id;
              return (
                <div
                  key={event.id}
                  className="rounded-xl bg-slate-700/30 px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-slate-200">
                      {auditDescription(event)}{" "}
                      <span className="text-slate-500">
                        — {event.user_name}
                      </span>
                    </span>
                    <time className="text-xs text-slate-500">
                      {new Intl.DateTimeFormat("fa-IR", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(event.created_at))}
                    </time>
                  </div>
                  {event.is_invoice_version && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedVersionId(expanded ? null : event.id)
                        }
                        className="rounded-lg border border-slate-600 px-2.5 py-1 text-xs text-blue-300 hover:bg-slate-700"
                      >
                        {expanded
                          ? "بستن نسخهٔ پیش از ویرایش"
                          : "مشاهدهٔ نسخهٔ پیش از ویرایش"}
                      </button>
                      {canRestore && (
                        <button
                          type="button"
                          disabled={restoringVersionId === event.id}
                          onClick={() => handleRestoreVersion(event)}
                          className="rounded-lg border border-amber-500/40 px-2.5 py-1 text-xs text-amber-300 hover:bg-amber-500/10 disabled:opacity-50"
                        >
                          {restoringVersionId === event.id
                            ? "در حال بازیابی…"
                            : "بازیابی این نسخه"}
                        </button>
                      )}
                    </div>
                  )}
                  {expanded && oldInvoice && (
                    <div className="mt-3 rounded-lg border border-slate-600/70 bg-slate-900/40 p-3 text-xs text-slate-300">
                      <div className="mb-2 grid gap-1 sm:grid-cols-2">
                        <span>
                          مشتری:{" "}
                          {oldInvoice.customer_name ||
                            (oldInvoice.customer === invoice.customer
                              ? invoice.customer_name
                              : `شناسه ${oldInvoice.customer || "---"}`)}
                        </span>
                        <span>
                          تاریخ فاکتور:{" "}
                          {oldInvoice.date
                            ? persianDate(oldInvoice.date)
                            : "---"}
                        </span>
                        <span>مبلغ کل: {fmt(oldInvoice.total_amount)}</span>
                        <span>کارمزد: {fmt(oldInvoice.commission_total)}</span>
                        <span>تخفیف: {fmt(oldInvoice.discount)}</span>
                        <span>مالیات: {oldInvoice.tax || 0}٪</span>
                        <span>
                          وضعیت:{" "}
                          {STATUS_MAP[oldInvoice.status]?.label ||
                            oldInvoice.status ||
                            "---"}
                        </span>
                      </div>
                      {oldInvoice.description && (
                        <p className="mb-2 whitespace-pre-wrap">
                          توضیحات: {oldInvoice.description}
                        </p>
                      )}
                      <div className="space-y-1 border-t border-slate-700 pt-2">
                        {(oldInvoice.items || []).map((item, index) => (
                          <div
                            key={`${event.id}-${item.id || index}`}
                            className="flex flex-wrap justify-between gap-x-3 gap-y-1"
                          >
                            <span>
                              {item.title || "خدمت"} ×{" "}
                              {new Intl.NumberFormat("fa-IR").format(
                                item.quantity || 1,
                              )}
                            </span>
                            <span>
                              {fmt(
                                (Number(item.main_price) +
                                  Number(item.extra_price)) *
                                  Number(item.quantity || 1),
                              )}
                            </span>
                          </div>
                        ))}
                        {!(oldInvoice.items || []).length && (
                          <span className="text-slate-500">
                            ردیفی برای این نسخه ثبت نشده است.
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
      <InvoiceExportSheet
        invoice={invoice}
        profile={profile}
        customerInfo={customerInfo}
        subtotal={subtotal}
        taxAmount={taxAmount}
        commissionAmt={commissionAmt}
        finalAmount={finalAmount}
        finalAmountWords={finalAmountWords}
        editDateText={editDateText}
        invoiceFields={invoiceFields}
        sheetRef={exportRef}
      />
    </>
  );
};

export default InvoiceDetail;
