import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import type { ReactNode } from "react";
import ReactDOM from "react-dom";

export type SelectOption = {
  value: string | number;
  label: ReactNode;
  sub?: string;
  disabled?: boolean;
};

type SearchableSelectProps = {
  value?: string | number | null;
  onChange: (value: string | number) => void;
  options?: SelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  emptyText?: string;
  clearable?: boolean;
  creatable?: boolean;
  createFirst?: boolean;
  onCreateOption?: (label: string) => Promise<SelectOption | null | undefined>;
  createLabel?: (inputValue: string) => ReactNode;
  creating?: boolean;
};

/**
 * SearchableSelect — dropdown with search + optional "create new" support
 *
 * Props:
 *  - value              : selected value (string | number)
 *  - onChange           : (value) => void
 *  - options            : [{value, label, sub?, disabled?}]
 *  - placeholder        : trigger placeholder
 *  - searchPlaceholder  : search input placeholder
 *  - disabled           : boolean
 *  - required           : boolean
 *  - className          : extra class for wrapper div
 *  - emptyText          : text shown when no results
 *  - clearable          : show clear button (default true)
 *  - creatable          : allow creating new options (default false)
 *  - createFirst        : show the create entry at the TOP of the list (also
 *                         with an empty search) and make it the default
 *                         Enter target while typing (default false)
 *  - onCreateOption     : async (label: string) => {value, label} — called when user creates
 *  - createLabel        : (inputValue: string) => string — custom create button label
 *  - creating           : boolean — shows a spinner while create is in progress
 */
const SearchableSelect = ({
  value,
  onChange,
  options = [],
  placeholder = "— انتخاب کنید —",
  searchPlaceholder = "جستجو...",
  disabled = false,
  required = false,
  className = "",
  emptyText = "موردی یافت نشد",
  clearable = true,
  creatable = false,
  createFirst = false,
  onCreateOption,
  createLabel,
  creating = false,
}: SearchableSelectProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIdx, setActiveIdx] = useState(-1);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, openUp: false });
  const [localCreating, setLocalCreating] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);

  const isCreating = creating || localCreating;

  // ─── Filtered options ────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter(
      (o) =>
        String(o.label).toLowerCase().includes(q) ||
        String(o.sub || "")
          .toLowerCase()
          .includes(q) ||
        String(o.value).toLowerCase().includes(q),
    );
  }, [options, search]);

  // ─── Show "create" option? ───────────────────────────────────
  const trimmedSearch = search.trim();
  const exactMatch = options.some(
    (o) => String(o.label).toLowerCase() === trimmedSearch.toLowerCase(),
  );
  const showCreate = creatable && trimmedSearch && !exactMatch;
  // With createFirst, the create entry is also offered with an empty
  // search (it opens the creator with an empty label).
  const showCreateEntry =
    showCreate || (creatable && createFirst && !trimmedSearch);
  // Visual index offset: with createFirst the create entry is item 0
  // and the options shift by one.
  const createOffset = createFirst && showCreateEntry ? 1 : 0;

  // ─── Selected option ─────────────────────────────────────────
  const selectedOption = useMemo(
    () => options.find((o) => String(o.value) === String(value)),
    [options, value],
  );

  // ─── Position calc ───────────────────────────────────────────
  const reposition = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const DROPDOWN_MAX_H = 320;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp =
      spaceBelow < DROPDOWN_MAX_H + 10 && rect.top > DROPDOWN_MAX_H;
    const clampedLeft = Math.max(
      8,
      Math.min(rect.left, window.innerWidth - rect.width - 8),
    );
    setPos({
      top: openUp ? rect.top - 8 : rect.bottom + 6,
      left: clampedLeft,
      width: rect.width,
      openUp,
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [isOpen, reposition]);

  // ─── Focus search on open ────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchRef.current?.focus(), 50);
      setSearch("");
      setActiveIdx(-1);
    }
  }, [isOpen]);

  // ─── Close on outside click ──────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        !document
          .getElementById("ss-portal-dropdown")
          ?.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  // ─── Scroll active item into view ────────────────────────────
  useEffect(() => {
    if (activeItemRef.current) {
      activeItemRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [activeIdx]);

  // ─── Create new option ───────────────────────────────────────
  const handleCreate = useCallback(async () => {
    if (!onCreateOption || isCreating) return;
    if (!trimmedSearch && !createFirst) return;
    // A creator may open a modal; the dropdown portal must not cover it.
    setIsOpen(false);
    setLocalCreating(true);
    try {
      const created = await onCreateOption(trimmedSearch);
      if (created) {
        onChange(created.value);
        setIsOpen(false);
        setSearch("");
      }
    } catch {
      // error handled by parent
    } finally {
      setLocalCreating(false);
    }
  }, [trimmedSearch, onCreateOption, onChange, isCreating, createFirst]);

  // ─── Keyboard navigation ─────────────────────────────────────
  const totalItems = filtered.length + (showCreateEntry ? 1 : 0);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      setIsOpen(false);
      containerRef.current?.focus();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, totalItems - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx < 0) return;
      if (createOffset === 1 && activeIdx === 0) {
        handleCreate();
        return;
      }
      const optIdx = activeIdx - createOffset;
      if (optIdx >= 0 && optIdx < filtered.length && filtered[optIdx]) {
        handleSelect(filtered[optIdx]);
      } else if (
        createOffset === 0 &&
        activeIdx === filtered.length &&
        showCreateEntry
      ) {
        handleCreate();
      }
    }
  };

  // ─── Select existing option ──────────────────────────────────
  const handleSelect = (opt: SelectOption) => {
    if (opt.disabled) return;
    onChange(opt.value);
    setIsOpen(false);
    setSearch("");
  };

  // ─── Create entry (top with createFirst, bottom otherwise) ───
  const createIsActive = createFirst
    ? activeIdx === 0
    : activeIdx === filtered.length;
  const createButton = showCreateEntry ? (
    <button
      ref={createIsActive ? activeItemRef : null}
      type="button"
      onClick={handleCreate}
      disabled={isCreating}
      className={`
        w-full px-4 py-3 text-right text-sm flex items-center gap-3 transition-all
        ${
          createFirst
            ? "border-b border-slate-700/40 mb-1"
            : "border-t border-slate-700/40 mt-1"
        }
        ${
          createIsActive
            ? "bg-emerald-500/15 text-emerald-300"
            : "text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
        }
        ${isCreating ? "opacity-60 cursor-wait" : "cursor-pointer"}
      `}
    >
      {isCreating ? (
        <>
          <div className="w-4 h-4 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin shrink-0" />
          <span>در حال ذخیره...</span>
        </>
      ) : (
        <>
          <span className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-xs shrink-0">
            +
          </span>
          <span className="flex-1 min-w-0">
            {createLabel ? (
              createLabel(trimmedSearch)
            ) : trimmedSearch ? (
              <>
                <span className="text-slate-400">افزودن: </span>
                <span className="font-medium">«{trimmedSearch}»</span>
              </>
            ) : (
              <span className="font-medium">افزودن جدید</span>
            )}
          </span>
          <span className="text-[10px] text-emerald-600 shrink-0">Enter ↵</span>
        </>
      )}
    </button>
  ) : null;

  // ─── Dropdown portal ─────────────────────────────────────────
  const dropdown = isOpen
    ? ReactDOM.createPortal(
        <div
          id="ss-portal-dropdown"
          style={{
            position: "fixed",
            top: pos.openUp ? undefined : pos.top,
            bottom: pos.openUp ? window.innerHeight - pos.top : undefined,
            left: pos.left,
            width: pos.width,
            zIndex: 99999,
          }}
          className="animate-fade-in"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="bg-slate-800 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden">
            {/* Search box */}
            <div className="p-2 border-b border-slate-700/50">
              <div className="relative">
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm pointer-events-none">
                  🔍
                </span>
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setActiveIdx(0);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={searchPlaceholder}
                  className="w-full pr-9 pl-3 py-2 bg-slate-700/60 border border-slate-600/40 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setActiveIdx(-1);
                      searchRef.current?.focus();
                    }}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Options list */}
            <div ref={listRef} className="overflow-y-auto max-h-[240px] py-1">
              {/* Create entry first (createFirst) */}
              {createFirst && createButton}

              {/* Clear option */}
              {clearable &&
                value !== "" &&
                value !== null &&
                value !== undefined && (
                  <button
                    type="button"
                    onClick={() => {
                      onChange("");
                      setIsOpen(false);
                      setSearch("");
                    }}
                    className="w-full px-4 py-2 text-right text-xs text-slate-500 hover:bg-slate-700/40 hover:text-slate-300 transition-colors flex items-center gap-2"
                  >
                    <span className="text-red-400/60">✕</span>
                    پاک کردن انتخاب
                  </button>
                )}

              {/* No results */}
              {filtered.length === 0 && !showCreateEntry && (
                <div className="px-4 py-6 text-center text-slate-500 text-sm">
                  <div className="text-2xl mb-1">🔍</div>
                  {emptyText}
                </div>
              )}

              {/* Existing options */}
              {filtered.map((opt, idx) => {
                const isSelected = String(opt.value) === String(value);
                const isActive = idx + createOffset === activeIdx;
                return (
                  <button
                    key={opt.value}
                    ref={isActive ? activeItemRef : null}
                    type="button"
                    onClick={() => handleSelect(opt)}
                    disabled={opt.disabled}
                    className={`
                      w-full px-4 py-2.5 text-right text-sm flex items-center gap-3 transition-all
                      ${opt.disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}
                      ${
                        isSelected
                          ? "bg-blue-600/20 text-blue-300 border-r-2 border-blue-500"
                          : isActive
                            ? "bg-slate-700/60 text-white"
                            : "text-slate-300 hover:bg-slate-700/40 hover:text-white"
                      }
                    `}
                  >
                    <span
                      className={`shrink-0 w-4 h-4 rounded-full border flex items-center justify-center text-[9px] transition-all ${
                        isSelected
                          ? "bg-blue-500 border-blue-500 text-white"
                          : "border-slate-600"
                      }`}
                    >
                      {isSelected && "✓"}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block truncate">{opt.label}</span>
                      {opt.sub && (
                        <span className="block text-[10px] text-slate-500 truncate">
                          {opt.sub}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}

              {/* Create entry last (default) */}
              {!createFirst && createButton}
            </div>

            {/* Footer */}
            {(filtered.length > 0 || showCreateEntry) && (
              <div className="border-t border-slate-700/40 px-3 py-1.5 flex items-center justify-between">
                <span className="text-[10px] text-slate-600">
                  {filtered.length} مورد{search ? ` از ${options.length}` : ""}
                  {showCreateEntry && " + جدید"}
                </span>
                <span className="text-[10px] text-slate-600">
                  ↑↓ جابجایی · Enter انتخاب
                </span>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {/* Trigger */}
      <div
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && setIsOpen((o) => !o)}
        onKeyDown={handleKeyDown}
        className={`
          w-full flex items-center justify-between gap-2
          px-3 py-2.5 rounded-xl cursor-pointer select-none
          bg-slate-700/50 border transition-all text-sm
          ${disabled ? "opacity-50 cursor-not-allowed" : ""}
          ${
            isOpen
              ? "border-blue-500/60 ring-2 ring-blue-500/20"
              : "border-slate-600/50 hover:border-slate-500/70"
          }
        `}
      >
        <span
          className={`flex-1 min-w-0 truncate text-right ${selectedOption ? "text-white" : "text-slate-500"}`}
        >
          {selectedOption ? (
            <span className="flex items-center gap-2 min-w-0">
              <span className="truncate">{selectedOption.label}</span>
              {selectedOption.sub && (
                <span className="text-xs text-slate-400 shrink-0">
                  {selectedOption.sub}
                </span>
              )}
            </span>
          ) : (
            placeholder
          )}
        </span>

        <div className="flex items-center gap-1 shrink-0">
          {clearable && selectedOption && !required && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.stopPropagation();
                  onChange("");
                }
              }}
              className="w-5 h-5 rounded-md flex items-center justify-center text-slate-500 hover:text-slate-300 hover:bg-slate-600/50 transition-all text-[10px]"
              title="پاک کردن"
            >
              ✕
            </span>
          )}
          <svg
            className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </div>

      {/* Native hidden input for required validation */}
      {required && (
        <input
          type="text"
          required
          value={value ?? ""}
          readOnly
          tabIndex={-1}
          style={{
            position: "absolute",
            opacity: 0,
            width: 0,
            height: 0,
            pointerEvents: "none",
          }}
        />
      )}

      {dropdown}
    </div>
  );
};

export default SearchableSelect;
