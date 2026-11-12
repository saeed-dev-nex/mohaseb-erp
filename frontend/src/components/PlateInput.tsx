import React, { useState, useEffect, useRef } from "react";

/**
 * PlateInput — کامپوننت ورود پلاک خودرو
 * پشتیبانی از دو فرمت:
 *   خودرو:  "21 ب 452 - ایران 41"
 *   موتور:  "543 - 35728"
 */

type PlateType = "car" | "moto";

type PlateParts = {
  num1: string;
  letter: string;
  num2: string;
  region: string;
};

type ParsedPlate = {
  type: PlateType;
  num1: string;
  letter?: string;
  num2: string;
  region?: string;
};

const CAR_LETTERS = [
  "الف",
  "ب",
  "پ",
  "ت",
  "ث",
  "ج",
  "د",
  "ذ",
  "ر",
  "ز",
  "ژ",
  "س",
  "ش",
  "ص",
  "ط",
  "ع",
  "ف",
  "ق",
  "ک",
  "گ",
  "ل",
  "م",
  "ن",
  "و",
  "ه",
  "ی",
];

// build plate string from parts
function buildPlate(type: PlateType, parts: PlateParts): string {
  if (type === "moto") {
    return `${parts.num1 || ""}-${parts.num2 || ""}`;
  }
  return `${parts.num1 || ""} ${parts.letter || ""} ${parts.num2 || ""} - ایران ${parts.region || ""}`;
}

// try to parse existing plate string
function parsePlate(str: string | null | undefined): ParsedPlate {
  if (!str)
    return { type: "car", num1: "", letter: "الف", num2: "", region: "" };
  const carMatch = str.match(
    /^(\d*)\s+([\u0600-\u06FF]+)\s+(\d*)\s*-\s*ایران\s*(\d*)$/,
  );
  if (carMatch)
    return {
      type: "car",
      num1: carMatch[1],
      letter: carMatch[2],
      num2: carMatch[3],
      region: carMatch[4],
    };
  const motoMatch = str.match(/^(\d*)-(\d*)$/);
  if (motoMatch)
    return { type: "moto", num1: motoMatch[1], num2: motoMatch[2] };
  return { type: "car", num1: "", letter: "الف", num2: "", region: "" };
}

const inputCls =
  "bg-slate-800/60 border border-slate-600/50 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all px-2 py-1.5 text-center";

type PlateInputProps = {
  value?: string;
  onChange: (plate: string) => void;
};

const PlateInput = ({ value, onChange }: PlateInputProps) => {
  const initial = parsePlate(value);
  const [plateType, setPlateType] = useState<PlateType>(initial.type || "car");
  const [parts, setParts] = useState<PlateParts>({
    num1: initial.num1 || "",
    letter: initial.letter || "الف",
    num2: initial.num2 || "",
    region: initial.region || "",
  });

  // sync when external value changes (e.g. loading from API)
  useEffect(() => {
    const parsed = parsePlate(value);
    if (parsed.type !== plateType || parsed.num1 !== parts.num1) {
      setPlateType(parsed.type || "car");
      setParts({
        num1: parsed.num1 || "",
        letter: parsed.letter || "الف",
        num2: parsed.num2 || "",
        region: parsed.region || "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const update = (field: keyof PlateParts, val: string) => {
    const next = { ...parts, [field]: val };
    setParts(next);
    onChange(buildPlate(plateType, next));
  };

  // Fast keyboard entry: when a segment fills up, focus moves to the next
  // segment on its own; Backspace on an empty segment returns to the
  // previous one. Only one plate tree (car/moto) is mounted at a time, so
  // the refs can be shared between both layouts.
  const num1Ref = useRef<HTMLInputElement>(null);
  const letterRef = useRef<HTMLSelectElement>(null);
  // True while the open letter dropdown is being driven by the mouse, so a
  // committed mouse pick advances but keyboard browsing does not.
  const letterMouseRef = useRef(false);
  const num2Ref = useRef<HTMLInputElement>(null);
  const regionRef = useRef<HTMLInputElement>(null);

  const focusField = (
    ref: React.RefObject<HTMLInputElement | HTMLSelectElement | null>,
  ) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (el instanceof HTMLInputElement) el.select();
  };

  const backOnEmpty =
    (ref: React.RefObject<HTMLInputElement | HTMLSelectElement | null>) =>
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Backspace" && !e.currentTarget.value) {
        e.preventDefault();
        focusField(ref);
      }
    };

  const digits = (raw: string) => raw.replace(/\D/g, "");

  const switchType = (t: PlateType) => {
    setPlateType(t);
    const next: PlateParts = { num1: "", letter: "الف", num2: "", region: "" };
    setParts(next);
    onChange(buildPlate(t, next));
  };

  return (
    <div className="space-y-2">
      {/* Toggle */}
      <div className="flex gap-2">
        {(["car", "moto"] as PlateType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => switchType(t)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
              plateType === t
                ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                : "bg-slate-700/50 text-slate-400 hover:bg-slate-700"
            }`}
          >
            {t === "car" ? "🚗 خودرو" : "🏍️ موتور"}
          </button>
        ))}
      </div>

      {/* Car Plate */}
      {plateType === "car" && (
        <div
          className="flex items-center gap-1 bg-slate-800/40 border border-slate-600/30 rounded-xl p-2"
          dir="ltr"
        >
          {/* num1: 2 digits */}
          <input
            ref={num1Ref}
            type="text"
            inputMode="numeric"
            maxLength={2}
            value={parts.num1}
            onChange={(e) => {
              const v = digits(e.target.value);
              update("num1", v);
              if (v.length >= 2) focusField(letterRef);
            }}
            placeholder="12"
            className={`${inputCls} w-10`}
          />
          {/* letter — advance to num2 only when the choice is COMMITTED:
              a mouse pick, or Enter. Arrow-key browsing in a focused select
              fires change on every step, and advancing on the first step
              made it impossible to browse to the intended letter. */}
          <select
            ref={letterRef}
            value={parts.letter}
            onPointerDown={() => {
              letterMouseRef.current = true;
            }}
            onBlur={() => {
              letterMouseRef.current = false;
            }}
            onChange={(e) => {
              update("letter", e.target.value);
              if (letterMouseRef.current) {
                letterMouseRef.current = false;
                focusField(num2Ref);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                focusField(num2Ref);
              }
            }}
            className={`${inputCls} w-14`}
            dir="rtl"
          >
            {CAR_LETTERS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          {/* num2: 3 digits */}
          <input
            ref={num2Ref}
            type="text"
            inputMode="numeric"
            maxLength={3}
            value={parts.num2}
            onChange={(e) => {
              const v = digits(e.target.value);
              update("num2", v);
              if (v.length >= 3) focusField(regionRef);
            }}
            onKeyDown={backOnEmpty(letterRef)}
            placeholder="123"
            className={`${inputCls} w-12`}
          />
          <span className="text-slate-500 text-xs px-1">-</span>
          <span className="text-slate-400 text-xs">ایران</span>
          {/* region: 2 digits */}
          <input
            ref={regionRef}
            type="text"
            inputMode="numeric"
            maxLength={2}
            value={parts.region}
            onChange={(e) => update("region", digits(e.target.value))}
            onKeyDown={backOnEmpty(num2Ref)}
            placeholder="41"
            className={`${inputCls} w-10`}
          />
        </div>
      )}

      {/* Moto Plate */}
      {plateType === "moto" && (
        <div
          className="flex items-center gap-2 bg-slate-800/40 border border-slate-600/30 rounded-xl p-2"
          dir="ltr"
        >
          <input
            ref={num1Ref}
            type="text"
            inputMode="numeric"
            maxLength={3}
            value={parts.num1}
            onChange={(e) => {
              const v = digits(e.target.value);
              update("num1", v);
              if (v.length >= 3) focusField(num2Ref);
            }}
            placeholder="543"
            className={`${inputCls} w-16`}
          />
          <span className="text-slate-500 text-xs">-</span>
          <input
            ref={num2Ref}
            type="text"
            inputMode="numeric"
            maxLength={5}
            value={parts.num2}
            onChange={(e) => update("num2", digits(e.target.value))}
            onKeyDown={backOnEmpty(num1Ref)}
            placeholder="35728"
            className={`${inputCls} w-20`}
          />
        </div>
      )}

      {/* Preview */}
      {(parts.num1 || parts.num2) && (
        <p className="text-[10px] text-emerald-400/70 pr-1">
          پلاک: {buildPlate(plateType, parts)}
        </p>
      )}
    </div>
  );
};

export default PlateInput;
