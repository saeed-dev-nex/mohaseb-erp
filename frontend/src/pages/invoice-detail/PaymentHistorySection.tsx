import type { Dispatch, FormEvent, SetStateAction } from "react";
import PriceInput from "../../components/PriceInput";
import { fmt, persianDate } from "./format";
import type { InvoicePayment, PaymentFormData } from "./types";

type Props = {
  payments?: InvoicePayment[];
  paidAmount: number;
  remainingAmount: number;
  invoiceStatus: string;
  paymentForm: PaymentFormData;
  setPaymentForm: Dispatch<SetStateAction<PaymentFormData>>;
  paymentSaving: boolean;
  paymentError: string;
  paymentEditId: number | null;
  setPaymentEditId: Dispatch<SetStateAction<number | null>>;
  paymentEditForm: PaymentFormData;
  setPaymentEditForm: Dispatch<SetStateAction<PaymentFormData>>;
  startPaymentEdit: (payment: InvoicePayment) => void;
  isPaidOperator: boolean;
  onAddPayment: (event: FormEvent) => void;
  onDeletePayment: (payment: InvoicePayment) => void;
  onUpdatePayment: (event: FormEvent) => void;
};

// Recorded payments list + the add-payment form (screen only, no-print).
export const PaymentHistorySection = ({
  payments,
  paidAmount,
  remainingAmount,
  invoiceStatus,
  paymentForm,
  setPaymentForm,
  paymentSaving,
  paymentError,
  paymentEditId,
  setPaymentEditId,
  paymentEditForm,
  setPaymentEditForm,
  startPaymentEdit,
  isPaidOperator,
  onAddPayment,
  onDeletePayment,
  onUpdatePayment,
}: Props) => (
  <section className="no-print p-5 border-b border-slate-700/50 space-y-4">
    <div className="flex items-center justify-between gap-4">
      <h3 className="font-semibold text-white">پرداخت‌های ثبت‌شده</h3>
      <span className="text-sm text-slate-400">
        دریافت‌شده: {fmt(paidAmount)} · مانده: {fmt(remainingAmount)}
      </span>
    </div>
    {payments?.length > 0 ? (
      <div className="space-y-2">
        {payments.map((payment) => (
          <div
            key={payment.id}
            className="rounded-xl bg-slate-700/30 px-3 py-2 text-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-emerald-600 font-medium">
                {fmt(payment.amount)}
              </span>
              <span className="text-slate-400">
                {payment.method_display} · {persianDate(payment.paid_at)}
              </span>
              <span className="text-slate-500 text-xs">
                {payment.created_by_name}
              </span>
              {payment.reference && (
                <span className="text-slate-500 text-xs">
                  پیگیری: {payment.reference}
                </span>
              )}
              {!isPaidOperator && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => startPaymentEdit(payment)}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    ویرایش
                  </button>
                  <button
                    type="button"
                    disabled={paymentSaving}
                    onClick={() => onDeletePayment(payment)}
                    className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                  >
                    حذف
                  </button>
                </div>
              )}
            </div>
            {paymentEditId === payment.id && !isPaidOperator && (
              <form
                onSubmit={onUpdatePayment}
                className="mt-3 space-y-3 border-t border-slate-600/50 pt-3"
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <PriceInput
                    required
                    min="1"
                    value={paymentEditForm.amount}
                    blankWhenZero
                    placeholder="مبلغ پرداختی"
                    onChange={(amount) =>
                      setPaymentEditForm((f) => ({ ...f, amount }))
                    }
                  />
                  <select
                    value={paymentEditForm.method}
                    onChange={(e) =>
                      setPaymentEditForm((f) => ({
                        ...f,
                        method: e.target.value,
                      }))
                    }
                    className="rounded-lg border border-slate-600 bg-slate-800/50 px-3 py-2 text-sm text-white"
                  >
                    <option value="cash">نقدی</option>
                    <option value="card">کارت‌خوان</option>
                    <option value="transfer">کارت‌به‌کارت / حواله</option>
                    <option value="other">سایر</option>
                  </select>
                  <input
                    value={paymentEditForm.reference}
                    onChange={(e) =>
                      setPaymentEditForm((f) => ({
                        ...f,
                        reference: e.target.value,
                      }))
                    }
                    placeholder="شماره پیگیری"
                    className="rounded-lg border border-slate-600 bg-slate-800/50 px-3 py-2 text-sm text-white placeholder-slate-500"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={paymentSaving}
                      className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {paymentSaving ? "در حال ذخیره..." : "ذخیره"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentEditId(null)}
                      className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-300"
                    >
                      انصراف
                    </button>
                  </div>
                </div>
                <input
                  value={paymentEditForm.note}
                  onChange={(e) =>
                    setPaymentEditForm((f) => ({
                      ...f,
                      note: e.target.value,
                    }))
                  }
                  placeholder="یادداشت (اختیاری)"
                  className="w-full rounded-lg border border-slate-600 bg-slate-800/50 px-3 py-2 text-sm text-white placeholder-slate-500"
                />
              </form>
            )}
          </div>
        ))}
      </div>
    ) : (
      <p className="text-slate-500 text-xs">
        هنوز پرداختی به‌صورت مرحله‌ای ثبت نشده است.
      </p>
    )}
    {paymentError && (
      <p role="alert" className="text-xs text-red-500">
        {paymentError}
      </p>
    )}

    {!isPaidOperator &&
      Number(remainingAmount) > 0 &&
      !["cancelled", "draft"].includes(invoiceStatus) && (
        <form
          onSubmit={onAddPayment}
          className="space-y-3 rounded-xl border border-slate-700/50 p-4"
        >
          <h4 className="text-sm font-medium text-slate-300">
            ثبت دریافت جدید
          </h4>
          {paymentError && (
            <p role="alert" className="text-xs text-red-500">
              {paymentError}
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <PriceInput
              required
              min="1"
              value={paymentForm.amount}
              blankWhenZero
              placeholder="مبلغ پرداختی"
              onChange={(amount) => setPaymentForm((f) => ({ ...f, amount }))}
            />
            <select
              value={paymentForm.method}
              onChange={(e) =>
                setPaymentForm((f) => ({
                  ...f,
                  method: e.target.value,
                }))
              }
              className="rounded-lg border border-slate-600 bg-slate-800/50 px-3 py-2 text-sm text-white"
            >
              <option value="cash">نقدی</option>
              <option value="card">کارت‌خوان</option>
              <option value="transfer">کارت‌به‌کارت / حواله</option>
              <option value="other">سایر</option>
            </select>
            <input
              value={paymentForm.reference}
              onChange={(e) =>
                setPaymentForm((f) => ({
                  ...f,
                  reference: e.target.value,
                }))
              }
              placeholder="شماره پیگیری (اختیاری)"
              className="rounded-lg border border-slate-600 bg-slate-800/50 px-3 py-2 text-sm text-white placeholder-slate-500"
            />
            <button
              disabled={paymentSaving || !paymentForm.amount}
              className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {paymentSaving ? "در حال ثبت..." : "ثبت پرداخت"}
            </button>
          </div>
          <input
            value={paymentForm.note}
            onChange={(e) =>
              setPaymentForm((f) => ({ ...f, note: e.target.value }))
            }
            placeholder="یادداشت (اختیاری)"
            className="w-full rounded-lg border border-slate-600 bg-slate-800/50 px-3 py-2 text-sm text-white placeholder-slate-500"
          />
        </form>
      )}
  </section>
);
