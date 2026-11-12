import { fmt } from "./format";

export type AuditSnapshotItem = {
  id?: number;
  title?: string;
  notes?: string | null;
  quantity?: number;
  main_price: number | string;
  extra_price: number | string;
  commission?: number | string;
};

export type InvoiceSnapshot = {
  customer?: number | null;
  customer_name?: string | null;
  date?: string | null;
  status?: string;
  total_amount?: number;
  commission_total?: number;
  discount?: number;
  tax?: number;
  description?: string | null;
  items?: AuditSnapshotItem[];
  vehicle_plate?: string | null;
  vehicle_type?: string | null;
  vehicle_model?: string | null;
  vehicle_year?: string | null;
  vehicle_vin?: string | null;
  due_date?: string | null;
};

export type AuditEvent = {
  id: number;
  action: string;
  action_display: string;
  user_name: string;
  created_at: string;
  is_invoice_version?: boolean;
  changes?: {
    before?: InvoiceSnapshot;
    after?: any;
  };
};

export const auditDescription = (event: AuditEvent): string => {
  const { before, after } = (event.changes || {}) as {
    before?: Record<string, any>;
    after?: any;
  };
  if (event.action === "payment") {
    const amount = after?.payment?.amount || after?.removed_payment?.amount;
    if (after?.payment_operation === "deleted")
      return `حذف پرداخت ${amount ? fmt(amount) : ""}`.trim();
    if (after?.payment_operation === "updated")
      return `ویرایش پرداخت ${amount ? fmt(amount) : ""}`.trim();
    return amount ? `ثبت دریافت ${fmt(amount)}` : "ثبت یا تکمیل پرداخت";
  }
  if (event.action === "approval") {
    return after?.event === "edit_requested"
      ? "درخواست ویرایش فاکتور پرداخت‌شده ثبت شد"
      : after?.status === "approved"
        ? "درخواست ویرایش تأیید شد"
        : "درخواست ویرایش رد شد";
  }
  if (event.action === "create") return "فاکتور ایجاد شد";
  if (event.action === "delete") return "فاکتور حذف شد";
  if (before && after) {
    const labels: Record<string, string> = {
      status: "وضعیت",
      customer: "مشتری",
      total_amount: "مبلغ",
      discount: "تخفیف",
      tax: "مالیات",
      description: "توضیحات",
      items: "ردیف‌های خدمات",
    };
    const changed = Object.keys(labels).filter(
      (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
    );
    if (changed.length)
      return `ویرایش ${changed.map((key) => labels[key]).join("، ")}`;
  }
  return event.action_display;
};
