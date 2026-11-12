import React, { useRef } from "react";
import type { InputHTMLAttributes } from "react";
import { numberToWords } from "../utils/persian";

/**
 * PriceInput — ورود قیمت به هزار تومان
 *
 * کاربر عدد را به واحد «هزار تومان» وارد می‌کند (مثلاً 200)
 * و مقدار واقعی به تومان ذخیره می‌شود (200 × 1000 = 200,000)
 *
 * بهبود: صفرها به جای لیبل مجزا، دقیقاً در کنار خود عدد و چسبیده به آن نمایش داده می‌شوند.
 *
 * Props:
 *   value     — مقدار واقعی به تومان (مثلاً 200000)
 *   onChange  — callback با مقدار واقعی جدید
 *   placeholder, className, ...rest
 */

const fmt = (n: number | string) =>
  new Intl.NumberFormat("fa-IR").format(Number(n) || 0);

type PriceInputProps = {
  value?: number | string | null;
  onChange: (value: number) => void;
  placeholder?: string;
  className?: string;
  borderColor?: string;
  blankWhenZero?: boolean;
} & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "placeholder" | "className"
>;

const PriceInput = ({
  value,
  onChange,
  placeholder = "0",
  className = "",
  borderColor = "",
  blankWhenZero = false,
  ...rest
}: PriceInputProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Display value (thousands)
  const displayValue =
    value && !(blankWhenZero && Number(value) === 0)
      ? Math.floor(Number(value) / 1000)
      : "";
  const realAmount = Number(value) || 0;

  const baseCls =
    "flex items-center justify-end w-full px-3 py-2 bg-slate-700/50 border border-slate-600/50 rounded-xl text-white text-sm placeholder-slate-500 focus-within:ring-2 focus-within:ring-blue-500/40 transition-all";

  return (
    <div className="space-y-1">
      {/* Container simulating the input, forcing LTR for numbers so we get "number" followed by ",000" */}
      <div
        ref={containerRef}
        className={`${baseCls} ${borderColor} ${className} cursor-text`}
        onClick={() => inputRef.current?.focus()}
        dir="ltr"
      >
        <div className="flex items-center select-none mr-1">
          <span className="text-slate-500 font-mono text-sm leading-none">
            ,000
          </span>
          <span className="text-slate-400 text-xs ml-1.5 font-medium leading-none">
            تومان
          </span>
        </div>

        <input
          ref={inputRef}
          type="number"
          min="0"
          value={displayValue}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "" || raw === "0") {
              onChange(0);
            } else {
              onChange(Math.round(Number(raw) * 1000));
            }
          }}
          placeholder={placeholder}
          className="w-full bg-transparent border-none outline-none text-right text-white text-sm p-0 focus:ring-0 focus:outline-none"
          {...rest}
        />
      </div>

      {/* Persian text preview of full amount, digits and words. The slot
          always exists with a fixed height and never wraps, so typing an
          amount never changes the component's height or shifts the form
          layout; long words are clipped with an ellipsis and the full
          text stays available via the title tooltip. */}
      <p
        className="h-4 overflow-hidden whitespace-nowrap text-ellipsis text-[10px] leading-4 text-emerald-400/70 pr-1 text-right"
        dir="rtl"
        title={
          realAmount > 0
            ? `= ${fmt(realAmount)} تومان (${numberToWords(realAmount)})`
            : undefined
        }
      >
        {realAmount > 0 && (
          <>
            ={" "}
            <span className="font-semibold text-emerald-400">
              {fmt(realAmount)} تومان
            </span>{" "}
            <span className="text-emerald-400/60">
              ({numberToWords(realAmount)})
            </span>
          </>
        )}
      </p>
    </div>
  );
};

export default PriceInput;
