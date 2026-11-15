import React, { useCallback, useEffect, useState } from "react";
import {
  customersAPI,
  inventoryAPI,
  type InventoryAlerts,
  type InventorySettings,
  type Product,
  type ProductCategory,
  type PurchaseInvoice,
  type StockCount,
  type StockTransfer,
  type Warehouse,
} from "../services/api";
import { flattenCategories } from "../components/CategoryManager";
import { useBusiness } from "../lib/business";
import JalaliDatePicker from "../components/JalaliDatePicker";
import { toJalali } from "../utils/persian";
import { Button, EmptyState, Spinner } from "../components/ui";
import { Section } from "../components/FormSection";

const fmt = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("fa-IR").format(Number(n) || 0);

const inp =
  "w-full px-3 py-2.5 bg-slate-700/50 border border-slate-600/50 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all";

type Tab =
  "products" | "purchases" | "transfers" | "counts" | "alerts" | "kardex";

type Party = { id: number; name: string; party_role: string };
type KardexRow = {
  id: number;
  kind_display: string;
  date: string;
  quantity: number;
  signed_quantity: number;
  unit_cost: number;
  batch_no: string;
  expiry_date: string | null;
  note: string;
  balance: number;
  balance_value: number;
};

export default function InventoryPage() {
  const { current } = useBusiness();
  const [tab, setTab] = useState<Tab>("products");
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null);
  const [purchases, setPurchases] = useState<PurchaseInvoice[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [counts, setCounts] = useState<StockCount[]>([]);
  const [alerts, setAlerts] = useState<InventoryAlerts | null>(null);
  const [invSettings, setInvSettings] = useState<InventorySettings | null>(
    null,
  );
  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [newWarehouse, setNewWarehouse] = useState("");
  const [newProduct, setNewProduct] = useState({
    code: "",
    name: "",
    unit: "عدد",
    sale_price: "",
    barcode: "",
    min_stock: "",
    reorder_point: "",
    max_stock: "",
    secondary_unit: "",
    secondary_factor: "",
    shelf_location: "",
  });
  const [purchaseForm, setPurchaseForm] = useState<{
    id?: number;
    supplier: number | "";
    date: string;
    description: string;
    vat_amount: string;
    warehouse: number | "";
    extra_costs: string;
    lines: {
      product: number | "";
      quantity: number;
      unit_price: string;
      batch_no: string;
      expiry_date: string;
    }[];
  } | null>(null);
  const [transferForm, setTransferForm] = useState<{
    id?: number;
    date: string;
    from_warehouse: number | "";
    to_warehouse: number | "";
    description: string;
    lines: { product: number | ""; quantity: number }[];
  } | null>(null);
  const [countForm, setCountForm] = useState<{
    warehouse: number | "";
    date: string;
  } | null>(null);
  const [activeCount, setActiveCount] = useState<StockCount | null>(null);
  const [counted, setCounted] = useState<Record<number, string>>({});
  const [kardexProduct, setKardexProduct] = useState<number | "">("");
  const [kardexWarehouse, setKardexWarehouse] = useState<number | "">("");
  const [kardex, setKardex] = useState<{
    rows: KardexRow[];
    current_stock: number;
    stock_value: number;
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
      const [
        productsRes,
        purchasesRes,
        customersRes,
        warehousesRes,
        transfersRes,
        countsRes,
        alertsRes,
        settingsRes,
      ] = await Promise.all([
        inventoryAPI.products(),
        inventoryAPI.purchases(),
        customersAPI.list(),
        inventoryAPI.warehouses(),
        inventoryAPI.transfers(),
        inventoryAPI.stockCounts(),
        inventoryAPI.alerts(),
        inventoryAPI.inventorySettings(),
      ]);
      setProducts(productsRes.data);
      inventoryAPI
        .categories()
        .then((res) => setCategories(res.data))
        .catch(() => {});
      setWarehouses(warehousesRes.data);
      setTransfers(transfersRes.data);
      setCounts(countsRes.data);
      setAlerts(alertsRes.data);
      setInvSettings(settingsRes.data);
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
    if (!newProduct.name) return;
    try {
      await inventoryAPI.createProduct({
        code: newProduct.code,
        name: newProduct.name,
        unit: newProduct.unit,
        sale_price: Number(newProduct.sale_price) || 0,
        barcode: newProduct.barcode,
        min_stock: Number(newProduct.min_stock) || 0,
        reorder_point: Number(newProduct.reorder_point) || 0,
        max_stock: Number(newProduct.max_stock) || 0,
        secondary_unit: newProduct.secondary_unit,
        secondary_factor: Number(newProduct.secondary_factor) || 1,
        shelf_location: newProduct.shelf_location,
      });
      setNewProduct({
        code: "",
        name: "",
        unit: "عدد",
        sale_price: "",
        barcode: "",
        min_stock: "",
        reorder_point: "",
        max_stock: "",
        secondary_unit: "",
        secondary_factor: "",
        shelf_location: "",
      });
      setMessage("کالا ساخته شد.");
      load();
    } catch {
      setMessage("خطا در ساخت کالا (کد تکراری؟)");
    }
  };

  const createWarehouse = async () => {
    if (!newWarehouse.trim()) return;
    try {
      await inventoryAPI.createWarehouse({ name: newWarehouse.trim() });
      setNewWarehouse("");
      setMessage("انبار ساخته شد.");
      load();
    } catch {
      setMessage("خطا در ساخت انبار");
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
        warehouse: purchase.warehouse ?? "",
        extra_costs: String(purchase.extra_costs || ""),
        lines: purchase.lines.map((l) => ({
          product: l.product,
          quantity: Number(l.quantity),
          unit_price: String(l.unit_price),
          batch_no: l.batch_no || "",
          expiry_date: l.expiry_date || "",
        })),
      });
    } else {
      setPurchaseForm({
        supplier: "",
        date: new Date().toISOString().slice(0, 10),
        description: "",
        vat_amount: "",
        warehouse: "",
        extra_costs: "",
        lines: [
          {
            product: "",
            quantity: 1,
            unit_price: "",
            batch_no: "",
            expiry_date: "",
          },
        ],
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
      warehouse: purchaseForm.warehouse === "" ? null : purchaseForm.warehouse,
      extra_costs: Number(purchaseForm.extra_costs) || 0,
      lines: purchaseForm.lines
        .filter((l) => l.product !== "")
        .map((l) => ({
          product: l.product,
          quantity: l.quantity,
          unit_price: Number(l.unit_price) || 0,
          batch_no: l.batch_no,
          expiry_date: l.expiry_date || null,
        })),
    };
    try {
      const res = purchaseForm.id
        ? await inventoryAPI.updatePurchase(purchaseForm.id, payload)
        : await inventoryAPI.createPurchase(payload);
      if (postAfter) {
        try {
          await inventoryAPI.postPurchase(res.data.id);
        } catch {
          // The draft/purchase exists now. Keep its id in the form so
          // pressing save again UPDATES it instead of creating a
          // duplicate draft, and say plainly what actually happened.
          setPurchaseForm({ ...purchaseForm, id: res.data.id });
          setMessage(
            "فاکتور خرید ذخیره شد، اما ثبت نهایی آن ناموفق بود؛ دوباره تلاش کنید.",
          );
          load();
          return;
        }
      }
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

  const errText = (err: unknown, fallback: string) => {
    const data = (err as { response?: { data?: unknown } })?.response?.data;
    if (typeof data === "string" && data) return data;
    if (data && typeof data === "object") {
      const first = Object.values(data as Record<string, unknown>)[0];
      if (Array.isArray(first) && first[0]) return String(first[0]);
      if (typeof first === "string") return first;
    }
    return fallback;
  };

  const openTransfer = (transfer?: StockTransfer) => {
    if (transfer) {
      setTransferForm({
        id: transfer.id,
        date: transfer.date,
        from_warehouse: transfer.from_warehouse,
        to_warehouse: transfer.to_warehouse,
        description: transfer.description,
        lines: transfer.lines.map((l) => ({
          product: l.product,
          quantity: Number(l.quantity),
        })),
      });
    } else {
      setTransferForm({
        date: new Date().toISOString().slice(0, 10),
        from_warehouse: "",
        to_warehouse: "",
        description: "",
        lines: [{ product: "", quantity: 1 }],
      });
    }
  };

  const saveTransfer = async (postAfter: boolean) => {
    if (
      !transferForm ||
      transferForm.from_warehouse === "" ||
      transferForm.to_warehouse === ""
    )
      return;
    if (transferForm.from_warehouse === transferForm.to_warehouse) {
      setMessage("خطا: انبار مبدأ و مقصد نمی‌توانند یکی باشند.");
      return;
    }
    const payload = {
      date: transferForm.date,
      from_warehouse: transferForm.from_warehouse,
      to_warehouse: transferForm.to_warehouse,
      description: transferForm.description,
      lines: transferForm.lines
        .filter((l) => l.product !== "")
        .map((l) => ({ product: l.product, quantity: l.quantity })),
    };
    try {
      const res = transferForm.id
        ? await inventoryAPI.updateTransfer(transferForm.id, payload)
        : await inventoryAPI.createTransfer(payload);
      if (postAfter) {
        try {
          await inventoryAPI.postTransfer(res.data.id);
        } catch (err) {
          setTransferForm({ ...transferForm, id: res.data.id });
          setMessage(errText(err, "حواله ذخیره شد، اما ثبت آن ناموفق بود."));
          load();
          return;
        }
      }
      setMessage(
        postAfter
          ? "حواله ثبت و موجودی جابه‌جا شد."
          : "پیش‌نویس حواله ذخیره شد.",
      );
      setTransferForm(null);
      load();
    } catch (err) {
      setMessage(errText(err, "خطا در ذخیرهٔ حواله"));
    }
  };

  const actOnTransfer = async (
    transfer: StockTransfer,
    kind: "post" | "unpost" | "delete",
  ) => {
    try {
      if (kind === "post") await inventoryAPI.postTransfer(transfer.id);
      if (kind === "unpost") await inventoryAPI.unpostTransfer(transfer.id);
      if (kind === "delete") await inventoryAPI.deleteTransfer(transfer.id);
      setMessage("انجام شد.");
      load();
    } catch (err) {
      setMessage(errText(err, "خطا در انجام عملیات روی حواله"));
    }
  };

  const createCount = async () => {
    if (!countForm) return;
    try {
      const res = await inventoryAPI.createStockCount({
        date: countForm.date,
        warehouse: countForm.warehouse === "" ? undefined : countForm.warehouse,
      });
      setCountForm(null);
      openCount(res.data);
      setMessage("برگهٔ انبارگردانی ساخته شد؛ مقادیر شمارش‌شده را وارد کنید.");
      load();
    } catch (err) {
      setMessage(errText(err, "خطا در ساخت انبارگردانی"));
    }
  };

  const openCount = (count: StockCount) => {
    setActiveCount(count);
    const initial: Record<number, string> = {};
    for (const line of count.lines) {
      if (line.counted_qty !== null && line.counted_qty !== undefined) {
        initial[line.id] = String(line.counted_qty);
      }
    }
    setCounted(initial);
  };

  const saveCountLines = async () => {
    if (!activeCount) return;
    try {
      const res = await inventoryAPI.saveStockCountLines(
        activeCount.id,
        activeCount.lines.map((line) => ({
          id: line.id,
          counted_qty:
            counted[line.id] === undefined || counted[line.id] === ""
              ? null
              : Number(counted[line.id]),
        })),
      );
      setActiveCount(res.data);
      setMessage("مقادیر شمارش ذخیره شد.");
      load();
    } catch (err) {
      setMessage(errText(err, "خطا در ذخیرهٔ شمارش"));
    }
  };

  const applyCount = async () => {
    if (!activeCount) return;
    try {
      await saveCountLines();
      const res = await inventoryAPI.applyStockCount(activeCount.id);
      setMessage(
        `انبارگردانی اعمال شد؛ ${fmt(res.data.adjusted_lines ?? 0)} سطر مغایرت با سند اصلاحی تعدیل شد.`,
      );
      setActiveCount(null);
      load();
    } catch (err) {
      setMessage(errText(err, "خطا در اعمال انبارگردانی"));
    }
  };

  const toggleGuard = async (on: boolean) => {
    try {
      const res = await inventoryAPI.updateInventorySettings({
        block_negative_stock: on,
      });
      setInvSettings(res.data);
      setMessage(
        on
          ? "جلوگیری از موجودی منفی فعال شد."
          : "جلوگیری از موجودی منفی غیرفعال شد.",
      );
    } catch {
      setMessage("خطا در ذخیرهٔ تنظیمات انبار");
    }
  };

  const loadKardex = async (productId: number, warehouseId?: number) => {
    try {
      const res = await inventoryAPI.kardex(productId, warehouseId);
      const data = res.data as unknown as {
        rows: KardexRow[];
        current_stock: number;
        stock_value: number;
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
      loadKardex(
        kardexProduct,
        kardexWarehouse === "" ? undefined : kardexWarehouse,
      );
      load();
    } catch (err) {
      setMessage(errText(err, "خطا در ثبت گردش اصلاحی"));
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
              ["transfers", "حواله انتقال"],
              ["counts", "انبارگردانی"],
              ["alerts", "هشدارها و پیشنهاد خرید"],
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
        <p
          className={`text-sm rounded-xl px-3 py-2 border ${
            message.startsWith("خطا")
              ? "text-rose-300 bg-rose-500/10 border-rose-500/20"
              : "text-emerald-300 bg-emerald-500/10 border-emerald-500/20"
          }`}
        >
          {message}
        </p>
      )}

      {tab === "products" && (
        <Section title="کالاها و موجودی" icon="📦">
          <div className="flex flex-wrap items-center gap-2 mb-4 text-sm">
            <span className="text-slate-400">انبارها:</span>
            {warehouses.map((w) => (
              <span
                key={w.id}
                className="px-2.5 py-1 rounded-lg bg-slate-700/60 text-slate-200"
              >
                {w.name}
                {w.is_default ? " (پیش‌فرض)" : ""}
              </span>
            ))}
            <input
              className={`${inp} !w-44`}
              placeholder="نام انبار جدید"
              value={newWarehouse}
              onChange={(e) => setNewWarehouse(e.target.value)}
            />
            <Button type="button" variant="outline" onClick={createWarehouse}>
              + ساخت انبار
            </Button>
            {categories.length > 0 && (
              <>
                <span className="text-slate-400 mr-3">دسته‌بندی:</span>
                <select
                  className={`${inp} !w-56`}
                  value={categoryFilter ?? ""}
                  onChange={(e) =>
                    setCategoryFilter(
                      e.target.value ? Number(e.target.value) : null,
                    )
                  }
                >
                  <option value="">همهٔ کالاها</option>
                  {flattenCategories(categories).map((c) => (
                    <option key={c.id} value={c.id}>
                      {" ".repeat(c.depth)}
                      {c.path}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
          <div className="overflow-x-auto mb-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 text-right border-b border-slate-700">
                  <th className="py-2 px-2">کد</th>
                  <th className="py-2 px-2">نام کالا</th>
                  <th className="py-2 px-2">واحد</th>
                  <th className="py-2 px-2">مکان</th>
                  <th className="py-2 px-2">موجودی</th>
                  <th className="py-2 px-2">بهای میانگین</th>
                  <th className="py-2 px-2">ارزش موجودی</th>
                  <th className="py-2 px-2">قیمت فروش</th>
                  <th className="py-2 px-2">وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {products
                  .filter((p) => {
                    if (!categoryFilter) return true;
                    if (!p.category) return false;
                    const byId = new Map(categories.map((c) => [c.id, c]));
                    let node = byId.get(p.category);
                    const seen = new Set<number>();
                    while (node && !seen.has(node.id)) {
                      if (node.id === categoryFilter) return true;
                      seen.add(node.id);
                      node = node.parent ? byId.get(node.parent) : undefined;
                    }
                    return false;
                  })
                  .map((p) => {
                    const low =
                      Number(p.reorder_point) > 0 &&
                      Number(p.current_stock) <= Number(p.reorder_point);
                    return (
                      <tr
                        key={p.id}
                        className="border-b border-slate-800 text-slate-200"
                      >
                        <td className="py-2 px-2 font-mono text-slate-400">
                          {p.code}
                        </td>
                        <td className="py-2 px-2">
                          {p.name}
                          {p.category_path && (
                            <span className="mt-0.5 block text-[11px] text-sky-300/80">
                              🏷️ {p.category_path}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-2">
                          {p.unit}
                          {p.secondary_unit
                            ? ` (هر ${p.secondary_unit} = ${fmt(p.secondary_factor)})`
                            : ""}
                        </td>
                        <td className="py-2 px-2">{p.shelf_location || "—"}</td>
                        <td className="py-2 px-2">{fmt(p.current_stock)}</td>
                        <td className="py-2 px-2">{fmt(p.average_cost)}</td>
                        <td className="py-2 px-2">{fmt(p.stock_value)}</td>
                        <td className="py-2 px-2">{fmt(p.sale_price)}</td>
                        <td className="py-2 px-2">
                          {low ? (
                            <span className="text-amber-300">
                              ⚠ رسیده به نقطه سفارش
                            </span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <div className="grid sm:grid-cols-5 gap-2 items-end mb-2">
            <input
              className={inp}
              placeholder="کد کالا (خالی = خودکار)"
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
            <input
              className={inp}
              placeholder="بارکد"
              value={newProduct.barcode}
              onChange={(e) =>
                setNewProduct({ ...newProduct, barcode: e.target.value })
              }
            />
          </div>
          <div className="grid sm:grid-cols-5 gap-2 items-end">
            <input
              className={inp}
              placeholder="حداقل موجودی"
              inputMode="numeric"
              value={newProduct.min_stock}
              onChange={(e) =>
                setNewProduct({
                  ...newProduct,
                  min_stock: e.target.value.replace(/[^0-9.]/g, ""),
                })
              }
            />
            <input
              className={inp}
              placeholder="نقطه سفارش"
              inputMode="numeric"
              value={newProduct.reorder_point}
              onChange={(e) =>
                setNewProduct({
                  ...newProduct,
                  reorder_point: e.target.value.replace(/[^0-9.]/g, ""),
                })
              }
            />
            <input
              className={inp}
              placeholder="حداکثر موجودی"
              inputMode="numeric"
              value={newProduct.max_stock}
              onChange={(e) =>
                setNewProduct({
                  ...newProduct,
                  max_stock: e.target.value.replace(/[^0-9.]/g, ""),
                })
              }
            />
            <input
              className={inp}
              placeholder="واحد فرعی + ضریب (کارتن ×۱۲)"
              value={newProduct.secondary_unit}
              onChange={(e) =>
                setNewProduct({ ...newProduct, secondary_unit: e.target.value })
              }
            />
            <div className="flex gap-2">
              <input
                className={inp}
                placeholder="ضریب"
                inputMode="numeric"
                value={newProduct.secondary_factor}
                onChange={(e) =>
                  setNewProduct({
                    ...newProduct,
                    secondary_factor: e.target.value.replace(/[^0-9.]/g, ""),
                  })
                }
              />
              <input
                className={inp}
                placeholder="مکان (قفسه)"
                value={newProduct.shelf_location}
                onChange={(e) =>
                  setNewProduct({
                    ...newProduct,
                    shelf_location: e.target.value,
                  })
                }
              />
              <Button type="button" variant="primary" onClick={createProduct}>
                ساخت کالا
              </Button>
            </div>
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
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    انبار مقصد
                  </label>
                  <select
                    className={inp}
                    value={purchaseForm.warehouse}
                    onChange={(e) =>
                      setPurchaseForm({
                        ...purchaseForm,
                        warehouse: e.target.value ? Number(e.target.value) : "",
                      })
                    }
                  >
                    <option value="">انبار پیش‌فرض</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    هزینه‌های جانبی خرید (حمل، بیمه…) — روی بهای کالا سرشکن
                    می‌شود
                  </label>
                  <input
                    className={inp}
                    placeholder="۰"
                    inputMode="numeric"
                    value={purchaseForm.extra_costs}
                    onChange={(e) =>
                      setPurchaseForm({
                        ...purchaseForm,
                        extra_costs: e.target.value.replace(/[^0-9]/g, ""),
                      })
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    مالیات بر ارزش افزودهٔ خرید
                  </label>
                  <input
                    className={inp}
                    placeholder="۰"
                    inputMode="numeric"
                    value={purchaseForm.vat_amount}
                    onChange={(e) =>
                      setPurchaseForm({
                        ...purchaseForm,
                        vat_amount: e.target.value.replace(/[^0-9]/g, ""),
                      })
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                {purchaseForm.lines.map((line, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="grid grid-cols-12 gap-2 items-center">
                      <select
                        className={`${inp} col-span-5`}
                        value={line.product}
                        onChange={(e) => {
                          const lines = [...purchaseForm.lines];
                          lines[idx] = {
                            ...line,
                            product: e.target.value
                              ? Number(e.target.value)
                              : "",
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
                            lines: purchaseForm.lines.filter(
                              (_, i) => i !== idx,
                            ),
                          })
                        }
                      >
                        ✕
                      </button>
                    </div>
                    <div className="grid grid-cols-12 gap-2 items-center">
                      <input
                        className={`${inp} col-span-5`}
                        placeholder="شماره بچ / سری ساخت (اختیاری)"
                        value={line.batch_no}
                        onChange={(e) => {
                          const lines = [...purchaseForm.lines];
                          lines[idx] = { ...line, batch_no: e.target.value };
                          setPurchaseForm({ ...purchaseForm, lines });
                        }}
                      />
                      <div className="col-span-6 flex items-center gap-2">
                        <span className="text-xs text-slate-400 whitespace-nowrap">
                          تاریخ انقضا:
                        </span>
                        <JalaliDatePicker
                          value={line.expiry_date}
                          onChange={(v) => {
                            const lines = [...purchaseForm.lines];
                            lines[idx] = { ...line, expiry_date: v };
                            setPurchaseForm({ ...purchaseForm, lines });
                          }}
                        />
                      </div>
                      <span className="col-span-1" />
                    </div>
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
                        {
                          product: "",
                          quantity: 1,
                          unit_price: "",
                          batch_no: "",
                          expiry_date: "",
                        },
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
                      <td className="py-2 px-2">
                        {fmt(purchase.grand_total ?? purchase.total)}
                        {Number(purchase.extra_costs) > 0 && (
                          <span className="block text-xs text-slate-500">
                            کالا: {fmt(purchase.total)} + جانبی:{" "}
                            {fmt(purchase.extra_costs)}
                          </span>
                        )}
                      </td>
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

      {tab === "transfers" && (
        <Section title="حواله‌های انتقال بین انبارها" icon="🔀">
          <div className="flex justify-end mb-4">
            <Button
              type="button"
              variant="primary"
              onClick={() => openTransfer()}
            >
              + حوالهٔ جدید
            </Button>
          </div>
          {transferForm && (
            <div className="mb-5 rounded-2xl border border-blue-500/30 bg-slate-800/60 p-4 space-y-4">
              <div className="grid sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    انبار مبدأ
                  </label>
                  <select
                    className={inp}
                    value={transferForm.from_warehouse}
                    onChange={(e) =>
                      setTransferForm({
                        ...transferForm,
                        from_warehouse: e.target.value
                          ? Number(e.target.value)
                          : "",
                      })
                    }
                  >
                    <option value="">انتخاب انبار…</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    انبار مقصد
                  </label>
                  <select
                    className={inp}
                    value={transferForm.to_warehouse}
                    onChange={(e) =>
                      setTransferForm({
                        ...transferForm,
                        to_warehouse: e.target.value
                          ? Number(e.target.value)
                          : "",
                      })
                    }
                  >
                    <option value="">انتخاب انبار…</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    تاریخ
                  </label>
                  <JalaliDatePicker
                    value={transferForm.date}
                    onChange={(v) =>
                      setTransferForm({ ...transferForm, date: v })
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    شرح
                  </label>
                  <input
                    className={inp}
                    value={transferForm.description}
                    onChange={(e) =>
                      setTransferForm({
                        ...transferForm,
                        description: e.target.value,
                      })
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                {transferForm.lines.map((line, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-12 gap-2 items-center"
                  >
                    <select
                      className={`${inp} col-span-7`}
                      value={line.product}
                      onChange={(e) => {
                        const lines = [...transferForm.lines];
                        lines[idx] = {
                          ...line,
                          product: e.target.value ? Number(e.target.value) : "",
                        };
                        setTransferForm({ ...transferForm, lines });
                      }}
                    >
                      <option value="">انتخاب کالا…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code} — {p.name} (موجودی: {fmt(p.current_stock)})
                        </option>
                      ))}
                    </select>
                    <input
                      className={`${inp} col-span-4`}
                      type="number"
                      min={0}
                      placeholder="مقدار"
                      value={line.quantity}
                      onChange={(e) => {
                        const lines = [...transferForm.lines];
                        lines[idx] = {
                          ...line,
                          quantity: Number(e.target.value) || 0,
                        };
                        setTransferForm({ ...transferForm, lines });
                      }}
                    />
                    <button
                      type="button"
                      className="col-span-1 text-rose-300 text-sm"
                      onClick={() =>
                        setTransferForm({
                          ...transferForm,
                          lines: transferForm.lines.filter((_, i) => i !== idx),
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
                    setTransferForm({
                      ...transferForm,
                      lines: [
                        ...transferForm.lines,
                        { product: "", quantity: 1 },
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
                  onClick={() => saveTransfer(false)}
                >
                  ذخیره پیش‌نویس
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => saveTransfer(true)}
                >
                  ذخیره و ثبت نهایی
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setTransferForm(null)}
                >
                  انصراف
                </Button>
              </div>
            </div>
          )}
          {transfers.length === 0 ? (
            <EmptyState
              icon="🔀"
              title="حواله‌ای ثبت نشده است"
              description="برای جابه‌جایی کالا بین انبارها، حوالهٔ انتقال بسازید."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 text-right border-b border-slate-700">
                    <th className="py-2 px-2">شماره</th>
                    <th className="py-2 px-2">تاریخ</th>
                    <th className="py-2 px-2">از انبار</th>
                    <th className="py-2 px-2">به انبار</th>
                    <th className="py-2 px-2">وضعیت</th>
                    <th className="py-2 px-2">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {transfers.map((transfer) => (
                    <tr
                      key={transfer.id}
                      className="border-b border-slate-800 text-slate-200"
                    >
                      <td className="py-2 px-2">{fmt(transfer.number)}</td>
                      <td className="py-2 px-2">{toJalali(transfer.date)}</td>
                      <td className="py-2 px-2">
                        {transfer.from_warehouse_name}
                      </td>
                      <td className="py-2 px-2">
                        {transfer.to_warehouse_name}
                      </td>
                      <td className="py-2 px-2">
                        <span
                          className={
                            transfer.status === "posted"
                              ? "text-emerald-300"
                              : "text-amber-300"
                          }
                        >
                          {transfer.status_display}
                        </span>
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex gap-2 text-xs">
                          {transfer.status === "draft" && (
                            <>
                              <button
                                type="button"
                                className="text-blue-300"
                                onClick={() => openTransfer(transfer)}
                              >
                                ویرایش
                              </button>
                              <button
                                type="button"
                                className="text-emerald-300"
                                onClick={() => actOnTransfer(transfer, "post")}
                              >
                                ثبت نهایی
                              </button>
                              <button
                                type="button"
                                className="text-rose-300"
                                onClick={() =>
                                  actOnTransfer(transfer, "delete")
                                }
                              >
                                حذف
                              </button>
                            </>
                          )}
                          {transfer.status === "posted" && (
                            <button
                              type="button"
                              className="text-amber-300"
                              onClick={() => actOnTransfer(transfer, "unpost")}
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

      {tab === "counts" && (
        <Section title="انبارگردانی" icon="🧮">
          {!activeCount && (
            <>
              <div className="flex flex-wrap items-end gap-2 mb-4">
                <Button
                  type="button"
                  variant="primary"
                  onClick={() =>
                    setCountForm({
                      warehouse: "",
                      date: new Date().toISOString().slice(0, 10),
                    })
                  }
                >
                  + انبارگردانی جدید
                </Button>
                {countForm && (
                  <>
                    <select
                      className={`${inp} !w-52`}
                      value={countForm.warehouse}
                      onChange={(e) =>
                        setCountForm({
                          ...countForm,
                          warehouse: e.target.value
                            ? Number(e.target.value)
                            : "",
                        })
                      }
                    >
                      <option value="">انبار پیش‌فرض</option>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                    <div className="!w-52">
                      <JalaliDatePicker
                        value={countForm.date}
                        onChange={(v) =>
                          setCountForm({ ...countForm, date: v })
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      variant="primary"
                      onClick={createCount}
                    >
                      ساخت برگهٔ شمارش
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setCountForm(null)}
                    >
                      انصراف
                    </Button>
                  </>
                )}
              </div>
              {counts.length === 0 ? (
                <EmptyState
                  icon="🧮"
                  title="انبارگردانی‌ای ثبت نشده است"
                  description="برگهٔ شمارش بسازید؛ موجودی سیستم برای همهٔ کالاها عکس گرفته می‌شود و مغایرت‌ها با سند اصلاحی خودکار تعدیل می‌شوند."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-400 text-right border-b border-slate-700">
                        <th className="py-2 px-2">شماره</th>
                        <th className="py-2 px-2">تاریخ</th>
                        <th className="py-2 px-2">انبار</th>
                        <th className="py-2 px-2">وضعیت</th>
                        <th className="py-2 px-2">عملیات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {counts.map((count) => (
                        <tr
                          key={count.id}
                          className="border-b border-slate-800 text-slate-200"
                        >
                          <td className="py-2 px-2">{fmt(count.number)}</td>
                          <td className="py-2 px-2">{toJalali(count.date)}</td>
                          <td className="py-2 px-2">{count.warehouse_name}</td>
                          <td className="py-2 px-2">
                            <span
                              className={
                                count.status === "applied"
                                  ? "text-emerald-300"
                                  : "text-amber-300"
                              }
                            >
                              {count.status_display}
                            </span>
                          </td>
                          <td className="py-2 px-2">
                            <div className="flex gap-2 text-xs">
                              <button
                                type="button"
                                className="text-blue-300"
                                onClick={() => openCount(count)}
                              >
                                {count.status === "applied"
                                  ? "مشاهده"
                                  : "شمارش"}
                              </button>
                              {count.status === "draft" && (
                                <button
                                  type="button"
                                  className="text-rose-300"
                                  onClick={async () => {
                                    try {
                                      await inventoryAPI.deleteStockCount(
                                        count.id,
                                      );
                                      setMessage("انبارگردانی حذف شد.");
                                      load();
                                    } catch {
                                      setMessage("خطا در حذف انبارگردانی");
                                    }
                                  }}
                                >
                                  حذف
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
            </>
          )}
          {activeCount && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <p className="text-sm text-slate-300">
                  انبارگردانی شماره {fmt(activeCount.number)} —{" "}
                  {activeCount.warehouse_name} — {toJalali(activeCount.date)}
                  {activeCount.status === "applied" && (
                    <span className="text-emerald-300"> (اعمال‌شده)</span>
                  )}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setActiveCount(null)}
                >
                  بازگشت به فهرست
                </Button>
              </div>
              <div className="overflow-x-auto mb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-400 text-right border-b border-slate-700">
                      <th className="py-2 px-2">کد</th>
                      <th className="py-2 px-2">کالا</th>
                      <th className="py-2 px-2">موجودی سیستم</th>
                      <th className="py-2 px-2">شمارش‌شده</th>
                      <th className="py-2 px-2">مغایرت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeCount.lines.map((line) => {
                      const raw = counted[line.id];
                      const variance =
                        raw === undefined || raw === ""
                          ? null
                          : Number(raw) - Number(line.system_qty);
                      return (
                        <tr
                          key={line.id}
                          className="border-b border-slate-800 text-slate-200"
                        >
                          <td className="py-2 px-2 font-mono text-slate-400">
                            {line.product_code}
                          </td>
                          <td className="py-2 px-2">{line.product_name}</td>
                          <td className="py-2 px-2">{fmt(line.system_qty)}</td>
                          <td className="py-2 px-2">
                            <input
                              className={`${inp} !w-28`}
                              inputMode="numeric"
                              disabled={activeCount.status === "applied"}
                              value={
                                activeCount.status === "applied"
                                  ? line.counted_qty === null
                                    ? ""
                                    : String(line.counted_qty)
                                  : (raw ?? "")
                              }
                              onChange={(e) =>
                                setCounted({
                                  ...counted,
                                  [line.id]: e.target.value.replace(
                                    /[^0-9.]/g,
                                    "",
                                  ),
                                })
                              }
                            />
                          </td>
                          <td className="py-2 px-2">
                            {activeCount.status === "applied" ? (
                              line.variance === null ? (
                                "—"
                              ) : (
                                <span
                                  className={
                                    Number(line.variance) === 0
                                      ? "text-slate-500"
                                      : "text-amber-300"
                                  }
                                >
                                  {fmt(line.variance)}
                                </span>
                              )
                            ) : variance === null ? (
                              "—"
                            ) : (
                              <span
                                className={
                                  variance === 0
                                    ? "text-slate-500"
                                    : "text-amber-300"
                                }
                              >
                                {fmt(variance)}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {activeCount.status === "draft" && (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={saveCountLines}
                  >
                    ذخیرهٔ شمارش
                  </Button>
                  <Button type="button" variant="primary" onClick={applyCount}>
                    اعمال و صدور سند تعدیل
                  </Button>
                </div>
              )}
            </div>
          )}
        </Section>
      )}

      {tab === "alerts" && (
        <div className="space-y-5">
          <Section title="تنظیمات انبار" icon="⚙️">
            <label className="flex items-center gap-3 text-sm text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 accent-blue-500"
                checked={!!invSettings?.block_negative_stock}
                onChange={(e) => toggleGuard(e.target.checked)}
              />
              جلوگیری از موجودی منفی — هیچ سند خروجی (فروش، حواله، اصلاحی) بیشتر
              از موجودی انبار ثبت نمی‌شود.
            </label>
          </Section>
          <Section title="رسیده به نقطهٔ سفارش — پیشنهاد خرید" icon="🛒">
            {!alerts || alerts.low_stock.length === 0 ? (
              <p className="text-sm text-slate-400">
                کالایی به نقطهٔ سفارش نرسیده است. (نقطهٔ سفارش را در تعریف کالا
                تنظیم کنید.)
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-400 text-right border-b border-slate-700">
                      <th className="py-2 px-2">کالا</th>
                      <th className="py-2 px-2">موجودی فعلی</th>
                      <th className="py-2 px-2">نقطه سفارش</th>
                      <th className="py-2 px-2">مقدار پیشنهادی خرید</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.low_stock.map((row) => (
                      <tr
                        key={row.product}
                        className="border-b border-slate-800 text-slate-200"
                      >
                        <td className="py-2 px-2">
                          {row.code} — {row.name}
                        </td>
                        <td className="py-2 px-2 text-amber-300">
                          {fmt(row.current_stock)} {row.unit}
                        </td>
                        <td className="py-2 px-2">{fmt(row.reorder_point)}</td>
                        <td className="py-2 px-2 text-emerald-300">
                          {fmt(row.suggested_qty)} {row.unit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
          <Section title="بچ‌های نزدیک به انقضا" icon="⏳">
            {!alerts || alerts.expiring.length === 0 ? (
              <p className="text-sm text-slate-400">
                بچی با انقضای گذشته یا در ۳۰ روز آینده ثبت نشده است.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-400 text-right border-b border-slate-700">
                      <th className="py-2 px-2">کالا</th>
                      <th className="py-2 px-2">شماره بچ</th>
                      <th className="py-2 px-2">تاریخ انقضا</th>
                      <th className="py-2 px-2">مقدار ورودی</th>
                      <th className="py-2 px-2">وضعیت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.expiring.map((row, idx) => (
                      <tr
                        key={idx}
                        className="border-b border-slate-800 text-slate-200"
                      >
                        <td className="py-2 px-2">
                          {row.code} — {row.name}
                        </td>
                        <td className="py-2 px-2">{row.batch_no || "—"}</td>
                        <td className="py-2 px-2">
                          {toJalali(row.expiry_date)}
                        </td>
                        <td className="py-2 px-2">{fmt(row.quantity_in)}</td>
                        <td className="py-2 px-2">
                          {row.expired ? (
                            <span className="text-rose-300">منقضی شده</span>
                          ) : (
                            <span className="text-amber-300">
                              نزدیک به انقضا
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
          <Section title="کالاهای راکد (بدون فروش در ۹۰ روز گذشته)" icon="🧊">
            {!alerts || alerts.dead_stock.length === 0 ? (
              <p className="text-sm text-slate-400">کالای راکدی پیدا نشد.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-400 text-right border-b border-slate-700">
                      <th className="py-2 px-2">کالا</th>
                      <th className="py-2 px-2">موجودی</th>
                      <th className="py-2 px-2">ارزش خواب سرمایه</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.dead_stock.map((row) => (
                      <tr
                        key={row.product}
                        className="border-b border-slate-800 text-slate-200"
                      >
                        <td className="py-2 px-2">
                          {row.code} — {row.name}
                        </td>
                        <td className="py-2 px-2">
                          {fmt(row.current_stock)} {row.unit}
                        </td>
                        <td className="py-2 px-2">{fmt(row.stock_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      )}

      {tab === "kardex" && (
        <Section title="کاردکس کالا" icon="🗂️">
          <div className="grid sm:grid-cols-3 gap-3 mb-4">
            <select
              className={inp}
              value={kardexProduct}
              onChange={(e) => {
                const value = e.target.value ? Number(e.target.value) : "";
                setKardexProduct(value);
                if (value !== "")
                  loadKardex(
                    value,
                    kardexWarehouse === "" ? undefined : kardexWarehouse,
                  );
              }}
            >
              <option value="">انتخاب کالا…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
            <select
              className={inp}
              value={kardexWarehouse}
              onChange={(e) => {
                const value = e.target.value ? Number(e.target.value) : "";
                setKardexWarehouse(value);
                if (kardexProduct !== "")
                  loadKardex(kardexProduct, value === "" ? undefined : value);
              }}
            >
              <option value="">همهٔ انبارها</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <div className="text-sm text-slate-300 self-center">
              {kardex && (
                <>
                  موجودی فعلی: {fmt(kardex.current_stock)} — ارزش:{" "}
                  {fmt(kardex.stock_value)}
                </>
              )}
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
                    <th className="py-2 px-2">بچ / انقضا</th>
                    <th className="py-2 px-2">مانده</th>
                    <th className="py-2 px-2">ماندهٔ ریالی</th>
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
                      <td className="py-2 px-2">
                        {row.batch_no || row.expiry_date
                          ? `${row.batch_no || ""}${
                              row.expiry_date
                                ? ` — انقضا: ${toJalali(row.expiry_date)}`
                                : ""
                            }`
                          : "—"}
                      </td>
                      <td className="py-2 px-2">{fmt(row.balance)}</td>
                      <td className="py-2 px-2">{fmt(row.balance_value)}</td>
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
