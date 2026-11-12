import React, { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useSelector } from "react-redux";
import { useQueryClient } from "@tanstack/react-query";
import {
  useInvoicesInfinite,
  useMarkInvoicePaid,
  useCancelInvoice,
  useDeleteInvoice,
  invoiceKeys,
} from "../hooks/useInvoices";
import {
  StatusBadge,
  Button,
  Spinner,
  EmptyState,
  ConfirmDialog,
  formatPrice,
} from "../components/ui";
import { invoicesAPI, invoiceSettingsAPI } from "../services/api";
import JalaliDatePicker from "../components/JalaliDatePicker";

type FilterUser = {
  id: number;
  name: string;
};

type FilterOptions = {
  issuers: FilterUser[];
  payers: FilterUser[];
};

type InvoiceCounts = {
  all: number;
  paid: number;
  pending: number;
  commission_paid: number;
};

type InvoiceRow = {
  id: number;
  invoice_number: string;
  customer_name?: string | null;
  vehicle_plate?: string | null;
  created_at?: string | null;
  final_amount: number;
  paid_amount?: number | null;
  remaining_amount?: number | null;
  status: string;
  card_payment_source?: string | null;
  commission_paid?: boolean;
  paid_by_name?: string | null;
  operator_name?: string | null;
  edit_request_status?: string | null;
  can_edit?: boolean;
};

type EditRequestItem = {
  id: number;
  invoice_id: number;
  invoice_number: string;
  customer_name?: string | null;
  requested_by: string;
};

const invoiceTabs = [
  { value: "pending", label: "پرداخت نشده" },
  { value: "paid", label: "پرداخت شده" },
  { value: "commission_paid", label: "کارمزد پرداخت شده" },
  { value: "", label: "کل فاکتورها" },
];
const amountInTomans = (value: string | number) => {
  const latin = String(value).replace(/[۰-۹٠-٩]/g, (digit) =>
    String(
      "۰۱۲۳۴۵۶۷۸۹".indexOf(digit) >= 0
        ? "۰۱۲۳۴۵۶۷۸۹".indexOf(digit)
        : "٠١٢٣٤٥٦٧٨٩".indexOf(digit),
    ),
  );
  const amount = Number(latin.replace(/\D/g, ""));
  return amount ? amount * 1000 : "";
};
const formatThousands = (value: string | number) => {
  const digits = String(value).replace(/[^\d۰-۹٠-٩]/g, "");
  const latin = digits.replace(/[۰-۹٠-٩]/g, (digit) => {
    const fa = "۰۱۲۳۴۵۶۷۸۹".indexOf(digit);
    return String(fa >= 0 ? fa : "٠١٢٣٤٥٦٧٨٩".indexOf(digit));
  });
  return latin.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

const Invoices = () => {
  const queryClient = useQueryClient();
  const currentUser = useSelector((s: any) => s.auth.currentUser);
  const canSeeIssuer = Boolean(
    currentUser?.is_staff || currentUser?.is_superuser,
  );
  const isManager = Boolean(currentUser?.is_staff || currentUser?.is_superuser);
  const [cloneEnabled, setCloneEnabled] = useState(true);
  useEffect(() => {
    invoiceSettingsAPI
      .get()
      .then(({ data }) => setCloneEnabled(data.enable_invoice_clone !== false))
      .catch(() => {});
  }, []);
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [paidBy, setPaidBy] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [paidMin, setPaidMin] = useState("");
  const [paidMax, setPaidMax] = useState("");
  const [paymentSource, setPaymentSource] = useState("");
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    issuers: [],
    payers: [],
  });
  const [counts, setCounts] = useState<InvoiceCounts>({
    all: 0,
    paid: 0,
    pending: 0,
    commission_paid: 0,
  });
  const sentinelRef = useRef<HTMLDivElement>(null);
  const pageRequestRef = useRef(false);
  const initialStatus = searchParams.get("status");
  const [statusFilter, setStatusFilter] = useState<string>(
    ["pending", "paid", "commission_paid"].includes(initialStatus)
      ? initialStatus
      : initialStatus === ""
        ? ""
        : "pending",
  );
  const showPaymentType = statusFilter === "paid";
  const [deleteTarget, setDeleteTarget] = useState<InvoiceRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [editRequests, setEditRequests] = useState<EditRequestItem[]>([]);
  const invoiceFilters = {
    status: statusFilter,
    search,
    customer_name: customerName,
    vehicle_plate: vehiclePlate,
    date_from: dateFrom,
    date_to: dateTo,
    paid_by: paidBy,
    created_by: createdBy,
    amount_min: amountInTomans(paidMin),
    amount_max: amountInTomans(paidMax),
    payment_source: paymentSource,
  };
  const {
    list: rawList,
    loading,
    loadingMore,
    hasMore,
    fetchNextPage,
  } = useInvoicesInfinite(invoiceFilters);
  const list = rawList as InvoiceRow[];
  const hasWaitingEditApproval =
    !isManager &&
    list.some(
      (invoice) =>
        invoice.status === "paid" && invoice.edit_request_status === "pending",
    );
  const markInvoicePaid = useMarkInvoicePaid();
  const cancelInvoice = useCancelInvoice();
  const deleteInvoice = useDeleteInvoice();

  useEffect(() => {
    pageRequestRef.current = false;
    const refreshStats = () => {
      invoicesAPI
        .stats()
        .then(({ data }) => setCounts(data))
        .catch(() => {});
    };
    refreshStats();
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      refreshStats();
    };
    window.addEventListener("mohaseb:data-changed", refresh);
    return () => window.removeEventListener("mohaseb:data-changed", refresh);
  }, [
    queryClient,
    statusFilter,
    search,
    customerName,
    vehiclePlate,
    dateFrom,
    dateTo,
    paidBy,
    createdBy,
    paidMin,
    paidMax,
    paymentSource,
  ]);

  useEffect(() => {
    invoicesAPI
      .filterOptions()
      .then(({ data }) => setFilterOptions(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || loading || loadingMore) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          !entries.some((entry) => entry.isIntersecting) ||
          pageRequestRef.current
        )
          return;
        pageRequestRef.current = true;
        fetchNextPage().finally(() => {
          pageRequestRef.current = false;
        });
      },
      { rootMargin: "300px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, fetchNextPage]);

  const refreshEditRequests = async () => {
    if (!isManager) return;
    try {
      const { data } = await invoicesAPI.editRequests();
      setEditRequests(data);
    } catch {
      setEditRequests([]);
    }
  };

  useEffect(() => {
    if (!isManager) return undefined;
    refreshEditRequests();
    window.addEventListener("mohaseb:data-changed", refreshEditRequests);
    return () =>
      window.removeEventListener("mohaseb:data-changed", refreshEditRequests);
  }, [isManager]);

  const requestEdit = async (id: number) => {
    setActionLoading(`${id}_request`);
    try {
      await invoicesAPI.requestEdit(id);
      await queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
    } finally {
      setActionLoading(null);
    }
  };

  const reviewEditRequest = async (item: EditRequestItem, decision: string) => {
    setActionLoading(`${item.id}_${decision}`);
    try {
      await invoicesAPI.reviewEditRequest(item.invoice_id, item.id, decision);
      await refreshEditRequests();
      await queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
    } finally {
      setActionLoading(null);
    }
  };

  const selectTab = (status: string) => {
    setStatusFilter(status);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("status", status);
    setSearchParams(nextParams);
  };

  const handleMarkPaid = async (id: number) => {
    setActionLoading(id + "_paid");
    await markInvoicePaid.mutateAsync(id).catch(() => {});
    setActionLoading(null);
  };

  const handleCancel = async (id: number) => {
    setActionLoading(id + "_cancel");
    await cancelInvoice.mutateAsync(id).catch(() => {});
    setActionLoading(null);
  };

  const handleDelete = async () => {
    setDeleting(true);
    await deleteInvoice.mutateAsync(deleteTarget.id).catch(() => {});
    setDeleteTarget(null);
    setDeleting(false);
  };

  const persianDate = (dateStr?: string | null): string => {
    if (!dateStr) return "---";
    try {
      return new Intl.DateTimeFormat("fa-IR", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(new Date(dateStr));
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">🧾 فاکتورها</h2>
          <p className="text-slate-400 text-sm mt-1">
            مدیریت و پیگیری فاکتورها
          </p>
        </div>
        <Link to="/invoices/new">
          <Button variant="primary">+ فاکتور جدید</Button>
        </Link>
      </div>

      {isManager && editRequests.length > 0 && (
        <section className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-amber-700 font-semibold">
              درخواست‌های ویرایش فاکتور پرداخت‌شده
            </h3>
            <span className="rounded-full bg-amber-500/20 px-2.5 py-1 text-xs text-amber-700">
              {editRequests.length} درخواست
            </span>
          </div>
          {editRequests.map((item) => (
            <div
              key={item.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-white/60 p-3"
            >
              <div className="text-sm text-slate-700">
                <Link
                  to={`/invoices/${item.invoice_id}`}
                  className="font-semibold text-blue-600 hover:underline whitespace-nowrap"
                >
                  {item.invoice_number}
                </Link>
                <span className="mx-2">·</span>
                {item.customer_name || "بدون نام مشتری"}
                <span className="mx-2">·</span>درخواست‌کننده:{" "}
                {item.requested_by}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => reviewEditRequest(item, "approve")}
                  disabled={!!actionLoading}
                  className="rounded-lg bg-green-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                >
                  تأیید یک‌بار ویرایش
                </button>
                <button
                  onClick={() => reviewEditRequest(item, "reject")}
                  disabled={!!actionLoading}
                  className="rounded-lg border border-red-300 px-3 py-2 text-xs text-red-700 disabled:opacity-50"
                >
                  رد درخواست
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Filters */}
      <section className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-200">
            جستجو و فیلتر فاکتورها
          </h3>
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setCustomerName("");
              setVehiclePlate("");
              setDateFrom("");
              setDateTo("");
              setPaidBy("");
              setCreatedBy("");
              setPaidMin("");
              setPaidMax("");
              setPaymentSource("");
            }}
            disabled={
              !search &&
              !customerName &&
              !vehiclePlate &&
              !dateFrom &&
              !dateTo &&
              !paidBy &&
              !createdBy &&
              !paidMin &&
              !paidMax &&
              !paymentSource
            }
            className="text-xs text-blue-300 hover:text-blue-200 disabled:text-slate-600 disabled:cursor-not-allowed"
          >
            پاک کردن فیلترها
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <label className="space-y-1.5">
            <span className="text-xs text-slate-400">
              نام مشتری یا صاحب برگ سبز
            </span>
            <input
              type="search"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="نام مشتری یا صاحب برگ سبز"
              className="w-full rounded-xl border border-slate-700/70 bg-slate-800/70 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs text-slate-400">شماره پلاک</span>
            <input
              type="search"
              value={vehiclePlate}
              onChange={(e) => setVehiclePlate(e.target.value)}
              placeholder="شماره پلاک را وارد کنید"
              className="w-full rounded-xl border border-slate-700/70 bg-slate-800/70 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs text-slate-400">شماره فاکتور یا VIN</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="شماره فاکتور یا VIN"
              className="w-full rounded-xl border border-slate-700/70 bg-slate-800/70 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
          </label>
          <div>
            <span className="mb-1.5 block text-xs text-slate-400">
              از تاریخ صدور
            </span>
            <JalaliDatePicker
              value={dateFrom}
              onChange={setDateFrom}
              placeholder="انتخاب تاریخ شروع"
              className="w-full"
            />
          </div>
          <div>
            <span className="mb-1.5 block text-xs text-slate-400">
              تا تاریخ صدور
            </span>
            <JalaliDatePicker
              value={dateTo}
              onChange={setDateTo}
              placeholder="انتخاب تاریخ پایان"
              className="w-full"
            />
          </div>
        </div>
        <div>
          <button
            type="button"
            onClick={() => setAdvancedOpen((value) => !value)}
            aria-expanded={advancedOpen}
            className="text-xs text-blue-300 hover:text-blue-200"
          >
            {advancedOpen ? "− بستن جستجوی پیشرفته" : "+ جستجوی پیشرفته"}
          </button>
          {advancedOpen && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 mt-3 rounded-xl border border-slate-700/50 bg-slate-900/30 p-3">
              <label className="space-y-1.5">
                <span className="text-xs text-slate-400">پرداخت‌کننده</span>
                <select
                  value={paidBy}
                  onChange={(e) => setPaidBy(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white"
                >
                  <option value="">همه پرداخت‌کنندگان</option>
                  {filterOptions.payers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </label>
              {canSeeIssuer && (
                <label className="space-y-1.5">
                  <span className="text-xs text-slate-400">صادرکننده</span>
                  <select
                    value={createdBy}
                    onChange={(e) => setCreatedBy(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white"
                  >
                    <option value="">همه صادرکنندگان</option>
                    {filterOptions.issuers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="space-y-1.5">
                <span className="text-xs text-slate-400">
                  حداقل مبلغ کل (هزار تومان)
                </span>
                <input
                  inputMode="numeric"
                  value={paidMin}
                  onChange={(e) => setPaidMin(formatThousands(e.target.value))}
                  placeholder="مثلاً 100"
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs text-slate-400">
                  حداکثر مبلغ کل (هزار تومان)
                </span>
                <input
                  inputMode="numeric"
                  value={paidMax}
                  onChange={(e) => setPaidMax(formatThousands(e.target.value))}
                  placeholder="مثلاً 500"
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs text-slate-400">نوع پرداخت</span>
                <select
                  value={paymentSource}
                  onChange={(e) => setPaymentSource(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white"
                >
                  <option value="">همه</option>
                  <option value="customer">کارت مشتری</option>
                  <option value="office">کارت دفتر</option>
                </select>
              </label>
            </div>
          )}
        </div>
        <div
          className="flex flex-wrap gap-2"
          role="tablist"
          aria-label="فیلتر وضعیت فاکتورها"
        >
          {invoiceTabs.map((tab) => (
            <button
              key={tab.value || "all"}
              type="button"
              role="tab"
              aria-selected={statusFilter === tab.value}
              onClick={() => selectTab(tab.value)}
              className={`px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${statusFilter === tab.value ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20" : "bg-slate-800/50 border-slate-700/50 text-slate-300 hover:bg-slate-700/60"}`}
            >
              {tab.value === "pending"
                ? `${tab.label} (${counts.pending})`
                : tab.value === "paid"
                  ? `${tab.label} (${counts.paid})`
                  : tab.value === "commission_paid"
                    ? `${tab.label} (${counts.commission_paid})`
                    : `${tab.label} (${counts.all})`}
            </button>
          ))}
        </div>
      </section>

      {/* Invoice Table */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
        {loading && list.length === 0 ? (
          <Spinner />
        ) : list.length === 0 ? (
          <EmptyState
            icon="🧾"
            title="فاکتوری یافت نشد"
            description="با کلیک روی فاکتور جدید، اولین فاکتور خود را صادر کنید"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-700/30 text-slate-400">
                  <th className="text-right py-3.5 px-4 font-medium">شماره</th>
                  <th className="text-right py-3.5 px-4 font-medium">مشتری</th>
                  <th className="text-right py-3.5 px-4 font-medium">
                    زمان ایجاد
                  </th>
                  <th className="text-right py-3.5 px-4 font-medium">
                    مجموع مبلغ فاکتور
                  </th>
                  <th className="text-right py-3.5 px-4 font-medium">
                    مجموع مبلغ پرداختی
                  </th>
                  {showPaymentType && (
                    <th className="text-right py-3.5 px-4 font-medium">
                      نوع پرداخت
                    </th>
                  )}
                  <th className="text-right py-3.5 px-4 font-medium">وضعیت</th>
                  <th className="text-right py-3.5 px-4 font-medium">
                    پرداخت‌کننده
                  </th>
                  {canSeeIssuer && (
                    <th className="text-right py-3.5 px-4 font-medium">
                      صادرکننده
                    </th>
                  )}
                  <th className="py-3.5 px-4 font-medium text-right">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {list.map((inv) => (
                  <tr
                    key={inv.id}
                    className="hover:bg-slate-700/20 transition-colors"
                  >
                    <td className="py-3.5 px-4">
                      <span className="text-blue-400 font-mono text-xs bg-blue-500/10 px-2 py-1 rounded-lg whitespace-nowrap">
                        {inv.invoice_number}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="text-slate-200">
                        {inv.customer_name || "---"}
                      </span>
                      {inv.vehicle_plate && (
                        <span className="block text-slate-500 text-xs font-mono mt-0.5">
                          🚗 {inv.vehicle_plate}
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-slate-400 text-xs">
                      {persianDate(inv.created_at)}
                      <span className="block text-slate-500 mt-1">
                        {inv.created_at
                          ? new Intl.DateTimeFormat("fa-IR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            }).format(new Date(inv.created_at))
                          : ""}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-300">
                      {formatPrice(inv.final_amount)}
                      {Number(
                        inv.paid_amount ??
                          (inv.status === "paid" ? inv.final_amount : 0),
                      ) > 0 &&
                        Number(inv.remaining_amount ?? 0) > 0 && (
                          <span className="block text-amber-400 text-xs mt-1">
                            مانده:{" "}
                            {formatPrice(Number(inv.remaining_amount ?? 0))}
                          </span>
                        )}
                    </td>
                    <td className="py-3.5 px-4 text-white font-semibold">
                      {formatPrice(
                        inv.paid_amount ??
                          (inv.status === "paid" ? inv.final_amount : 0),
                      )}
                    </td>
                    {showPaymentType && (
                      <td className="py-3.5 px-4 text-slate-300">
                        {inv.status === "paid"
                          ? inv.card_payment_source === "office"
                            ? "کارت دفتر"
                            : "کارت مشتری"
                          : "—"}
                      </td>
                    )}
                    <td className="py-3.5 px-4">
                      <StatusBadge
                        status={
                          inv.commission_paid && inv.status !== "paid"
                            ? "commission_paid"
                            : inv.status
                        }
                      />
                    </td>
                    <td className="py-3.5 px-4 text-slate-300">
                      {inv.paid_by_name || "—"}
                    </td>
                    {canSeeIssuer && (
                      <td className="py-3.5 px-4 text-slate-300">
                        {inv.operator_name || "—"}
                      </td>
                    )}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Link
                          to={`/invoices/${inv.id}`}
                          className="text-xs px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 transition-all"
                        >
                          👁️ جزئیات
                        </Link>
                        {inv.status === "paid" &&
                          !isManager &&
                          (inv.edit_request_status === "approved" ? (
                            <span className="text-xs px-2.5 py-1 rounded-lg bg-green-500/10 text-green-300 border border-green-500/20">
                              درخواست ویرایش تأیید شد
                            </span>
                          ) : inv.edit_request_status === "pending" ? (
                            <button
                              disabled
                              className="text-xs px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-700 border border-amber-500/20 cursor-wait"
                            >
                              درخواست ویرایش · در انتظار تأیید
                            </button>
                          ) : (
                            <button
                              onClick={() => requestEdit(inv.id)}
                              disabled={!!actionLoading}
                              className="text-xs px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 border border-amber-500/20 disabled:opacity-50"
                            >
                              {actionLoading === `${inv.id}_request`
                                ? "در حال ارسال..."
                                : "درخواست ویرایش"}
                            </button>
                          ))}
                        {inv.can_edit && (
                          <Link
                            to={`/invoices/${inv.id}/edit`}
                            className="text-xs px-2.5 py-1 rounded-lg bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 border border-indigo-500/20 transition-all"
                          >
                            ✏️ ویرایش
                          </Link>
                        )}
                        {cloneEnabled && (
                          <Link
                            to={`/invoices/new?clone=${inv.id}`}
                            className="text-xs px-2.5 py-1 rounded-lg bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 border border-teal-500/20 transition-all"
                            title="صدور فاکتور جدید با همین مشخصات و ردیف‌ها"
                          >
                            📋 صدور مشابه
                          </Link>
                        )}
                        {inv.status === "pending" && (
                          <button
                            onClick={() => handleMarkPaid(inv.id)}
                            disabled={actionLoading === inv.id + "_paid"}
                            className="text-xs px-2.5 py-1 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 border border-green-500/20 transition-all disabled:opacity-50"
                          >
                            {actionLoading === inv.id + "_paid"
                              ? "..."
                              : "✅ پرداخت"}
                          </button>
                        )}
                        {(inv.status === "pending" ||
                          inv.status === "draft") && (
                          <button
                            onClick={() => handleCancel(inv.id)}
                            disabled={actionLoading === inv.id + "_cancel"}
                            className="text-xs px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-all disabled:opacity-50"
                          >
                            {actionLoading === inv.id + "_cancel"
                              ? "..."
                              : "❌ لغو"}
                          </button>
                        )}
                        {(inv.status !== "paid" || isManager) && (
                          <button
                            onClick={() => setDeleteTarget(inv)}
                            className="text-xs px-2.5 py-1 rounded-lg bg-slate-500/10 text-slate-400 hover:bg-slate-500/20 border border-slate-500/20 transition-all"
                            aria-label={`حذف فاکتور ${inv.invoice_number}`}
                            title="حذف فاکتور"
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div ref={sentinelRef} className="min-h-3" />
        {(loadingMore || hasMore) && (
          <div className="py-4 text-center text-xs text-slate-400">
            {loadingMore
              ? "در حال بارگذاری فاکتورهای بعدی…"
              : "برای مشاهده موارد بعدی اسکرول کنید"}
          </div>
        )}
        {!hasMore && list.length > 0 && (
          <div className="py-3 text-center text-xs text-slate-500">
            همه {list.length.toLocaleString("fa-IR")} فاکتور بارگذاری شد
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="حذف فاکتور"
        message={`آیا از حذف فاکتور "${deleteTarget?.invoice_number}" اطمینان دارید؟`}
        loading={deleting}
      />
    </div>
  );
};

export default Invoices;
