import React, { useState, useEffect, useRef, useCallback } from "react";
import type { RefObject } from "react";
import ReactDOM from "react-dom";
import {
  toJalali,
  toGregorianStr,
  toGregorian,
  currentJalaliYear,
} from "../utils/persian";

type JalaliParts3 = { jy: number; jm: number; jd: number };

const MONTH_NAMES = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

const WEEKDAYS_FULL = [
  "شنبه",
  "یکشنبه",
  "دوشنبه",
  "سه‌شنبه",
  "چهارشنبه",
  "پنجشنبه",
  "جمعه",
];
const WEEKDAYS = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

const isLeapYear = (jy: number) =>
  [1, 5, 9, 13, 17, 22, 26, 30].includes(jy % 33);

const getDaysInMonth = (jy: number, jm: number) => {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeapYear(jy) ? 30 : 29;
};

const getFirstDayOfMonthWeekday = (jy: number, jm: number) => {
  const { gy, gm, gd } = toGregorian(jy, jm, 1);
  const gDay = new Date(gy, gm - 1, gd).getDay();
  return (gDay + 1) % 7;
};

const getTodayJalali = (): JalaliParts3 | null => {
  const shamsiStr = toJalali(new Date(), "short");
  const parts = shamsiStr.split("/");
  if (parts.length === 3) {
    return {
      jy: parseInt(parts[0], 10),
      jm: parseInt(parts[1], 10),
      jd: parseInt(parts[2], 10),
    };
  }
  return null;
};

// ─── Calendar Dropdown (rendered via Portal) ─────────────────
type CalendarDropdownProps = {
  anchorRef: RefObject<HTMLDivElement | null>;
  viewYear: number;
  viewMonth: number;
  selectedParts: JalaliParts3 | null;
  todayParts: JalaliParts3 | null;
  onDaySelect: (jy: number, jm: number, jd: number) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onYearChange: (year: number) => void;
  onMonthChange: (month: number) => void;
  onToday: () => void;
  onClose: () => void;
};

const CalendarDropdown = ({
  anchorRef,
  viewYear,
  viewMonth,
  selectedParts,
  todayParts,
  onDaySelect,
  onPrevMonth,
  onNextMonth,
  onYearChange,
  onMonthChange,
  onToday,
  onClose,
}: CalendarDropdownProps) => {
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width?: number;
    openUp: boolean;
  }>({ top: 0, left: 0, width: 0, openUp: false });
  const dropRef = useRef<HTMLDivElement>(null);

  // Calculate position based on anchor
  useEffect(() => {
    const reposition = () => {
      if (!anchorRef.current) return;
      const rect = anchorRef.current.getBoundingClientRect();
      const DROPDOWN_HEIGHT = 380;
      const DROPDOWN_WIDTH = 288;
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp = spaceBelow < DROPDOWN_HEIGHT && rect.top > DROPDOWN_HEIGHT;
      // align right edge of dropdown with right edge of input; clamp to viewport
      const rawLeft = rect.right - DROPDOWN_WIDTH;
      const clampedLeft = Math.max(
        8,
        Math.min(rawLeft, window.innerWidth - DROPDOWN_WIDTH - 8),
      );
      setPos({
        top: openUp ? rect.top - DROPDOWN_HEIGHT - 6 : rect.bottom + 6,
        left: clampedLeft,
        openUp,
      });
    };
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [anchorRef]);

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropRef.current &&
        !dropRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, anchorRef]);

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDayIndex = getFirstDayOfMonthWeekday(viewYear, viewMonth);
  const blanks = Array(firstDayIndex).fill(null) as null[];
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const calendarCells: (number | null)[] = [...blanks, ...days];

  const startYear = currentJalaliYear() - 20;
  const years = Array.from({ length: 31 }, (_, i) => startYear + i);

  // Quick date presets
  const today = getTodayJalali();
  const quickOptions = [
    {
      label: "امروز",
      action: () => {
        if (today) onDaySelect(today.jy, today.jm, today.jd);
      },
    },
    {
      label: "فردا",
      action: () => {
        if (today) {
          const gStr = toGregorianStr(today.jy, today.jm, today.jd);
          const d = new Date(gStr);
          d.setDate(d.getDate() + 1);
          const j = toJalali(d, "short").split("/");
          if (j.length === 3)
            onDaySelect(parseInt(j[0]), parseInt(j[1]), parseInt(j[2]));
        }
      },
    },
    {
      label: "یک هفته دیگر",
      action: () => {
        if (today) {
          const gStr = toGregorianStr(today.jy, today.jm, today.jd);
          const d = new Date(gStr);
          d.setDate(d.getDate() + 7);
          const j = toJalali(d, "short").split("/");
          if (j.length === 3)
            onDaySelect(parseInt(j[0]), parseInt(j[1]), parseInt(j[2]));
        }
      },
    },
    {
      label: "یک ماه دیگر",
      action: () => {
        if (today) {
          const gStr = toGregorianStr(today.jy, today.jm, today.jd);
          const d = new Date(gStr);
          d.setMonth(d.getMonth() + 1);
          const j = toJalali(d, "short").split("/");
          if (j.length === 3)
            onDaySelect(parseInt(j[0]), parseInt(j[1]), parseInt(j[2]));
        }
      },
    },
  ];

  const dropdown = (
    <div
      ref={dropRef}
      style={{
        position: "fixed",
        top: pos.top,
        left: Math.max(8, pos.left),
        width: 288,
        zIndex: 99999,
      }}
      className="bg-slate-800 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden animate-fade-in"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Quick Presets */}
      <div className="flex items-center gap-1 px-3 pt-3 pb-2 flex-wrap">
        {quickOptions.map((q) => (
          <button
            key={q.label}
            type="button"
            onClick={q.action}
            className="text-[10px] px-2.5 py-1 rounded-lg bg-slate-700/60 hover:bg-blue-500/20 text-slate-400 hover:text-blue-300 border border-slate-600/50 hover:border-blue-500/40 transition-all"
          >
            {q.label}
          </button>
        ))}
      </div>

      <div className="border-t border-slate-700/40 mx-3 mb-2" />

      {/* Header: Month/Year Selectors + Nav */}
      <div className="flex items-center justify-between px-3 pb-2 gap-1">
        <button
          type="button"
          onClick={onNextMonth}
          className="w-8 h-8 rounded-lg hover:bg-slate-700 text-slate-300 transition-colors flex items-center justify-center text-sm shrink-0"
          title="ماه بعد"
        >
          ›
        </button>

        <div className="flex items-center gap-1 flex-1 justify-center">
          <select
            value={viewMonth}
            onChange={(e) => onMonthChange(parseInt(e.target.value, 10))}
            className="bg-slate-700/70 border border-slate-600/50 rounded-lg text-white text-xs px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40 cursor-pointer"
          >
            {MONTH_NAMES.map((name, idx) => (
              <option key={idx} value={idx + 1}>
                {name}
              </option>
            ))}
          </select>

          <select
            value={viewYear}
            onChange={(e) => onYearChange(parseInt(e.target.value, 10))}
            className="bg-slate-700/70 border border-slate-600/50 rounded-lg text-white text-xs px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40 cursor-pointer"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={onPrevMonth}
          className="w-8 h-8 rounded-lg hover:bg-slate-700 text-slate-300 transition-colors flex items-center justify-center text-sm shrink-0"
          title="ماه قبل"
        >
          ‹
        </button>
      </div>

      {/* Weekday Headers */}
      <div className="grid grid-cols-7 gap-0.5 px-2 mb-1">
        {WEEKDAYS.map((day, idx) => (
          <div
            key={idx}
            className={`text-center text-[10px] font-semibold py-1 rounded ${
              idx === 6 ? "text-red-400" : "text-slate-500"
            }`}
            title={WEEKDAYS_FULL[idx]}
          >
            {day}
          </div>
        ))}
      </div>

      {/* Days Grid */}
      <div className="grid grid-cols-7 gap-0.5 px-2 pb-3">
        {calendarCells.map((day, idx) => {
          if (day === null) return <div key={`b-${idx}`} />;

          const isSelected =
            selectedParts &&
            selectedParts.jy === viewYear &&
            selectedParts.jm === viewMonth &&
            selectedParts.jd === day;

          const isToday =
            todayParts &&
            todayParts.jy === viewYear &&
            todayParts.jm === viewMonth &&
            todayParts.jd === day;

          const isFriday = (firstDayIndex + day - 1) % 7 === 6;

          return (
            <button
              key={day}
              type="button"
              onClick={() => onDaySelect(viewYear, viewMonth, day)}
              className={`
                relative h-8 text-xs rounded-lg font-medium transition-all
                ${
                  isSelected
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-500/30 scale-105"
                    : isToday
                      ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/25"
                      : isFriday
                        ? "text-red-400/70 hover:bg-slate-700 hover:text-red-300"
                        : "text-slate-300 hover:bg-slate-700 hover:text-white"
                }
              `}
            >
              {day}
              {isToday && !isSelected && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-emerald-400" />
              )}
            </button>
          );
        })}
      </div>

      {/* Footer: Today button */}
      <div className="border-t border-slate-700/40 px-3 py-2 flex items-center justify-between">
        <button
          type="button"
          onClick={onToday}
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
        >
          📅 برو به امروز
        </button>
        <span className="text-[10px] text-slate-600">
          {viewYear}/{String(viewMonth).padStart(2, "0")}
        </span>
      </div>
    </div>
  );

  return ReactDOM.createPortal(dropdown, document.body);
};

// ─── Main Component ───────────────────────────────────────────
type JalaliDatePickerProps = {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  required?: boolean;
  label?: string;
};

const JalaliDatePicker = ({
  value,
  onChange,
  placeholder = "انتخاب تاریخ...",
  className = "",
  required = false,
  label,
}: JalaliDatePickerProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const today = getTodayJalali();

  const [viewYear, setViewYear] = useState(today?.jy || currentJalaliYear());
  const [viewMonth, setViewMonth] = useState(today?.jm || 1);

  // Parse value to Jalali parts
  let selectedParts: JalaliParts3 | null = null;
  if (value) {
    const shamsiStr = toJalali(value, "short");
    if (shamsiStr && shamsiStr !== "—") {
      const parts = shamsiStr.split("/");
      if (parts.length === 3) {
        selectedParts = {
          jy: parseInt(parts[0], 10),
          jm: parseInt(parts[1], 10),
          jd: parseInt(parts[2], 10),
        };
      }
    }
  }

  // Sync view to selected value
  useEffect(() => {
    if (selectedParts) {
      setViewYear(selectedParts.jy);
      setViewMonth(selectedParts.jm);
    } else if (today) {
      setViewYear(today.jy);
      setViewMonth(today.jm);
    }
  }, [value]);

  const handleDaySelect = useCallback(
    (jy: number, jm: number, day: number) => {
      const gregStr = toGregorianStr(jy, jm, day);
      onChange(gregStr);
      setIsOpen(false);
    },
    [onChange],
  );

  const handlePrevMonth = useCallback(() => {
    setViewMonth((m) => {
      if (m === 1) {
        setViewYear((y) => y - 1);
        return 12;
      }
      return m - 1;
    });
  }, []);

  const handleNextMonth = useCallback(() => {
    setViewMonth((m) => {
      if (m === 12) {
        setViewYear((y) => y + 1);
        return 1;
      }
      return m + 1;
    });
  }, []);

  const handleToday = useCallback(() => {
    if (today) {
      setViewYear(today.jy);
      setViewMonth(today.jm);
    }
  }, [today]);

  const displayVal = value ? toJalali(value, "short") : "";

  // Display the Jalali day-of-week label
  const dayOfWeekLabel = selectedParts
    ? (() => {
        try {
          const { gy, gm, gd } = toGregorian(
            selectedParts.jy,
            selectedParts.jm,
            selectedParts.jd,
          );
          const gDay = new Date(gy, gm - 1, gd).getDay(); // 0=Sun
          const jalaliDay = (gDay + 1) % 7; // 0=Sat
          return WEEKDAYS_FULL[jalaliDay];
        } catch {
          return "";
        }
      })()
    : "";

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {/* Input trigger */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setIsOpen((o) => !o);
        }}
        className={`
          w-full flex items-center justify-between gap-2
          px-3 py-2.5 rounded-xl cursor-pointer select-none
          bg-slate-700/50 border transition-all
          ${
            isOpen
              ? "border-blue-500/60 ring-2 ring-blue-500/20"
              : "border-slate-600/50 hover:border-slate-500/70"
          }
        `}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-slate-500 text-sm shrink-0">📅</span>
          {displayVal ? (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-white text-sm font-medium">
                {displayVal}
              </span>
              {dayOfWeekLabel && (
                <span className="text-xs text-slate-400 bg-slate-700/60 px-1.5 py-0.5 rounded-md shrink-0">
                  {dayOfWeekLabel}
                </span>
              )}
            </div>
          ) : (
            <span className="text-slate-500 text-sm">{placeholder}</span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {value && !required && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              className="w-5 h-5 rounded-md flex items-center justify-center text-slate-500 hover:text-slate-300 hover:bg-slate-600/50 transition-all text-[10px]"
              title="پاک کردن"
            >
              ✕
            </button>
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

      {/* Hidden native input for form validation */}
      {required && (
        <input
          type="text"
          required
          value={value || ""}
          readOnly
          style={{
            position: "absolute",
            opacity: 0,
            width: 0,
            height: 0,
            pointerEvents: "none",
          }}
          tabIndex={-1}
        />
      )}

      {/* Calendar Portal */}
      {isOpen && (
        <CalendarDropdown
          anchorRef={containerRef}
          viewYear={viewYear}
          viewMonth={viewMonth}
          selectedParts={selectedParts}
          todayParts={today}
          onDaySelect={handleDaySelect}
          onPrevMonth={handlePrevMonth}
          onNextMonth={handleNextMonth}
          onYearChange={setViewYear}
          onMonthChange={setViewMonth}
          onToday={handleToday}
          onClose={() => setIsOpen(false)}
        />
      )}
    </div>
  );
};

export default JalaliDatePicker;
