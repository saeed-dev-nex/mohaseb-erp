import React, { useEffect, useState, useRef } from "react";
import { Spinner } from "../components/ui";
import {
  useParams,
  useNavigate,
  Link,
  useSearchParams,
} from "react-router-dom";
import {
  customersAPI,
  documentsAPI,
  downloadDocumentFile,
  auditAPI,
} from "../services/api";

const fmt = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("fa-IR").format(Number(n) || 0) + " تومان";
const persianDate = (d: string | null | undefined): string => {
  if (!d) return "---";
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(d));
  } catch {
    return d;
  }
};

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft: {
    label: "پیش‌نویس",
    color: "text-slate-300 bg-slate-500/20 border-slate-500/30",
  },
  pending: {
    label: "پرداخت نشده",
    color: "text-yellow-300 bg-yellow-500/20 border-yellow-500/30",
  },
  paid: {
    label: "پرداخت شده",
    color: "text-green-300 bg-green-500/20 border-green-500/30",
  },
  cancelled: {
    label: "لغو شده",
    color: "text-red-300 bg-red-500/20 border-red-500/30",
  },
};

const inp =
  "w-full px-3 py-2.5 bg-slate-700/50 border border-slate-600/50 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all";

type CustomerData = {
  id?: number;
  name: string;
  phone?: string | null;
  email?: string | null;
  national_id?: string | null;
  address?: string | null;
  notes?: string | null;
};

type CustomerInvoice = {
  id: number;
  invoice_number: string;
  date: string;
  vehicle_plate?: string | null;
  total_amount: number;
  paid_amount?: number | null;
  remaining_amount?: number | null;
  status: string;
};

type CustomerDoc = {
  id: number;
  title: string;
  description?: string | null;
  file_url?: string | null;
  file?: string | null;
  file_name?: string;
  uploaded_at: string;
  tags?: string[];
};

type AuditEvent = {
  id: number;
  action_display: string;
  user_name: string;
  created_at: string;
};

type DocEditForm = {
  title: string;
  description: string;
  tags: string[];
};

// ── Document Viewer Modal ──────────────────────────────────────
type DocViewerProps = {
  doc: CustomerDoc;
  onClose: () => void;
};

const DocViewer = ({ doc, onClose }: DocViewerProps) => {
  const [url, setUrl] = useState("");
  const [mimeType, setMimeType] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    let objectUrl = "";
    setUrl("");
    setMimeType("");
    setError("");
    documentsAPI
      .download(doc.id)
      .then(({ data }) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(data);
        setMimeType(data.type);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!disposed)
          setError("دریافت فایل ممکن نشد. دسترسی خود را بررسی کنید.");
      });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [doc.id]);
  const isImage = /^image\/(jpeg|png|webp|gif|bmp|tiff)$/.test(mimeType);
  const isPdf = mimeType === "application/pdf";

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex flex-col"
      onClick={onClose}
    >
      <div
        className="flex items-center justify-between px-4 py-3 bg-slate-900/90 border-b border-slate-700/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <p className="text-white font-medium text-sm">{doc.title}</p>
          <p className="text-slate-500 text-xs">
            {persianDate(doc.uploaded_at)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              download={
                !isImage && !isPdf ? doc.file_name || doc.title : undefined
              }
              className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-all"
            >
              {isImage || isPdf ? "باز کردن در تب جدید ↗" : "دانلود فایل"}
            </a>
          )}
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-700 text-white hover:bg-slate-600 transition-all text-lg leading-none"
          >
            ×
          </button>
        </div>
      </div>
      <div
        className="flex-1 overflow-auto flex items-center justify-center p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {!url && (
          <p className="text-slate-400">{error || "در حال دریافت فایل…"}</p>
        )}
        {url && isImage && (
          <img
            src={url}
            alt={doc.title}
            className="max-w-full max-h-full object-contain rounded-xl shadow-2xl"
          />
        )}
        {url && isPdf && (
          <iframe
            src={url}
            title={doc.title}
            className="w-full h-full rounded-xl border border-slate-700"
            style={{ minHeight: "80vh" }}
          />
        )}
        {url && !isImage && !isPdf && (
          <div className="text-center space-y-4">
            <div className="text-6xl">📄</div>
            <p className="text-slate-400">
              نمایش مستقیم این نوع فایل پشتیبانی نمی‌شود
            </p>
            <a
              href={url}
              download={doc.file_name || doc.title}
              className="inline-block px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all"
            >
              دانلود فایل
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Tag Input ─────────────────────────────────────────────────
type TagInputProps = {
  tags?: string[];
  onChange: (tags: string[]) => void;
};

const TagInput = ({ tags = [], onChange }: TagInputProps) => {
  const [input, setInput] = useState("");
  const addTag = (tag: string) => {
    const t = tag.trim();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setInput("");
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span
            key={t}
            className="flex items-center gap-1 px-2.5 py-1 bg-blue-500/15 border border-blue-500/30 text-blue-400 text-xs rounded-full"
          >
            {t}
            <button
              onClick={() => onChange(tags.filter((x) => x !== t))}
              className="text-blue-300 hover:text-red-400 transition-colors leading-none"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className={inp}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addTag(input);
            }
          }}
          placeholder="تگ جدید + Enter"
        />
        <button
          onClick={() => addTag(input)}
          className="px-3 py-2 bg-blue-600/80 text-white rounded-xl text-xs hover:bg-blue-700 transition-all shrink-0"
        >
          +
        </button>
      </div>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────
const CustomerDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [customer, setCustomer] = useState<CustomerData | null>(null);
  const [invoices, setInvoices] = useState<CustomerInvoice[]>([]);
  const [docs, setDocs] = useState<CustomerDoc[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(() =>
    searchParams.get("tab") === "edit" ? "edit" : "invoices",
  );

  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [docTitle, setDocTitle] = useState("");
  const [docDesc, setDocDesc] = useState("");
  const [docTags, setDocTags] = useState<string[]>([]);

  const [viewingDoc, setViewingDoc] = useState<CustomerDoc | null>(null);
  const [editingDoc, setEditingDoc] = useState<number | null>(null);
  const [editDocForm, setEditDocForm] = useState<DocEditForm>({
    title: "",
    description: "",
    tags: [],
  });
  const [savingDoc, setSavingDoc] = useState(false);

  useEffect(() => {
    Promise.all([
      customersAPI.detail(id),
      customersAPI.invoices(id),
      documentsAPI.list({ customer: id }),
    ])
      .then(([cRes, iRes, dRes]) => {
        setCustomer(cRes.data);
        setEditForm({
          name: cRes.data.name || "",
          phone: cRes.data.phone || "",
          email: cRes.data.email || "",
          national_id: cRes.data.national_id || "",
          address: cRes.data.address || "",
          notes: cRes.data.notes || "",
        });
        setInvoices(iRes.data);
        setDocs(dRes.data);
      })
      .catch(() => navigate("/customers"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    const refresh = () =>
      Promise.all([
        customersAPI.detail(id),
        customersAPI.invoices(id),
        documentsAPI.list({ customer: id }),
        auditAPI.list({ object_type: "customer", object_id: id }),
      ])
        .then(([cRes, iRes, dRes, aRes]) => {
          setCustomer(cRes.data);
          setInvoices(iRes.data);
          setDocs(dRes.data);
          setAuditEvents(aRes.data);
        })
        .catch(() => {});
    window.addEventListener("mohaseb:data-changed", refresh);
    return () => window.removeEventListener("mohaseb:data-changed", refresh);
  }, [id]);

  useEffect(() => {
    auditAPI
      .list({ object_type: "customer", object_id: id })
      .then(({ data }) => setAuditEvents(data))
      .catch(() => setAuditEvents([]));
  }, [id]);

  const handleSaveEdit = async () => {
    setSaving(true);
    try {
      const res = await customersAPI.update(id, editForm);
      setCustomer(res.data);
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleUploadDoc = async (file: File | null | undefined) => {
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("customer", id);
    fd.append("title", docTitle || file.name);
    fd.append("file", file);
    if (docDesc) fd.append("description", docDesc);
    if (docTags.length) fd.append("tags", JSON.stringify(docTags));
    try {
      const res = await documentsAPI.create(fd);
      setDocs((d) => [res.data, ...d]);
      setDocTitle("");
      setDocDesc("");
      setDocTags([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDoc = async (docId: number) => {
    if (!window.confirm("آیا از حذف این سند اطمینان دارید؟")) return;
    await documentsAPI.delete(docId);
    setDocs((d) => d.filter((doc) => doc.id !== docId));
  };

  const startEditDoc = (doc: CustomerDoc) => {
    setEditingDoc(doc.id);
    setEditDocForm({
      title: doc.title || "",
      description: doc.description || "",
      tags: Array.isArray(doc.tags) ? [...doc.tags] : [],
    });
  };

  const handleSaveDoc = async (docId: number) => {
    setSavingDoc(true);
    try {
      const fd = new FormData();
      fd.append("title", editDocForm.title);
      fd.append("description", editDocForm.description);
      fd.append("tags", JSON.stringify(editDocForm.tags));
      const res = await documentsAPI.update(docId, fd);
      setDocs((d) => d.map((doc) => (doc.id === docId ? res.data : doc)));
      setEditingDoc(null);
    } catch (e) {
      alert("خطا در ذخیره");
    } finally {
      setSavingDoc(false);
    }
  };

  const fileIcon = (url?: string | null): string => {
    if (!url) return "📎";
    if (/\.pdf$/i.test(url)) return "📄";
    if (/\.(jpg|jpeg|png|webp|gif)$/i.test(url)) return "🖼️";
    if (/\.(doc|docx)$/i.test(url)) return "📝";
    if (/\.(xls|xlsx)$/i.test(url)) return "📊";
    return "📎";
  };

  if (loading)
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  if (!customer) return null;

  const totalPaid = invoices.reduce(
    (s, i) => s + Number(i.paid_amount || 0),
    0,
  );
  const totalPending = invoices.reduce(
    (s, i) =>
      s +
      Number(
        i.remaining_amount ?? (i.status === "pending" ? i.total_amount : 0),
      ),
    0,
  );

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {viewingDoc && (
        <DocViewer doc={viewingDoc} onClose={() => setViewingDoc(null)} />
      )}

      <Link
        to="/customers"
        className="text-slate-400 hover:text-white text-sm flex items-center gap-1 transition-colors"
      >
        ← بازگشت به مشتریان
      </Link>

      <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-2xl font-bold text-white shadow-lg shadow-blue-500/20">
              {customer.name.charAt(0)}
            </div>
            <div>
              <h2 className="text-white text-xl font-bold">{customer.name}</h2>
              <p className="text-slate-400 text-sm">{customer.phone || "—"}</p>
            </div>
          </div>
          <Link
            to={`/invoices/new?customer=${id}`}
            className="px-3 py-2 text-xs rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-all"
          >
            + فاکتور جدید
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-5 border-t border-slate-700/50">
          {[
            {
              label: "تعداد فاکتور",
              value: new Intl.NumberFormat("fa-IR").format(invoices.length),
              cls: "text-white",
            },
            {
              label: "پرداخت شده",
              value: fmt(totalPaid),
              cls: "text-green-400",
            },
            { label: "معوق", value: fmt(totalPending), cls: "text-yellow-400" },
            {
              label: "اسناد",
              value: new Intl.NumberFormat("fa-IR").format(docs.length),
              cls: "text-blue-400",
            },
          ].map((s) => (
            <div
              key={s.label}
              className="text-center p-3 bg-slate-700/30 rounded-xl"
            >
              <p className="text-slate-500 text-xs mb-1">{s.label}</p>
              <p className={`font-semibold text-sm ${s.cls}`}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-700/50">
        {[
          { key: "invoices", label: `📋 فاکتورها (${invoices.length})` },
          { key: "docs", label: `📎 اسناد (${docs.length})` },
          { key: "history", label: `🕘 تاریخچه (${auditEvents.length})` },
          { key: "edit", label: "✏️ ویرایش" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${tab === t.key ? "border-blue-500 text-blue-400" : "border-transparent text-slate-400 hover:text-slate-200"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Invoices Tab */}
      {tab === "invoices" && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
          {invoices.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-10">
              هنوز فاکتوری ثبت نشده است
            </p>
          ) : (
            <div className="divide-y divide-slate-700/30">
              {invoices.map((inv) => {
                const st = STATUS_MAP[inv.status] || STATUS_MAP.draft;
                return (
                  <Link
                    key={inv.id}
                    to={`/invoices/${inv.id}`}
                    className="flex items-center justify-between px-5 py-4 hover:bg-slate-700/30 transition-all group"
                  >
                    <div className="flex items-center gap-4">
                      <span className="font-mono text-xs text-blue-400 bg-blue-500/10 px-2 py-1 rounded-lg">
                        {inv.invoice_number}
                      </span>
                      <span className="text-slate-400 text-xs">
                        {persianDate(inv.date)}
                      </span>
                      {inv.vehicle_plate && (
                        <span className="text-xs text-slate-500 font-mono">
                          🚗 {inv.vehicle_plate}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-white font-medium text-sm">
                        {fmt(inv.total_amount)}
                      </span>
                      {Number(inv.paid_amount ?? 0) > 0 &&
                        Number(inv.remaining_amount ?? 0) > 0 && (
                          <span className="text-amber-400 text-xs">
                            مانده: {fmt(inv.remaining_amount)}
                          </span>
                        )}
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full border ${st.color}`}
                      >
                        {st.label}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl divide-y divide-slate-700/40">
          {auditEvents.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">
              هنوز تغییری برای این مشتری ثبت نشده است.
            </p>
          ) : (
            auditEvents.map((event) => (
              <div
                key={event.id}
                className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm"
              >
                <div>
                  <span className="font-medium text-slate-200">
                    {event.action_display}
                  </span>
                  <span className="mx-2 text-slate-500">·</span>
                  <span className="text-slate-400">{event.user_name}</span>
                </div>
                <time className="text-xs text-slate-500">
                  {new Intl.DateTimeFormat("fa-IR", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(event.created_at))}
                </time>
              </div>
            ))
          )}
        </div>
      )}

      {/* Documents Tab */}
      {tab === "docs" && (
        <div className="space-y-4">
          {/* Upload Box */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 space-y-4">
            <h4 className="text-white font-medium">📎 آپلود سند جدید</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">عنوان سند</label>
                <input
                  className={inp}
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder="عنوان سند (اختیاری)"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">توضیحات</label>
                <input
                  className={inp}
                  value={docDesc}
                  onChange={(e) => setDocDesc(e.target.value)}
                  placeholder="توضیح کوتاه (اختیاری)"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">🏷️ تگ‌ها</label>
              <TagInput tags={docTags} onChange={setDocTags} />
            </div>
            <label className="block cursor-pointer">
              <div
                className={`px-4 py-4 rounded-xl border-2 border-dashed text-center text-sm transition-all ${uploading ? "border-blue-500/50 text-blue-400" : "border-slate-600 text-slate-400 hover:border-blue-500/50 hover:text-blue-400"}`}
              >
                {uploading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
                    آپلود...
                  </span>
                ) : (
                  "📎 کلیک کنید یا فایل را اینجا رها کنید"
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => handleUploadDoc(e.target.files[0])}
                disabled={uploading}
              />
            </label>
            <p className="text-slate-600 text-xs">
              فرمت‌های مجاز: PDF, JPG, PNG, DOCX, XLSX
            </p>
          </div>

          {/* Doc List */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
            {docs.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-10">
                هنوز سندی آپلود نشده است
              </p>
            ) : (
              <div className="divide-y divide-slate-700/30">
                {docs.map((doc) => {
                  const url = doc.file_name || doc.file_url || doc.file;
                  const isEditing = editingDoc === doc.id;
                  return (
                    <div key={doc.id} className="px-5 py-4">
                      {isEditing ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-xs text-slate-400">
                                عنوان
                              </label>
                              <input
                                className={inp}
                                value={editDocForm.title}
                                onChange={(e) =>
                                  setEditDocForm((f) => ({
                                    ...f,
                                    title: e.target.value,
                                  }))
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs text-slate-400">
                                توضیحات
                              </label>
                              <input
                                className={inp}
                                value={editDocForm.description}
                                onChange={(e) =>
                                  setEditDocForm((f) => ({
                                    ...f,
                                    description: e.target.value,
                                  }))
                                }
                              />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-slate-400">
                              🏷️ تگ‌ها
                            </label>
                            <TagInput
                              tags={editDocForm.tags}
                              onChange={(t) =>
                                setEditDocForm((f) => ({ ...f, tags: t }))
                              }
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleSaveDoc(doc.id)}
                              disabled={savingDoc}
                              className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs hover:bg-blue-700 transition-all flex items-center gap-1 disabled:opacity-60"
                            >
                              {savingDoc ? (
                                <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
                              ) : (
                                "💾"
                              )}{" "}
                              ذخیره
                            </button>
                            <button
                              onClick={() => setEditingDoc(null)}
                              className="px-4 py-2 rounded-xl border border-slate-600 text-slate-300 text-xs hover:bg-slate-700 transition-all"
                            >
                              انصراف
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 min-w-0">
                            <span className="text-2xl shrink-0 mt-0.5">
                              {fileIcon(url)}
                            </span>
                            <div className="min-w-0">
                              <p className="text-white text-sm font-medium">
                                {doc.title}
                              </p>
                              {doc.description && (
                                <p className="text-slate-500 text-xs mt-0.5">
                                  {doc.description}
                                </p>
                              )}
                              <p className="text-slate-600 text-xs mt-1">
                                {persianDate(doc.uploaded_at)}
                              </p>
                              {Array.isArray(doc.tags) &&
                                doc.tags.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {doc.tags.map((tag) => (
                                      <span
                                        key={tag}
                                        className="px-2 py-0.5 bg-indigo-500/15 border border-indigo-500/25 text-indigo-400 text-[10px] rounded-full"
                                      >
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => setViewingDoc(doc)}
                              className="text-xs px-3 py-1.5 rounded-lg bg-slate-700/60 text-slate-300 hover:bg-slate-700 border border-slate-600/40 transition-all"
                            >
                              👁 مشاهده
                            </button>
                            <button
                              onClick={() => startEditDoc(doc)}
                              className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 transition-all"
                            >
                              ✏️
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                downloadDocumentFile(
                                  doc.id,
                                  doc.file_name || doc.title,
                                ).catch(() =>
                                  window.alert("دانلود فایل ممکن نشد."),
                                )
                              }
                              className="text-xs px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 transition-all"
                            >
                              ⬇️
                            </button>
                            <button
                              onClick={() => handleDeleteDoc(doc.id)}
                              className="text-xs px-2 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-all"
                            >
                              🗑
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit Tab */}
      {tab === "edit" && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-6">
          <h4 className="text-white font-semibold mb-5">
            ویرایش اطلاعات مشتری
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { key: "name", label: "نام *", ph: "نام مشتری" },
              { key: "phone", label: "تلفن", ph: "09XXXXXXXXX" },
              {
                key: "email",
                label: "ایمیل",
                ph: "email@example.com",
                type: "email",
              },
              { key: "national_id", label: "کد ملی / شناسه", ph: "کد ملی" },
            ].map(({ key, label, ph, type = "text" }) => (
              <div key={key} className="space-y-1.5">
                <label className="text-xs text-slate-400">{label}</label>
                <input
                  type={type}
                  className={inp}
                  value={editForm[key] || ""}
                  placeholder={ph}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, [key]: e.target.value }))
                  }
                />
              </div>
            ))}
            <div className="sm:col-span-2 space-y-1.5">
              <label className="text-xs text-slate-400">آدرس</label>
              <textarea
                className={`${inp} resize-none`}
                rows={2}
                value={editForm.address || ""}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, address: e.target.value }))
                }
              />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <label className="text-xs text-slate-400">یادداشت</label>
              <textarea
                className={`${inp} resize-none`}
                rows={2}
                value={editForm.notes || ""}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, notes: e.target.value }))
                }
              />
            </div>
          </div>
          <div className="flex items-center gap-3 justify-end mt-5 pt-5 border-t border-slate-700/50">
            {saveOk && (
              <span className="text-green-400 text-sm">✅ ذخیره شد!</span>
            )}
            <button
              onClick={handleSaveEdit}
              disabled={saving}
              className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-all disabled:opacity-60 flex items-center gap-2"
            >
              {saving ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                "💾"
              )}
              ذخیره تغییرات
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerDetail;
