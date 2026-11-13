import React, { useState } from "react";
import { useDispatch } from "react-redux";
import api, { accountSecurityAPI } from "../services/api";
import { setCurrentUser, setTokens } from "../features/authSlice";
import { passwordChecks } from "../lib/passwordPolicy";
import { formatApiError } from "../utils/apiError";
import PasswordInput from "./PasswordInput";

interface ChangePasswordModalProps {
  open: boolean;
  onClose: () => void;
}

/** Self-service password change with the complexity policy checklist. */
const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({
  open,
  onClose,
}) => {
  const dispatch = useDispatch();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const checks = passwordChecks(next);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await accountSecurityAPI.changePassword({
        current_password: current,
        new_password: next,
      });
      // The server revoked every other session and issued fresh tokens.
      dispatch(setTokens({ access: res.data.access }));
      try {
        const meRes = await api.get("users/me/", {
          headers: { Authorization: `Bearer ${res.data.access}` },
        });
        dispatch(setCurrentUser(meRes.data));
      } catch {
        /* The password changed; a stale banner is a minor issue. */
      }
      setDone(true);
    } catch (err) {
      setError(formatApiError(err, "تغییر رمز ناموفق بود."));
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    "w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 text-slate-100 outline-none";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 space-y-4">
        <h2 className="text-lg font-bold text-slate-100">تغییر رمز عبور</h2>
        {done ? (
          <>
            <p className="text-sm text-emerald-300 leading-6">
              رمز عبور تازه ثبت شد و نشست‌های دیگرتان بسته شدند.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium"
            >
              بستن
            </button>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {error && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/40 rounded-xl text-rose-200 text-sm">
                {error}
              </div>
            )}
            <div>
              <label className="block text-sm text-slate-300 mb-2">
                رمز فعلی
              </label>
              <PasswordInput
                value={current}
                dir="ltr"
                onChange={(e) => setCurrent(e.target.value)}
                className={inputClass}
                required
              />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-2">
                رمز تازه
              </label>
              <PasswordInput
                value={next}
                dir="ltr"
                onChange={(e) => setNext(e.target.value)}
                className={inputClass}
                required
              />
              <ul className="mt-2 space-y-1 text-xs">
                {checks.map((check) => (
                  <li
                    key={check.key}
                    className={check.ok ? "text-emerald-300" : "text-slate-500"}
                  >
                    {check.ok ? "✓" : "○"} {check.label}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={busy}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium disabled:opacity-60"
              >
                {busy ? "در حال ثبت…" : "ثبت رمز تازه"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-3 bg-slate-700 hover:bg-slate-600 text-slate-100 rounded-xl"
              >
                انصراف
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default ChangePasswordModal;
