import type { Ref } from "react";
import { fmt, persianDate } from "./format";
import { PaymentDescriptions } from "./PaymentDescriptions";
import { STATUS_MAP } from "./status";
import type {
  BusinessProfile,
  CustomerInfo,
  InvoiceData,
  InvoiceFields,
} from "./types";

type Props = {
  invoice: InvoiceData;
  profile: BusinessProfile | null;
  customerInfo: CustomerInfo | null;
  subtotal: number;
  taxAmount: number;
  commissionAmt: number;
  finalAmount: number;
  finalAmountWords: string;
  editDateText: string;
  invoiceFields: InvoiceFields;
  sheetRef: Ref<HTMLDivElement>;
};

// Hidden off-screen clean white sheet used for PDF/JPG export.
export const InvoiceExportSheet = ({
  invoice,
  profile,
  customerInfo,
  subtotal,
  taxAmount,
  commissionAmt,
  finalAmount,
  finalAmountWords,
  editDateText,
  invoiceFields,
  sheetRef,
}: Props) => (
  <>
    {/* ── Hidden Export Area (clean white for PDF/JPG) ── */}
    <div
      ref={sheetRef}
      style={{
        position: "absolute",
        top: "-9999px",
        left: "-9999px",
        width: "794px",
        background: "#ffffff",
        color: "#111111",
        fontFamily: "Vazirmatn, sans-serif",
        direction: "rtl",
        padding: "24px",
        fontSize: "13px",
      }}
    >
      {/* Export Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          background: "#1e3a5f",
          color: "white",
          padding: "16px",
          borderRadius: "8px",
          marginBottom: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {profile?.logo_url && (
            <img
              src={profile.logo_url}
              alt="logo"
              crossOrigin="anonymous"
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "8px",
                objectFit: "cover",
              }}
            />
          )}
          <div>
            <div style={{ fontWeight: "bold", fontSize: "16px" }}>
              {profile?.name || "محاسب پرو"}
            </div>
            <div style={{ fontSize: "11px", opacity: 0.8 }}>
              {profile?.subtitle || "سیستم مدیریت مالی"}
            </div>
            {profile?.phone && (
              <div style={{ fontSize: "11px", opacity: 0.7 }}>
                📞 {profile.phone}
              </div>
            )}
            {profile?.mobile && (
              <div style={{ fontSize: "11px", opacity: 0.7 }}>
                📱 {profile.mobile}
              </div>
            )}
            {profile?.address && (
              <div style={{ fontSize: "11px", opacity: 0.7 }}>
                📍 {profile.address}
              </div>
            )}
          </div>
        </div>
        <div style={{ textAlign: "left" }}>
          <div
            style={{
              fontFamily: "monospace",
              fontSize: "18px",
              fontWeight: "bold",
              color: "#93c5fd",
            }}
          >
            {invoice?.invoice_number}
          </div>
          <div style={{ fontSize: "11px", opacity: 0.7, marginTop: "4px" }}>
            تاریخ صدور: {invoice?.date && persianDate(invoice.date)}
          </div>
          {editDateText && (
            <div style={{ fontSize: "9px", opacity: 0.65, marginTop: "2px" }}>
              ویرایش: {editDateText}
            </div>
          )}
          <div
            style={{
              display: "inline-block",
              marginTop: "4px",
              padding: "2px 8px",
              borderRadius: "12px",
              fontSize: "11px",
              background:
                invoice?.status === "paid"
                  ? "#166534"
                  : invoice?.status === "cancelled"
                    ? "#991b1b"
                    : "#713f12",
              color: "white",
            }}
          >
            {invoice?.commission_paid && invoice?.status !== "paid"
              ? "کارمزد پرداخت شده"
              : STATUS_MAP[invoice?.status]?.label || ""}
          </div>
        </div>
      </div>

      {/* Customer + Vehicle — export area */}
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: "8px",
          padding: "10px 14px",
          marginBottom: "12px",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-start",
          gap: "12px",
        }}
      >
        {/* Customer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            minWidth: "160px",
          }}
        >
          <div
            style={{
              width: "34px",
              height: "34px",
              borderRadius: "8px",
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "16px",
              flexShrink: 0,
            }}
          >
            👤
          </div>
          <div>
            <div
              style={{
                fontSize: "9px",
                color: "#6b7280",
                marginBottom: "2px",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              مشتری
            </div>
            <div
              style={{
                fontWeight: "700",
                fontSize: "13px",
                color: "#111827",
              }}
            >
              {invoice?.customer_name || "---"}
            </div>
            {customerInfo?.phone && (
              <div
                style={{
                  fontSize: "10px",
                  color: "#6b7280",
                  marginTop: "1px",
                  direction: "ltr",
                  textAlign: "right",
                }}
              >
                📞 {customerInfo.phone}
              </div>
            )}
          </div>
        </div>
        {/* Vehicle chips */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", flex: 1 }}>
          {invoice?.vehicle_plate && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                background: "#f3f4f6",
                border: "1px solid #e5e7eb",
                borderRadius: "6px",
                padding: "4px 8px",
                fontSize: "11px",
              }}
            >
              <span style={{ color: "#6b7280", fontSize: "9px" }}>پلاک</span>
              <span style={{ fontFamily: "monospace" }}>
                {invoice.vehicle_plate}
              </span>
            </div>
          )}
          {invoice?.vehicle_type && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                background: "#f3f4f6",
                border: "1px solid #e5e7eb",
                borderRadius: "6px",
                padding: "4px 8px",
                fontSize: "11px",
              }}
            >
              <span style={{ color: "#6b7280", fontSize: "9px" }}>نوع</span>
              {invoice.vehicle_type}
            </div>
          )}
          {invoice?.vehicle_model && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                background: "#f3f4f6",
                border: "1px solid #e5e7eb",
                borderRadius: "6px",
                padding: "4px 8px",
                fontSize: "11px",
              }}
            >
              <span style={{ color: "#6b7280", fontSize: "9px" }}>مدل</span>
              {invoice.vehicle_model}
            </div>
          )}
          {invoice?.vehicle_year && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: "6px",
                padding: "4px 8px",
                fontSize: "11px",
              }}
            >
              <span style={{ color: "#6b7280", fontSize: "9px" }}>سال</span>
              <span style={{ color: "#15803d", fontWeight: "600" }}>
                {invoice.vehicle_year}
              </span>
            </div>
          )}
          {invoice?.vehicle_vin && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                background: "#f3f4f6",
                border: "1px solid #e5e7eb",
                borderRadius: "6px",
                padding: "4px 8px",
                fontSize: "10px",
              }}
            >
              <span style={{ color: "#6b7280", fontSize: "9px" }}>VIN</span>
              <span style={{ fontFamily: "monospace" }}>
                {invoice.vehicle_vin}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Items Table */}
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          marginBottom: "12px",
          fontSize: "12px",
        }}
      >
        <thead>
          <tr
            style={{
              background: "#f3f4f6",
              borderBottom: "2px solid #e5e7eb",
            }}
          >
            <th
              style={{
                padding: "8px",
                textAlign: "right",
                fontWeight: "600",
                color: "#374151",
              }}
            >
              #
            </th>
            <th
              style={{
                padding: "8px",
                textAlign: "right",
                fontWeight: "600",
                color: "#374151",
              }}
            >
              خدمت
            </th>
            <th
              style={{
                padding: "8px",
                textAlign: "right",
                fontWeight: "600",
                color: "#374151",
              }}
            >
              تعداد
            </th>
            <th
              style={{
                padding: "8px",
                textAlign: "right",
                fontWeight: "600",
                color: "#374151",
              }}
            >
              مبلغ پرداختی
            </th>
            <th
              style={{
                padding: "8px",
                textAlign: "right",
                fontWeight: "600",
                color: "#374151",
              }}
            >
              مبلغ استعلامی
            </th>
            <th
              style={{
                padding: "8px",
                textAlign: "right",
                fontWeight: "600",
                color: "#374151",
              }}
            >
              جمع ردیف
            </th>
          </tr>
        </thead>
        <tbody>
          {invoice?.items?.map((item, i) => (
            <tr
              key={item.id || i}
              style={{ borderBottom: "1px solid #e5e7eb" }}
            >
              <td
                style={{ padding: "8px", color: "#6b7280", fontSize: "11px" }}
              >
                {i + 1}
              </td>
              <td style={{ padding: "8px", fontWeight: "500" }}>
                {item.service_title_snapshot || item.service_title || "---"}
                {item.notes && (
                  <div
                    style={{
                      color: "#6b7280",
                      fontSize: "10px",
                      marginTop: "2px",
                    }}
                  >
                    {item.notes}
                  </div>
                )}
              </td>
              <td style={{ padding: "8px" }}>{item.quantity}</td>
              <td style={{ padding: "8px" }}>{fmt(item.main_price)}</td>
              <td style={{ padding: "8px", color: "#6b7280" }}>
                {Number(item.extra_price) > 0 ? fmt(item.extra_price) : "—"}
              </td>
              <td style={{ padding: "8px", fontWeight: "600" }}>
                {fmt(item.line_total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Description */}
      {invoice?.description && (
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            padding: "12px",
            marginBottom: "12px",
          }}
        >
          <div
            style={{
              fontSize: "10px",
              color: "#6b7280",
              marginBottom: "4px",
            }}
          >
            توضیحات
          </div>
          <div style={{ fontSize: "12px" }}>{invoice.description}</div>
        </div>
      )}

      <PaymentDescriptions payments={invoice?.payments || []} exportMode />

      {/* Totals */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div
          style={{
            minWidth: "280px",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            padding: "12px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "6px",
              fontSize: "12px",
            }}
          >
            <span style={{ color: "#6b7280" }}>جمع خدمات</span>
            <span>{fmt(subtotal)}</span>
          </div>
          {commissionAmt > 0 && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "6px",
                fontSize: "12px",
              }}
            >
              <span style={{ color: "#92400e" }}>💼 کارمزد</span>
              <span style={{ color: "#92400e" }}>+{fmt(commissionAmt)}</span>
            </div>
          )}
          {invoiceFields.show_tax_field && taxAmount > 0 && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "6px",
                fontSize: "12px",
              }}
            >
              <span style={{ color: "#6b7280" }}>مالیات ({invoice?.tax}%)</span>
              <span style={{ color: "#92400e" }}>+{fmt(taxAmount)}</span>
            </div>
          )}
          {invoiceFields.show_discount_field &&
            Number(invoice?.discount) > 0 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "6px",
                  fontSize: "12px",
                }}
              >
                <span style={{ color: "#6b7280" }}>تخفیف</span>
                <span style={{ color: "#047857" }}>
                  −{fmt(Number(invoice?.discount))}
                </span>
              </div>
            )}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              borderTop: "2px solid #e5e7eb",
              paddingTop: "8px",
              fontWeight: "bold",
              fontSize: "14px",
            }}
          >
            <span>جمع قابل پرداخت</span>
            <span style={{ color: "#1d4ed8" }}>{fmt(finalAmount)}</span>
          </div>
          <div
            style={{
              marginTop: "8px",
              padding: "8px",
              background: "#f9fafb",
              borderRadius: "6px",
              fontSize: "11px",
              color: "#4b5563",
            }}
          >
            به حروف: {finalAmountWords}
          </div>
        </div>
      </div>

      {/* Seller seal and buyer signature */}
      {(invoiceFields.show_seller_signature ||
        invoiceFields.show_buyer_signature) && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              invoiceFields.show_seller_signature &&
              invoiceFields.show_buyer_signature
                ? "1fr 1fr"
                : "1fr",
            gap: "12px",
            marginTop: "14px",
          }}
        >
          {invoiceFields.show_seller_signature && (
            <div
              style={{
                height: "88px",
                border: "1px dashed #9ca3af",
                borderRadius: "8px",
                padding: "10px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <strong style={{ fontSize: "11px" }}>مهر و امضای فروشنده</strong>
              <span
                style={{
                  textAlign: "center",
                  color: "#6b7280",
                  fontSize: "9px",
                }}
              >
                محل مهر و امضا
              </span>
            </div>
          )}
          {invoiceFields.show_buyer_signature && (
            <div
              style={{
                height: "88px",
                border: "1px dashed #9ca3af",
                borderRadius: "8px",
                padding: "10px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <strong style={{ fontSize: "11px" }}>امضای خریدار</strong>
              <span
                style={{
                  textAlign: "center",
                  color: "#6b7280",
                  fontSize: "9px",
                }}
              >
                نام و امضا
              </span>
            </div>
          )}
        </div>
      )}

      {/* Export Footer */}
      <div
        style={{
          textAlign: "center",
          borderTop: "1px solid #e5e7eb",
          marginTop: "16px",
          paddingTop: "8px",
          fontSize: "12px",
          fontWeight: 600,
          color: "#6b7280",
        }}
      >
        {profile?.footer_text || "این فاکتور توسط سیستم محاسب پرو صادر شده است"}
        {profile?.website && (
          <span style={{ marginRight: "8px" }}>| {profile.website}</span>
        )}
        {!!profile?.social_links?.length && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "center",
              columnGap: "16px",
              rowGap: "6px",
              marginTop: "8px",
              fontWeight: 400,
            }}
          >
            {profile.social_links.map((item) => (
              <span
                key={item.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  direction: "ltr",
                }}
              >
                {item.logo_url && (
                  <img
                    src={item.logo_url}
                    alt=""
                    crossOrigin="anonymous"
                    style={{
                      width: "14px",
                      height: "14px",
                      objectFit: "contain",
                    }}
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
  </>
);
