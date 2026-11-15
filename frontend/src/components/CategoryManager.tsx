import React, { useMemo, useState } from "react";
import { inventoryAPI } from "../services/api";
import type { ProductCategory } from "../services/api";
import { Button, ConfirmDialog, Modal } from "./ui";
import { formatApiError } from "../utils/apiError";

/**
 * Category tree helpers + manager (phase 2.7).
 *
 * A category tree is how a trade organises its stock: a shop thinks
 * «نوشیدنی‌ها ← نوشابه گازدار ← کوکاکولا» — group, kind, brand. The
 * tree is free-form (any depth), seeded per trade, and fully editable.
 */

export type FlatCategory = ProductCategory & { depth: number };

export const flattenCategories = (
  categories: ProductCategory[],
): FlatCategory[] => {
  const byParent = new Map<number | null, ProductCategory[]>();
  for (const category of categories) {
    const key = category.parent ?? null;
    byParent.set(key, [...(byParent.get(key) ?? []), category]);
  }
  const rows: FlatCategory[] = [];
  const walk = (parent: number | null, depth: number) => {
    for (const category of byParent.get(parent) ?? []) {
      rows.push({ ...category, depth });
      walk(category.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
};

const inp =
  "w-full bg-slate-700/50 border border-slate-600/50 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40";

export const CategoryManager = ({
  open,
  onClose,
  categories,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  categories: ProductCategory[];
  onChanged: () => void;
}) => {
  const rows = useMemo(() => flattenCategories(categories), [categories]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newRoot, setNewRoot] = useState("");
  const [childFor, setChildFor] = useState<number | null>(null);
  const [childName, setChildName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ProductCategory | null>(
    null,
  );
  const [seedMsg, setSeedMsg] = useState("");

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(formatApiError(e, "انجام عملیات دسته‌بندی نشد."));
    } finally {
      setBusy(false);
    }
  };

  const addRoot = () =>
    run(async () => {
      await inventoryAPI.createCategory({ name: newRoot.trim() });
      setNewRoot("");
    });

  const addChild = (parent: number) =>
    run(async () => {
      await inventoryAPI.createCategory({
        name: childName.trim(),
        parent,
      });
      setChildFor(null);
      setChildName("");
    });

  const rename = (id: number) =>
    run(async () => {
      await inventoryAPI.updateCategory(id, { name: editName.trim() });
      setEditingId(null);
    });

  const seed = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await inventoryAPI.seedCategories();
      const created = Number((res.data as any)?.created ?? 0);
      setSeedMsg(
        created > 0
          ? `${created.toLocaleString("fa-IR")} دستهٔ پیش‌فرض شغل ساخته شد.`
          : "دسته‌های پیش‌فرض شغل از قبل وجود دارند.",
      );
      onChanged();
    } catch (e) {
      setError(formatApiError(e, "ساخت دسته‌های پیش‌فرض انجام نشد."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="🏷️ دسته‌بندی کالاها"
      size="lg"
    >
      <div className="space-y-4">
        <p className="text-sm leading-6 text-slate-400">
          کالاها را در درخت دسته‌ها بچینید: دستهٔ کلی (مثل «نوشیدنی‌ها»)،
          زیردسته (مثل «نوشابه گازدار») و برند (مثل «کوکاکولا»). هر کالا در فرم
          ویرایشش به یک دسته وصل می‌شود و در فهرست کالاها می‌توانید بر اساس هر
          سطحی فیلتر کنید.
        </p>

        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <input
            className={inp}
            value={newRoot}
            onChange={(e) => setNewRoot(e.target.value)}
            placeholder="نام دستهٔ کلی جدید — مثلاً نوشیدنی‌ها"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newRoot.trim()) void addRoot();
            }}
          />
          <Button onClick={addRoot} disabled={busy || !newRoot.trim()}>
            + افزودن دسته
          </Button>
        </div>

        <div className="max-h-[46vh] space-y-1 overflow-y-auto pr-1">
          {rows.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-500">
              هنوز دسته‌ای ساخته نشده است؛ از بالا شروع کنید یا دسته‌های پیش‌فرض
              شغل را بسازید.
            </p>
          )}
          {rows.map((row) => (
            <div key={row.id} style={{ marginRight: row.depth * 22 }}>
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-700/40 bg-slate-800/60 px-3 py-2">
                <span aria-hidden="true">{row.depth === 0 ? "🗂️" : "↳"}</span>
                {editingId === row.id ? (
                  <>
                    <input
                      className={`${inp} max-w-[220px]`}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && editName.trim())
                          void rename(row.id);
                      }}
                    />
                    <button
                      type="button"
                      disabled={busy || !editName.trim()}
                      onClick={() => void rename(row.id)}
                      className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs text-white disabled:opacity-50"
                    >
                      ذخیره
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded-lg border border-slate-600 px-2.5 py-1 text-xs text-slate-300"
                    >
                      انصراف
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-medium text-white">
                      {row.name}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {row.products_count.toLocaleString("fa-IR")} کالا
                      {row.children_count > 0
                        ? ` · ${row.children_count.toLocaleString("fa-IR")} زیردسته`
                        : ""}
                    </span>
                    <span className="flex-1" />
                    <button
                      type="button"
                      onClick={() => {
                        setChildFor(row.id);
                        setChildName("");
                      }}
                      className="rounded-lg bg-blue-500/10 px-2.5 py-1 text-xs text-blue-300 border border-blue-500/20 hover:bg-blue-500/20"
                    >
                      + زیردسته / برند
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(row.id);
                        setEditName(row.name);
                      }}
                      className="rounded-lg bg-indigo-500/10 px-2.5 py-1 text-xs text-indigo-300 border border-indigo-500/20 hover:bg-indigo-500/20"
                    >
                      ویرایش نام
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(row)}
                      className="rounded-lg bg-red-500/10 px-2.5 py-1 text-xs text-red-300 border border-red-500/20 hover:bg-red-500/20"
                    >
                      حذف
                    </button>
                  </>
                )}
              </div>
              {childFor === row.id && (
                <div className="mt-1 flex gap-2" style={{ marginRight: 22 }}>
                  <input
                    className={inp}
                    value={childName}
                    onChange={(e) => setChildName(e.target.value)}
                    placeholder="نام زیردسته یا برند — مثلاً کوکاکولا"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && childName.trim())
                        void addChild(row.id);
                    }}
                  />
                  <Button
                    onClick={() => void addChild(row.id)}
                    disabled={busy || !childName.trim()}
                  >
                    افزودن
                  </Button>
                  <Button variant="ghost" onClick={() => setChildFor(null)}>
                    انصراف
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-700/40 pt-3">
          <Button variant="ghost" onClick={seed} disabled={busy}>
            🌱 ساخت دسته‌های پیش‌فرض شغل
          </Button>
          {seedMsg && (
            <span className="text-xs text-emerald-300">{seedMsg}</span>
          )}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            بستن
          </Button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() =>
          run(async () => {
            if (deleteTarget)
              await inventoryAPI.deleteCategory(deleteTarget.id);
            setDeleteTarget(null);
          })
        }
        title="حذف دسته‌بندی"
        message={`«${deleteTarget?.name ?? ""}» حذف شود؟ کالاهای این دسته حذف نمی‌شوند؛ فقط بدون دسته می‌مانند.${
          (deleteTarget?.children_count ?? 0) > 0
            ? " این دسته زیردسته دارد و تا وقتی زیردسته‌ها جابه‌جا یا حذف نشوند، حذف نمی‌شود."
            : ""
        }`}
      />
    </Modal>
  );
};
