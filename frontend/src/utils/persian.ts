/**
 * Persian / Jalali utility functions
 * No external dependency — pure arithmetic conversion
 */

// ────────────────────────────────────────────────────────────────
// 1. Jalali (Shamsi) date conversion
// ────────────────────────────────────────────────────────────────

export interface JalaliParts {
  jy: number;
  jm: number;
  jd: number;
}

export interface GregorianParts {
  gy: number;
  gm: number;
  gd: number;
}

function _toJalali(gy: number, gm: number, gd: number): JalaliParts {
  const g_d_no = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const jy_d_no = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];

  let gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    355666 +
    365 * gy +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) +
    gd;
  for (let i = 0; i < gm - 1; i++) days += g_d_no[i];

  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let jm: number;
  let jd: number;
  if (days < 186) {
    jm = 1 + Math.floor(days / 31);
    jd = 1 + (days % 31);
  } else {
    jm = 7 + Math.floor((days - 186) / 30);
    jd = 1 + ((days - 186) % 30);
  }
  return { jy, jm, jd };
}

export type JalaliFormat = "short" | "long" | "medium";

/**
 * Convert a Gregorian date string or Date object to a Persian date string.
 * @param input  - e.g. "2024-03-15" or Date()
 * @param format - 'short' (1403/01/25) | 'long' (25 فروردین 1403) | 'medium' (1403 فروردین 25)
 */
export function toJalali(
  input: string | Date | null | undefined,
  format: JalaliFormat = "short",
): string {
  if (!input) return "—";
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return "—";
  const { jy, jm, jd } = _toJalali(
    d.getFullYear(),
    d.getMonth() + 1,
    d.getDate(),
  );

  const MONTHS = [
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
  const pad = (n: number): string => String(n).padStart(2, "0");

  if (format === "long") return `${jd} ${MONTHS[jm - 1]} ${jy}`;
  if (format === "medium") return `${jy} ${MONTHS[jm - 1]} ${pad(jd)}`;
  return `${jy}/${pad(jm)}/${pad(jd)}`;
}

/**
 * Get current Jalali year as integer.
 */
export function currentJalaliYear(): number {
  const d = new Date();
  return _toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate()).jy;
}

/**
 * Jalali year + month (1-12) of a Gregorian Date.
 */
export function jalaliYearMonth(d: Date = new Date()): {
  jy: number;
  jm: number;
} {
  const { jy, jm } = _toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return { jy, jm };
}

function _isoFromLocal(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * ISO (Gregorian) date of the FIRST day of the Jalali month containing
 * `d` — e.g. any day in آبان maps to Oct 23. "This month" ranges in this
 * app are Jalali months, never Gregorian ones.
 */
export function jalaliMonthStartISO(d: Date = new Date()): string {
  const { jy, jm } = jalaliYearMonth(d);
  return toGregorianStr(jy, jm, 1);
}

/**
 * ISO range covering the whole Jalali month before the one containing
 * `d`: from its 1st to the day before this month's 1st.
 */
export function jalaliPrevMonthRangeISO(d: Date = new Date()): {
  from: string;
  to: string;
} {
  const { jy, jm } = jalaliYearMonth(d);
  const prev = jm === 1 ? { jy: jy - 1, jm: 12 } : { jy, jm: jm - 1 };
  const from = toGregorianStr(prev.jy, prev.jm, 1);
  const start = new Date(`${jalaliMonthStartISO(d)}T00:00:00`);
  start.setDate(start.getDate() - 1);
  return { from, to: _isoFromLocal(start) };
}

/**
 * Return array of Jalali years from startYear to endYear (inclusive).
 */
export function jalaliYearRange(startYear: number, endYear: number): number[] {
  const years: number[] = [];
  for (let y = endYear; y >= startYear; y--) years.push(y);
  return years;
}

// ────────────────────────────────────────────────────────────────
// 2. Number → Persian words
// ────────────────────────────────────────────────────────────────

const _ONES = [
  "",
  "یک",
  "دو",
  "سه",
  "چهار",
  "پنج",
  "شش",
  "هفت",
  "هشت",
  "نه",
  "ده",
  "یازده",
  "دوازده",
  "سیزده",
  "چهارده",
  "پانزده",
  "شانزده",
  "هفده",
  "هجده",
  "نوزده",
];
const _TENS = [
  "",
  "",
  "بیست",
  "سی",
  "چهل",
  "پنجاه",
  "شصت",
  "هفتاد",
  "هشتاد",
  "نود",
];
const _HUNDREDS = [
  "",
  "صد",
  "دویست",
  "سیصد",
  "چهارصد",
  "پانصد",
  "ششصد",
  "هفتصد",
  "هشتصد",
  "نهصد",
];

function _threeDigits(n: number): string {
  if (n === 0) return "";
  const h = Math.floor(n / 100);
  const rem = n % 100;
  const parts: string[] = [];
  if (h) parts.push(_HUNDREDS[h]);
  if (rem < 20) {
    if (rem) parts.push(_ONES[rem]);
  } else {
    const t = Math.floor(rem / 10);
    const o = rem % 10;
    parts.push(_TENS[t]);
    if (o) parts.push(_ONES[o]);
  }
  return parts.join(" و ");
}

const _SCALE = ["", "هزار", "میلیون", "میلیارد", "تریلیون"];

/**
 * Convert a number to its Persian word representation.
 */
export function numberToWords(num: number | string): string {
  const n = Math.floor(Number(num) || 0);
  if (n === 0) return "صفر";
  if (n < 0) return "منفی " + numberToWords(-n);

  const groups: number[] = [];
  let tmp = n;
  while (tmp > 0) {
    groups.push(tmp % 1000);
    tmp = Math.floor(tmp / 1000);
  }

  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    const word = _threeDigits(groups[i]);
    parts.push(i > 0 ? `${word} ${_SCALE[i]}` : word);
  }
  return parts.join(" و ") + " تومان";
}

// ────────────────────────────────────────────────────────────────
// 3. Vehicle plate formatter
// ────────────────────────────────────────────────────────────────

export interface PlateParts {
  type?: string;
  num1?: string;
  letter?: string;
  num2?: string;
  region?: string;
}

/**
 * Build a formatted plate string from structured parts.
 *
 * For a car:   { type:'car',  num1:'21', letter:'ب', num2:'452', region:'41' }
 *   → "21 ب 452 - ایران 41"
 *
 * For a moto:  { type:'moto', num1:'543', num2:'35728' }
 *   → "543 - 35728"
 */
export function buildPlateString(parts: PlateParts | null | undefined): string {
  if (!parts) return "";
  if (parts.type === "moto") {
    return `${parts.num1 || ""} - ${parts.num2 || ""}`;
  }
  // car (default)
  return `${parts.num1 || ""} ${parts.letter || ""} ${parts.num2 || ""} - ایران ${parts.region || ""}`;
}

/**
 * Parse a plate string back to parts (best-effort).
 */
export function parsePlateString(
  str: string | null | undefined,
): PlateParts | null {
  if (!str) return null;
  // moto: "543 - 35728"
  const motoMatch = str.match(/^(\d+)\s*-\s*(\d+)$/);
  if (motoMatch)
    return { type: "moto", num1: motoMatch[1], num2: motoMatch[2] };
  // car: "21 ب 452 - ایران 41"
  const carMatch = str.match(
    /^(\d+)\s+([\u0600-\u06FF])\s+(\d+)\s*-\s*ایران\s*(\d+)$/,
  );
  if (carMatch)
    return {
      type: "car",
      num1: carMatch[1],
      letter: carMatch[2],
      num2: carMatch[3],
      region: carMatch[4],
    };
  return null;
}

// ────────────────────────────────────────────────────────────────
// 4. Farsi number formatting helper
// ────────────────────────────────────────────────────────────────
export const fmt = (n: number | string): string =>
  new Intl.NumberFormat("fa-IR").format(Number(n) || 0);

// ────────────────────────────────────────────────────────────────
// 5. Jalali to Gregorian conversion
// ────────────────────────────────────────────────────────────────

export function toGregorian(
  jy: number,
  jm: number,
  jd: number,
): GregorianParts {
  const jy2 = jy + 1595;
  let days =
    -355668 +
    365 * jy2 +
    Math.floor(jy2 / 33) * 8 +
    Math.floor(((jy2 % 33) + 3) / 4) +
    jd;
  if (jm < 7) {
    days += (jm - 1) * 31;
  } else {
    days += (jm - 1) * 30 + 6;
  }
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    days--;
    gy += 100 * Math.floor(days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const sal_a = [
    0,
    31,
    (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  let gm: number;
  for (gm = 1; gm < 13; gm++) {
    const v = sal_a[gm];
    if (gd <= v) break;
    gd -= v;
  }
  return { gy, gm, gd };
}

export function toGregorianStr(jy: number, jm: number, jd: number): string {
  const { gy, gm, gd } = toGregorian(jy, jm, jd);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${gy}-${pad(gm)}-${pad(gd)}`;
}

// ────────────────────────────────────────────────────────────────
// 6. QWERTY to Persian Keyboard mapping
// ────────────────────────────────────────────────────────────────

const QWERTY_TO_PERSIAN: Record<string, string> = {
  q: "ض",
  w: "ص",
  e: "ث",
  r: "ق",
  t: "ف",
  y: "غ",
  u: "ع",
  i: "ه",
  o: "خ",
  p: "ح",
  "[": "ج",
  "]": "چ",
  a: "ش",
  s: "س",
  d: "ی",
  f: "ب",
  g: "ل",
  h: "ا",
  j: "ت",
  k: "ن",
  l: "م",
  ";": "ک",
  "'": "گ",
  z: "ظ",
  x: "ط",
  c: "ز",
  v: "ر",
  b: "ذ",
  n: "د",
  m: "پ",
  ",": "و",
  ".": "د",
  "/": ".",
  Q: "ض",
  W: "ص",
  E: "ث",
  R: "ق",
  T: "ف",
  Y: "غ",
  U: "ع",
  I: "ه",
  O: "خ",
  P: "ح",
  "{": "ج",
  "}": "چ",
  A: "ش",
  S: "س",
  D: "ی",
  H: "آ",
  G: "ل",
  F: "ب",
  J: "ت",
  K: "ن",
  L: "م",
  ":": "ک",
  '"': "گ",
  Z: "ظ",
  X: "ط",
  C: "ژ",
  V: "ر",
  B: "ذ",
  N: "د",
  M: "ء",
  "<": "و",
  ">": "د",
  "?": "؟",
  "\\": "پ",
  "|": "پ",
};

/**
 * Automatically maps standard English QWERTY key strokes to Persian equivalent layout characters.
 */
export function toPersianKeyboard(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .split("")
    .map((char) => QWERTY_TO_PERSIAN[char] || char)
    .join("");
}
