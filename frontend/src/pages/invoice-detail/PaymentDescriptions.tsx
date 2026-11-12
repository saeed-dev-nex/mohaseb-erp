import { fmt, persianDate } from "./format";
import type { InvoicePayment } from "./types";

type PaymentDescriptionsProps = {
  payments?: InvoicePayment[];
  exportMode?: boolean;
};

export const PaymentDescriptions = ({
  payments = [],
  exportMode = false,
}: PaymentDescriptionsProps) => {
  if (!payments.length) return null;
  if (exportMode)
    return (
      <section
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: "8px",
          padding: "12px",
          marginBottom: "12px",
          color: "#374151",
        }}
      >
        <div
          style={{
            fontSize: "10px",
            color: "#6b7280",
            marginBottom: "6px",
            fontWeight: 600,
          }}
        >
          توضیحات پرداخت
        </div>
        {payments.map((payment) => (
          <div key={payment.id} style={{ fontSize: "11px", marginTop: "4px" }}>
            دریافت {fmt(payment.amount)} از طریق{" "}
            {payment.method_display || "پرداخت"} در تاریخ{" "}
            {persianDate(payment.paid_at)}
            {payment.reference && ` · شماره پیگیری: ${payment.reference}`}
            {payment.note && ` · توضیح: ${payment.note}`}
          </div>
        ))}
      </section>
    );
  return (
    <section className="print-payment-notes border-b border-slate-700/50 px-5 py-4">
      <p className="mb-1 text-xs font-semibold text-slate-500">
        توضیحات پرداخت
      </p>
      <div className="space-y-1">
        {payments.map((payment) => (
          <p key={payment.id} className="text-sm text-slate-700">
            دریافت {fmt(payment.amount)} از طریق{" "}
            {payment.method_display || "پرداخت"} در تاریخ{" "}
            {persianDate(payment.paid_at)}
            {payment.reference && ` · شماره پیگیری: ${payment.reference}`}
            {payment.note && ` · توضیح: ${payment.note}`}
          </p>
        ))}
      </div>
    </section>
  );
};
