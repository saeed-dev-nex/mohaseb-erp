import React, { useCallback, useEffect, useState } from "react";
import {
  customersAPI,
  inventoryAPI,
  type Product,
  type PurchaseInvoice,
} from "../services/api";
import { useBusiness } from "../lib/business";
import JalaliDatePicker from "../components/JalaliDatePicker";
import { toJalali } from "../utils/persian";
import { Button, EmptyState, Spinner } from "../components/ui";
import { Section } from "../components/FormSection";

const fmt = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("fa-IR").format(Number(n) || 0);

const inp =
  "w-full px-3 py-2.5 bg-slate-700/50 border border-slate-600/50 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all";

type Tab = "products" | "purchases" | "kardex";

type Party = { id: number; name: string; party_role: string };
type KardexRow = {
  id: number;
  kind_display: string;
  date: string;
  quantity: number;
  signed_quantity: number;
  unit_cost: number;
  note: string;
  balance: number;
};

export default function InventoryPage() {
  const { current } = useBusiness();
  const [tab, setTab] = useState<Tab>("products");
  const [products, setProducts] = useState<Product[]>([]);
  const [purchases, setPurchases] = useState<PurchaseInvoice[]>([]);
  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [newProduct, setNewProduct] = useState({
    code: "",
    name: "",
    unit: "عدد",
    sale_price: "",
  });
  const [purchaseForm, setPurchaseForm] = useState<{
    id?: number;
    supplier: number | "";
    date: string;
    description: string;
    vat_amount: string;
    lines: { product: number | ""; quantity: number; unit_price: string }[];
  } | null>(null);
  const [kardexProduct, setKardexProduct] = useState<number | "">("");
  const [kardex, setKardex] = useState<{
    rows: KardexRow[];
    current_stock: number;
  } | null>(null);
  const [adjust, setAdjust] = useState({
    kind: "in_adjust",
    quantity: "",
    note: "",
  });

  const load = useCallback(async () => {
    if (!current) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [productsRes, purchasesRes, customersRes] = await Promise.all([
        inventoryAPI.products(),
        inventoryAPI.purchases(),
        customersAPI.list(),
      ]);
      setProducts(productsRes.data);
      const pdata = purchasesRes.data as unknown as
        PurchaseInvoice[] | { results: PurchaseInvoice[] };
      setPurchases(Array.isArray(pdata) ? pdata : pdata.results);
      const cdata = customersRes.data as unknown as
        Party[] | { results: Party[] };
      const parties = Array.isArray(cdata) ? cdata : cdata.results;
      setSuppliers(parties.filter((p) => p.party_role !== "customer"));
    } catch {
      setMessage("خطا در دریافت اطلاعات انبار");
    } finally {
      setLoading(false);
    }
  }, [current]);

  useEffect(() => {
    load();
  }, [load]);

  const createProduct = async () => {
    if (!newProduct.code || !newProduct.name) return;
    try {
      await inventoryAPI.createProduct({
        code: newProduct.code,
        name: newProduct.name,
        unit: newProduct.unit,
        sale_price: Number(newProduct.sale_price) || 0,
      });
      setNewProduct({ code: "", name: "", unit: "عدد", sale_price: "" });
      setMessage("کالا ساخته شد.");
      load();
    } catch {
      setMessage("خطا در ساخت کالا (کد تکراری؟)");
    }
  };

  const openPurchase = (purchase?: PurchaseInvoice) => {
    if (purchase) {
      setPurchaseForm({
        id: purchase.id,
        supplier: purchase.supplier,
        date: purchase.date,
        description: purchase.description,
        vat_amount: String(purchase.vat_amount || ""),
        lines: purchase.lines.map((l) => ({
          product: l.product,
          quantity: Number(l.quantity),
          unit_price: String(l.unit_price),
        })),
      });
    } else {
      setPurchaseForm({
        supplier: "",
        date: new Date().toISOString().slice(0, 10),
        description: "",
        vat_amount: "",
        lines: [{ product: "", quantity: 1, unit_price: "" }],
      });
    }
  };

  const savePurchase = async (postAfter: boolean) => {
    if (!purchaseForm || purchaseForm.supplier === "") return;
    const payload = {
      supplier: purchaseForm.supplier,
      date: purchaseForm.date,
      description: purchaseForm.description,
      vat_amount: Number(purchaseForm.vat_amount) || 0,
      lines: purchaseForm.lines
        .filter((l) => l.product !== "")
        .map((l) => ({
          product: l.product,
          quantity: l.quantity,
          unit_price: Number(l.unit_price) || 0,
        })),
    };
    try {
      const res = purchaseForm.id
        ? await inventoryAPI.updatePurchase(purchaseForm.id, payload)
        : await inventoryAPI.createPurchase(payload);
      if (postAfter) await inventoryAPI.postPurchase(res.data.id);
      setMessage(
        postAfter
          ? "خرید ثبت نهایی شد؛ انبار و سند به‌روز شد."
          : "پیش‌نویس خرید ذخیره شد.",
      );
      setPurchaseForm(null);
      load();
    } catch {
      setMessage("خطا در ذخیرهٔ فاکتور خرید");
    }
  };

  const actOnPurchase = async (
    purchase: PurchaseInvoice,
    kind: "post" | "unpost" | "delete",
  ) => {
    try {
      if (kind === "post") await inventoryAPI.postPurchase(purchase.id);
      if (kind === "unpost") await inventoryAPI.unpostPurchase(purchase.id);
      if (kind === "delete") await inventoryAPI.deletePurchase(purchase.id);
      setMessage("انجام شد.");
      load();
    } catch {
      setMessage("خطا در انجام عملیات روی فاکتور خرید");
    }
  };

  const loadKardex = async (productId: number) => {
    try {
      const res = await inventoryAPI.kardex(productId);
      const data = res.data as unknown as {
        rows: KardexRow[];
        current_stock: number;
      };
      setKardex(data);
    } catch {
      setMessage("خطا در دریافت کاردکس");
    }
  };

  const saveAdjust = async () => {
    if (kardexProduct === "" || !adjust.quantity) return;
    try {
      await inventoryAPI.adjust({
        product: kardexProduct,
        kind: adjust.kind,
        quantity: adjust.quantity,
        note: adjust.note,
      });
      setMessage("گردش اصلاحی ثبت شد.");
      setAdjust({ kind: "in_adjust", quantity: "", note: "" });
      loadKardex(kardexProduct);
      load();
    } catch {
      setMessage("خطا در ثبت گردش اصلاحی");
    }
  };

  if (!current) {
    return (
      <EmptyState
        icon="📦"
        title="کسب‌وکاری انتخاب نشده است"
        description="برای کار با انبار، ابتدا از نوبار یک کسب‌وکار انتخاب کنید."
      />
    );
  }
  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-white">
          انبار و خرید — {current.name}
        </h1>
        <div className="flex gap-2">
          {(
            [
              ["products", "کالاها و موجودی"],
              ["purchases", "فاکتورهای خرید"],
              ["kardex", "کاردکس کالا"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`px-4 py-2 rounded-xl text-sm transition-all ${
                tab === key
                  ? "bg-blue-600 text-white"
                  : "bg-slate-700/60 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {message && (
        <p className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2">
          {message}
        </p>
      )}

      {tab === "products" && (
        <Section title="کالاها و موجودی" icon="📦">
          <div className="overflow-x-auto mb-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 text-right border-b border-slate-700">
                  <th className="py-2 px-2">کد</th>
                  <th className="py-2 px-2">نام کالا</th>
                  <th className="py-2 px-2">واحد</th>
                  <th className="py-2 px-2">موجودی</th>
                  <th className="py-2 px-2">بهای میانگین</th>
                  <th className="py-2 px-2">ارزش موجودی</th>
                  <th className="py-2 px-2">قیمت فروش</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-slate-800 text-slate-200"
                  >
                    <td className="py-2 px-2 font-mono text-slate-400">
                      {p.code}
                    </td>
                    <td className="py-2 px-2">{p.name}</td>
                    <td className="py-2 px-2">{p.unit}</td>
                    <td className="py-2 px-2">{fmt(p.current_stock)}</td>
                    <td className="py-2 px-2">{fmt(p.average_cost)}</td>
                    <td className="py-2 px-2">{fmt(p.stock_value)}</td>
                    <td className="py-2 px-2">{fmt(p.sale_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid sm:grid-cols-5 gap-2 items-end">
            <input
              className={inp}
              placeholder="کد کالا"
              value={newProduct.code}
              onChange={(e) =>
                setNewProduct({ ...newProduct, code: e.target.value })
              }
            />
            <input
              className={inp}
              placeholder="نام کالا"
              value={newProduct.name}
              onChange={(e) =>
                setNewProduct({ ...newProduct, name: e.target.value })
              }
            />
            <input
              className={inp}
              placeholder="واحد (عدد، لیتر…)"
              value={newProduct.unit}
              onChange={(e) =>
                setNewProduct({ ...newProduct, unit: e.target.value })
              }
            />
            <input
              className={inp}
              placeholder="قیمت فروش"
              inputMode="numeric"
              value={newProduct.sale_price}
              onChange={(e) =>
                setNewProduct({
                  ...newProduct,
                  sale_price: e.target.value.replace(/[^0-9]/g, ""),
                })
              }
            />
            <Button type="button" variant="primary" onClick={createProduct}>
              ساخت کالا
            </Button>
          </div>
        </Section>
      )}

      {tab === "purchases" && (
        <Section title="فاکتورهای خرید" icon="🧾">
          <div className="flex justify-end mb-4">
            <Button
              type="button"
              variant="primary"
              onClick={() => openPurchase()}
            >
              + خرید جدید
            </Button>
          </div>
          {purchaseForm && (
            <div className="mb-5 rounded-2xl border border-blue-500/30 bg-slate-800/60 p-4 space-y-4">
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    تأمین‌کننده
                  </label>
                  <select
                    className={inp}
                    value={purchaseForm.supplier}
                    onChange={(e) =>
                      setPurchaseForm({
                        ...purchaseForm,
                        supplier: e.target.value ? Number(e.target.value) : "",
                      })
                    }
                  >
                    <option value="">انتخاب تأمین‌کننده…</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    تاریخ خرید
                  </label>
                  <JalaliDatePicker
                    value={purchaseForm.date}
                    onChange={(v) =>
                      setPurchaseForm({ ...purchaseForm, date: v })
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    شرح
                  </label>
                  <input
                    className={inp}
                    value={purchaseForm.description}
                    onChange={(e) =>
                      setPurchaseForm({
                        ...purchaseForm,
                        description: e.target.value,
                      })
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                {purchaseForm.lines.map((line, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-12 gap-2 items-center"
                  >
                    <select
                      className={`${inp} col-span-5`}
                      value={line.product}
                      onChange={(e) => {
                        const lines = [...purchaseForm.lines];
                        lines[idx] = {
                          ...line,
                          product: e.target.value ? Number(e.target.value) : "",
                        };
                        setPurchaseForm({ ...purchaseForm, lines });
                      }}
                    >
                      <option value="">انتخاب کالا…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code} — {p.name}
                        </option>
                      ))}
                    </select>
                    <input
                      className={`${inp} col-span-3`}
                      type="number"
                      min={0}
                      placeholder="مقدار"
                      value={line.quantity}
                      onChange={(e) => {
                        const lines = [...purchaseForm.lines];
                        lines[idx] = {
                          ...line,
                          quantity: Number(e.target.value) || 0,
                        };
                        setPurchaseForm({ ...purchaseForm, lines });
                      }}
                    />
                    <input
                      className={`${inp} col-span-3`}
                      placeholder="قیمت واحد خرید"
                      inputMode="numeric"
                      value={line.unit_price}
                      onChange={(e) => {
                        const lines = [...purchaseForm.lines];
                        lines[idx] = {
                          ...line,
                          unit_price: e.target.value.replace(/[^0-9]/g, ""),
                        };
                        setPurchaseForm({ ...purchaseForm, lines });
                      }}
                    />
                    <button
                      type="button"
                      className="col-span-1 text-rose-300 text-sm"
                      onClick={() =>
                        setPurchaseForm({
                          ...purchaseForm,
                          lines: purchaseForm.lines.filter((_, i) => i !== idx),
                        })
                      }
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="text-blue-300 text-sm"
                  onClick={() =>
                    setPurchaseForm({
                      ...purchaseForm,
                      lines: [
                        ...purchaseForm.lines,
                        { product: "", quantity: 1, unit_price: "" },
                      ],
                    })
                  }
                >
                  + افزودن سطر
                </button>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => savePurchase(false)}
                >
                  ذخیره پیش‌نویس
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => savePurchase(true)}
                >
                  ذخیره و ثبت نهایی
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setPurchaseForm(null)}
                >
                  انصراف
                </Button>
              </div>
            </div>
          )}
          {purchases.length === 0 ? (
            <EmptyState
              icon="🧾"
              title="فاکتور خریدی ثبت نشده است"
              description="با دکمهٔ «خرید جدید» اولین خرید را ثبت کنید."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 text-right border-b border-slate-700">
                    <th className="py-2 px-2">شماره</th>
                    <th className="py-2 px-2">تاریخ</th>
                    <th className="py-2 px-2">تأمین‌کننده</th>
                    <th className="py-2 px-2">مبلغ کل</th>
                    <th className="py-2 px-2">وضعیت</th>
                    <th className="py-2 px-2">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {purchases.map((purchase) => (
                    <tr
                      key={purchase.id}
                      className="border-b border-slate-800 text-slate-200"
                    >
                      <td className="py-2 px-2">{fmt(purchase.number)}</td>
                      <td className="py-2 px-2">{toJalali(purchase.date)}</td>
                      <td className="py-2 px-2">{purchase.supplier_name}</td>
                      <td className="py-2 px-2">{fmt(purchase.total)}</td>
                      <td className="py-2 px-2">
                        <span
                          className={
                            purchase.status === "posted"
                              ? "text-emerald-300"
                              : "text-amber-300"
                          }
                        >
                          {purchase.status_display}
                        </span>
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex gap-2 text-xs">
                          {purchase.status === "draft" && (
                            <>
                              <button
                                type="button"
                                className="text-blue-300"
                                onClick={() => openPurchase(purchase)}
                              >
                                ویرایش
                              </button>
                              <button
                                type="button"
                                className="text-emerald-300"
                                onClick={() => actOnPurchase(purchase, "post")}
                              >
                                ثبت نهایی
                              </button>
                              <button
                                type="button"
                                className="text-rose-300"
                                onClick={() =>
                                  actOnPurchase(purchase, "delete")
                                }
                              >
                                حذف
                              </button>
                            </>
                          )}
                          {purchase.status === "posted" && (
                            <button
                              type="button"
                              className="text-amber-300"
                              onClick={() => actOnPurchase(purchase, "unpost")}
                            >
                              برگرداندن به پیش‌نویس
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
        </Section>
      )}

      {tab === "kardex" && (
        <Section title="کاردکس کالا" icon="🗂️">
          <div className="grid sm:grid-cols-2 gap-3 mb-4">
            <select
              className={inp}
              value={kardexProduct}
              onChange={(e) => {
                const value = e.target.value ? Number(e.target.value) : "";
                setKardexProduct(value);
                if (value !== "") loadKardex(value);
              }}
            >
              <option value="">انتخاب کالا…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
            <div className="text-sm text-slate-300 self-center">
              {kardex && <>موجودی فعلی: {fmt(kardex.current_stock)}</>}
            </div>
          </div>
          {kardex && (
            <div className="overflow-x-auto mb-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 text-right border-b border-slate-700">
                    <th className="py-2 px-2">تاریخ</th>
                    <th className="py-2 px-2">نوع گردش</th>
                    <th className="py-2 px-2">ورود</th>
                    <th className="py-2 px-2">خروج</th>
                    <th className="py-2 px-2">بهای واحد</th>
                    <th className="py-2 px-2">مانده</th>
                    <th className="py-2 px-2">توضیح</th>
                  </tr>
                </thead>
                <tbody>
                  {kardex.rows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-slate-800 text-slate-200"
                    >
                      <td className="py-2 px-2">{toJalali(row.date)}</td>
                      <td className="py-2 px-2">{row.kind_display}</td>
                      <td className="py-2 px-2">
                        {Number(row.signed_quantity) > 0
                          ? fmt(row.quantity)
                          : "—"}
                      </td>
                      <td className="py-2 px-2">
                        {Number(row.signed_quantity) < 0
                          ? fmt(row.quantity)
                          : "—"}
                      </td>
                      <td className="py-2 px-2">{fmt(row.unit_cost)}</td>
                      <td className="py-2 px-2">{fmt(row.balance)}</td>
                      <td className="py-2 px-2">{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="grid sm:grid-cols-4 gap-2 items-end">
            <select
              className={inp}
              value={adjust.kind}
              onChange={(e) => setAdjust({ ...adjust, kind: e.target.value })}
            >
              <option value="in_adjust">ورود اصلاحی</option>
              <option value="out_adjust">خروج اصلاحی</option>
            </select>
            <input
              className={inp}
              placeholder="مقدار"
              inputMode="numeric"
              value={adjust.quantity}
              onChange={(e) =>
                setAdjust({
                  ...adjust,
                  quantity: e.target.value.replace(/[^0-9.]/g, ""),
                })
              }
            />
            <input
              className={inp}
              placeholder="توضیح (مثلاً نتیجهٔ انبارگردانی)"
              value={adjust.note}
              onChange={(e) => setAdjust({ ...adjust, note: e.target.value })}
            />
            <Button type="button" variant="primary" onClick={saveAdjust}>
              ثبت گردش اصلاحی
            </Button>
          </div>
        </Section>
      )}
    </div>
  );
}
