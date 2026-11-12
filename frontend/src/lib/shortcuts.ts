/**
 * User-editable keyboard shortcuts (Settings → میانبرهای صفحه‌کلید).
 *
 * Stored per user/device in localStorage (`mohaseb:shortcuts:v1`) as
 * overrides over the defaults below; Layout listens for the
 * `mohaseb:shortcuts-changed` event so edits apply immediately.
 *
 * A combo is stored like "Alt+Shift+N": modifiers in Ctrl/Alt/Shift/Meta
 * order plus the layout-independent `KeyboardEvent.code` key name without
 * its Key/Digit prefix ("KeyN" → "N", "Digit3" → "3"). Matching by code
 * keeps shortcuts working with a Persian keyboard layout, like Alt+N did.
 */

export type ShortcutAction = {
  id: string;
  label: string;
  defaultCombo: string;
};

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: "quick_invoice", label: "فاکتور سریع", defaultCombo: "Alt+N" },
  {
    id: "new_invoice",
    label: "فاکتور جدید (فرم کامل)",
    defaultCombo: "Alt+Shift+N",
  },
  { id: "new_customer", label: "مشتری جدید", defaultCombo: "Alt+Shift+C" },
  { id: "new_service", label: "خدمت جدید", defaultCombo: "" },
  { id: "new_expense", label: "هزینهٔ جدید", defaultCombo: "" },
];

const STORAGE_KEY = "mohaseb:shortcuts:v1";
export const SHORTCUTS_CHANGED_EVENT = "mohaseb:shortcuts-changed";

export type ShortcutMap = Record<string, string>;

export function loadShortcuts(): ShortcutMap {
  const map: ShortcutMap = {};
  for (const a of SHORTCUT_ACTIONS) map[a.id] = a.defaultCombo;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const a of SHORTCUT_ACTIONS) {
        if (typeof parsed[a.id] === "string")
          map[a.id] = parsed[a.id] as string;
      }
    }
  } catch {
    /* corrupted storage → defaults */
  }
  return map;
}

export function saveShortcuts(map: ShortcutMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event(SHORTCUTS_CHANGED_EVENT));
}

export function resetShortcuts(): ShortcutMap {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  const map = loadShortcuts();
  window.dispatchEvent(new Event(SHORTCUTS_CHANGED_EVENT));
  return map;
}

/** Build the combo string for a keydown, or null if it is not a combo
 *  (a bare modifier, or a plain key with no modifier — plain keys would
 *  hijack typing, so a shortcut always needs Ctrl/Alt/Meta). */
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return null;
  if (!e.ctrlKey && !e.altKey && !e.metaKey) return null;
  let key = e.code;
  if (key.startsWith("Key")) key = key.slice(3);
  else if (key.startsWith("Digit")) key = key.slice(5);
  if (!key) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");
  parts.push(key);
  return parts.join("+");
}

export function eventMatchesCombo(e: KeyboardEvent, combo: string): boolean {
  if (!combo) return false;
  return comboFromEvent(e) === combo;
}

/** First action (other than `exceptId`) already using `combo`, if any. */
export function findConflict(
  map: ShortcutMap,
  combo: string,
  exceptId: string,
): ShortcutAction | null {
  if (!combo) return null;
  for (const a of SHORTCUT_ACTIONS) {
    if (a.id !== exceptId && map[a.id] === combo) return a;
  }
  return null;
}
