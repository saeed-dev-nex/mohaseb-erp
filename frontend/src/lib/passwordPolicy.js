// Password complexity policy — mirrors the backend rule in
// api/password_policy.py so forms can show live feedback; the
// server remains the authority and re-checks on submit.

export const PASSWORD_MIN_LENGTH = 8;
const SPECIAL_CHARS = "!@#$%^&*()-_=+[]{};:'\",.<>/?\\|`~";

/**
 * @param {string} password
 * @returns {{ key: string, label: string, ok: boolean }[]}
 */
export function passwordChecks(password) {
  const value = password || "";
  return [
    {
      key: "length",
      label: `دست‌کم ${PASSWORD_MIN_LENGTH} نویسه`,
      ok: value.length >= PASSWORD_MIN_LENGTH,
    },
    { key: "lower", label: "یک حرف کوچک انگلیسی", ok: /[a-z]/.test(value) },
    { key: "upper", label: "یک حرف بزرگ انگلیسی", ok: /[A-Z]/.test(value) },
    { key: "digit", label: "یک عدد", ok: /\d/.test(value) },
    {
      key: "special",
      label: "یک کاراکتر خاص (مثل !@#$)",
      ok: [...value].some((char) => SPECIAL_CHARS.includes(char)),
    },
  ];
}

/** @param {string} password */
export function isPasswordValid(password) {
  return passwordChecks(password).every((check) => check.ok);
}
