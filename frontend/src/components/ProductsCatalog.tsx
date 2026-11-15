import React, { useCallback, useEffect, useRef, useState } from "react";
import { formatMoney } from "../lib/money";
import { inventoryAPI } from "../services/api";
import type { CatalogProfile, Product } from "../services/api";
import PriceInput from "./PriceInput";
import { Button, ConfirmDialog, ErrorNotice, Modal, Spinner } from "./ui";
import { formatApiError } from "../utils/apiError";

/**
 * ProductsCatalog — the «کالاها و خدمات» page for stock trades
 * (فروشگاه، پمپ بنزین، بازرگانی، تولیدی).
 *
 * These businesses do not sell "services with commission": their
 * catalog IS the inventory product list. Entry asks only what a
 * product needs — code, barcode, name, unit, sale price — and stock
 * itself arrives through purchases and stock adjustments in
 * «انبار و خرید». Average cost and stock value are read-only facts
 * computed by the inventory engine.
 */

const fmt = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("fa-IR").format(Number(n) || 0);

const inp =
  "w-full bg-slate-700/50 border border-slate-600/50 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40";

const UNIT_SUGGESTIONS = [
  "عدد",
  "بسته",
  "کارتن",
  "کیلوگرم",
  "گرم",
  "لیتر",
  "متر",
  "جفت",
  "دست",
  "شانه",
  "بطری",
  "قوطی",
];

type ProductForm = {
  id?: number;
  code: string;
  name: string;
  barcode: string;
  unit: string;
  sale_price: number;
  shelf_location: string;
  reorder_point: number;
  is_active: boolean;
};

const ProductsCatalog = ({
  itemLabel,
  profile,
}: {
  itemLabel: string;
  profile: CatalogProfile;
}) => {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<ProductForm>({
    code: "",
    name: "",
    barcode: "",
    unit: profile.default_unit || "عدد",
    sale_price: 0,
    shelf_location: "",
    reorder_point: 0,
    is_active: true,
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const savingRef = useRef(false);

  const reload = useCallback(async () => {
    try {
      const res = await inventoryAPI.products();
      setProducts(res.data);
      setLoadError("");
    } catch (e) {
      setLoadError(formatApiError(e, "دریافت کالاها انجام نشد."));
    }
  }, []);

  useEffect(() => {
    reload();
    window.addEventListener("mohaseb:data-changed", reload);
    return () => window.removeEventListener("mohaseb:data-changed", reload);
  }, [reload]);

  const openAdd = () => {
    setForm({
      code: "",
      name: "",
      barcode: "",
      unit: profile.default_unit || "عدد",
      sale_price: 0,
      shelf_location: "",
      reorder_point: 0,
      is_active: true,
    });
    setFormError("");
    setModalOpen(true);
  };

  const openEdit = (p: Product) => {
    setForm({
      id: p.id,
      code: p.code,
      name: p.name,
      barcode: p.barcode || "",
      unit: p.unit,
      sale_price: Number(p.sale_price) || 0,
      shelf_location: p.shelf_location || "",
      reorder_point: Number(p.reorder_point) || 0,
      is_active: p.is_active,
    });
    setFormError("");
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setFormError("");
    try {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        barcode: form.barcode.trim(),
        unit: form.unit.trim() || profile.default_unit || "عدد",
        sale_price: form.sale_price,
        shelf_location: form.shelf_location.trim(),
        reorder_point: form.reorder_point,
        is_active: form.is_active,
      };
      if (form.id) {
        await inventoryAPI.updateProduct(form.id, payload);
      } else {
        await inventoryAPI.createProduct(payload);
      }
      setModalOpen(false);
      await reload();
    } catch (e) {
      setFormError(formatApiError(e, "ذخیره‌سازی کالا انجام نشد."));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await inventoryAPI.deleteProduct(deleteTarget.id);
      setDeleteTarget(null);
      await reload();
    } catch (e) {
      setDeleteError(formatApiError(e, "حذف کالا انجام نشد."));
    } finally {
      setDeleting(false);
    }
  };

  const set = (k: keyof ProductForm, v: string | number | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">📦 {itemLabel}</h2>
          <p className="text-slate-400 text-sm mt-1">
            مدیریت {itemLabel}؛ موجودی از خریدها و گردش انبار به‌روز می‌شود
          </p>
        </div>
        <button
          onClick={openAdd}
          className="inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-all duration-200 active:scale-[0.98] bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-lg shadow-blue-500/25 px-5 py-2.5 text-sm"
        >
          {`+ افزودن ${itemLabel}`}
        </button>
      </div>

      {loadError && (
        <div>
          <ErrorNotice message={loadError} />
          <Button variant="ghost" onClick={reload}>
            تلاش دوباره
          </Button>
        </div>
      )}

      {products === null && !loadError ? (
        <Spinner size="lg" />
      ) : products !== null && products.length === 0 ? (
        <div className="text-center py-16 bg-slate-800/50 border border-slate-700/50 rounded-2xl">
          <p className="text-4xl mb-3">📦</p>
          <p className="text-slate-300 font-medium text-lg">
            {itemLabel} تعریف نشده
          </p>
          <p className="text-slate-500 text-sm mt-1">
            با کلیک روی افزودن {itemLabel}، اولین قلم را ایجاد کنید
          </p>
        </div>
      ) : (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700/50">
                <th className="py-3 px-3 text-right font-medium">کد</th>
                <th className="py-3 px-3 text-right font-medium">بارکد</th>
                <th className="py-3 px-3 text-right font-medium">
                  نام {itemLabel}
                </th>
                <th className="py-3 px-3 text-right font-medium">واحد</th>
                <th className="py-3 px-3 text-right font-medium">موجودی</th>
                <th className="py-3 px-3 text-right font-medium">
                  بهای میانگین
                </th>
                <th className="py-3 px-3 text-right font-medium">
                  ارزش موجودی
                </th>
                <th className="py-3 px-3 text-right font-medium">قیمت فروش</th>
                <th className="py-3 px-3 text-right font-medium">وضعیت</th>
                <th className="py-3 px-3 text-right font-medium">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {(products ?? []).map((p) => (
                <tr
                  key={p.id}
                  className={`border-b border-slate-700/30 ${p.is_active ? "" : "opacity-50"}`}
                >
                  <td className="py-2.5 px-3 text-slate-300">{p.code}</td>
                  <td className="py-2.5 px-3 text-slate-400">
                    {p.barcode || "—"}
                  </td>
                  <td className="py-2.5 px-3 text-white font-medium">
                    {p.name}
                  </td>
                  <td className="py-2.5 px-3 text-slate-300">{p.unit}</td>
                  <td className="py-2.5 px-3 text-slate-200">
                    {fmt(p.current_stock)}
                  </td>
                  <td className="py-2.5 px-3 text-slate-300">
                    {fmt(p.average_cost)}
                  </td>
                  <td className="py-2.5 px-3 text-slate-300">
                    {fmt(p.stock_value)}
                  </td>
                  <td className="py-2.5 px-3 text-slate-200">
                    {formatMoney(p.sale_price)}
                  </td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full border ${p.is_active ? "bg-green-500/10 text-green-400 border-green-500/30" : "bg-slate-500/10 text-slate-400 border-slate-500/30"}`}
                    >
                      {p.is_active ? "فعال" : "غیرفعال"}
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => openEdit(p)}
                        className="text-xs px-2.5 py-1 rounded-lg bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 border border-indigo-500/20"
                      >
                        ویرایش
                      </button>
                      <button
                        onClick={() => {
                          setDeleteError("");
                          setDeleteTarget(p);
                        }}
                        className="text-xs px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20"
                      >
                        حذف
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <Modal
          isOpen
          onClose={() => setModalOpen(false)}
          title={form.id ? `ویرایش ${itemLabel}` : `افزودن ${itemLabel} جدید`}
          size="md"
          dismissible={!saving}
        >
          <ErrorNotice message={formError} />
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">کد کالا</label>
                <input
                  className={inp}
                  value={form.code}
                  onChange={(e) => set("code", e.target.value)}
                  placeholder="خالی = کد خودکار بعدی"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">بارکد</label>
                <input
                  className={inp}
                  value={form.barcode}
                  onChange={(e) => set("barcode", e.target.value)}
                  placeholder="بارکد کالا"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">
                نام {itemLabel} *
              </label>
              <input
                className={inp}
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder={`نام ${itemLabel}`}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">واحد</label>
                <input
                  className={inp}
                  value={form.unit}
                  onChange={(e) => set("unit", e.target.value)}
                  list="product-unit-suggestions"
                />
                <datalist id="product-unit-suggestions">
                  {UNIT_SUGGESTIONS.map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">
                  قیمت فروش پیش‌فرض
                </label>
                <PriceInput
                  value={form.sale_price}
                  onChange={(v) => set("sale_price", v)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">
                  مکان در انبار (قفسه)
                </label>
                <input
                  className={inp}
                  value={form.shelf_location}
                  onChange={(e) => set("shelf_location", e.target.value)}
                  placeholder="مثلاً راهرو ۲، قفسه ۵"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">
                  نقطه سفارش (هشدار اتمام موجودی)
                </label>
                <input
                  className={inp}
                  type="number"
                  min={0}
                  value={form.reorder_point || ""}
                  onChange={(e) =>
                    set("reorder_point", Number(e.target.value) || 0)
                  }
                />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => set("is_active", !form.is_active)}
                aria-pressed={form.is_active}
                aria-label={`فعال‌سازی ${itemLabel}`}
                className={`relative w-11 h-6 rounded-full transition-all ${form.is_active ? "bg-green-600" : "bg-slate-600"}`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${form.is_active ? "right-0.5" : "right-5"}`}
                />
              </button>
              <span className="text-slate-300 text-sm">
                {form.is_active ? `${itemLabel} فعال` : `${itemLabel} غیرفعال`}
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              موجودی و بهای میانگین از خریدها و گردش انبار محاسبه می‌شود و اینجا
              فقط نمایش داده می‌شود.
            </p>
          </div>
          <div className="flex gap-3 justify-end p-5 border-t border-slate-700/50">
            <Button
              variant="ghost"
              onClick={() => setModalOpen(false)}
              disabled={saving}
            >
              انصراف
            </Button>
            <Button variant="primary" onClick={handleSave} loading={saving}>
              {form.id ? "ذخیره تغییرات" : "افزودن"}
            </Button>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={`حذف ${itemLabel}`}
        message={`آیا از حذف «${deleteTarget?.name}» اطمینان دارید؟`}
        loading={deleting}
      />
      {deleteError && <ErrorNotice message={deleteError} />}
    </div>
  );
};

export default ProductsCatalog;
