import React, { useEffect, useState } from "react";
import {
  SHORTCUT_ACTIONS,
  comboFromEvent,
  findConflict,
  loadShortcuts,
  resetShortcuts,
  saveShortcuts,
} from "../../lib/shortcuts";
import type { ShortcutMap } from "../../lib/shortcuts";
import { Section } from "./shared";

// ─── Keyboard shortcuts editor ─────────────────────────────────────
// Per-user shortcuts (localStorage — see lib/shortcuts). Click «تغییر»
// and press the desired combo; Esc cancels. A combo must include
// Ctrl/Alt/Meta so plain typing is never hijacked; assigning a combo
// that another action already uses is rejected with a message.
export const ShortcutsSection: React.FC = () => {
  const [map, setMap] = useState<ShortcutMap>(() => loadShortcuts());
  const [capturing, setCapturing] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!capturing) return undefined;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturing(null);
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return; // modifier-only so far — keep waiting
      const conflict = findConflict(map, combo, capturing);
      if (conflict) {
        setMsg(`⚠️ این میانبر قبلاً برای «${conflict.label}» ثبت شده است`);
        return;
      }
      const next = { ...map, [capturing]: combo };
      setMap(next);
      saveShortcuts(next);
      setCapturing(null);
      setMsg("✅ میانبر ذخیره شد و همین حالا فعال است");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, map]);

  const clearOne = (id: string) => {
    const next = { ...map, [id]: "" };
    setMap(next);
    saveShortcuts(next);
    setMsg("میانبر حذف شد");
  };

  return (
    <Section title="میانبرهای صفحه‌کلید" icon="⌨️">
      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-slate-400">
          برای تغییر، روی «تغییر» بزنید و ترکیب کلید دلخواه را فشار دهید (Esc =
          لغو). میانبر باید دست‌کم یکی از کلیدهای Ctrl یا Alt را داشته باشد تا
          با تایپ عادی تداخل نکند. میانبرها برای کاربر فعلی روی همین سیستم و
          مرورگر ذخیره می‌شوند و بلافاصله فعال‌اند.
        </p>
        {SHORTCUT_ACTIONS.map((a) => (
          <div
            key={a.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-800/40 px-4 py-3"
          >
            <span className="flex-1 text-sm text-slate-200">{a.label}</span>
            {capturing === a.id ? (
              <span className="animate-pulse text-xs text-amber-300">
                ⌨️ کلیدها را فشار دهید… (Esc = لغو)
              </span>
            ) : (
              <kbd
                className="rounded-lg border border-slate-600 bg-slate-900 px-2.5 py-1 text-xs text-slate-200"
                dir="ltr"
              >
                {map[a.id] || "تعریف نشده"}
              </kbd>
            )}
            <button
              type="button"
              onClick={() => {
                setMsg("");
                setCapturing(a.id);
              }}
              className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-300 transition-all hover:bg-blue-500/20"
            >
              ✏️ تغییر
            </button>
            {map[a.id] && capturing !== a.id && (
              <button
                type="button"
                onClick={() => clearOne(a.id)}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 transition-all hover:bg-red-500/20"
              >
                🗑 حذف
              </button>
            )}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            onClick={() => {
              setMap(resetShortcuts());
              setMsg("میانبرها به پیش‌فرض برگشتند");
            }}
            className="rounded-lg border border-slate-600 bg-slate-700/40 px-3 py-1.5 text-xs text-slate-200 transition-all hover:bg-slate-700/70"
          >
            ↩️ بازنشانی همه به پیش‌فرض
          </button>
          {msg && <span className="text-xs text-slate-300">{msg}</span>}
        </div>
      </div>
    </Section>
  );
};
