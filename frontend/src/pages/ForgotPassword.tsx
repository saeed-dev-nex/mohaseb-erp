import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import CaptchaField from "../components/CaptchaField";
import PasswordInput from "../components/PasswordInput";
import { accountSecurityAPI } from "../services/api";
import { passwordChecks } from "../lib/passwordPolicy";
import { formatApiError } from "../utils/apiError";

const inputClass =
  "w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:ring-2 focus:ring-blue-400 focus:border-transparent text-white placeholder-blue-200/50 transition-all outline-none";
const labelClass = "block text-sm font-medium text-blue-100 mb-2";

/** Forgot password: identifier + captcha → emailed code → new password. */
const ForgotPassword = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [identifier, setIdentifier] = useState("");
  const [captcha, setCaptcha] = useState({ id: "", answer: "" });
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [captchaKey, setCaptchaKey] = useState(0);

  const checks = passwordChecks(newPassword);

  const submitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await accountSecurityAPI.forgotPassword({
        identifier: identifier.trim(),
        captcha_id: captcha.id,
        captcha_answer: captcha.answer,
      });
      setStep(2);
      setNotice("اگر حسابی با این مشخصات باشد، کد بازیابی به ایمیلش ارسال شد.");
    } catch (err) {
      setError(formatApiError(err, "خطایی رخ داد؛ دوباره تلاش کنید."));
      setCaptchaKey((key) => key + 1);
    } finally {
      setLoading(false);
    }
  };

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await accountSecurityAPI.resetPassword({
        identifier: identifier.trim(),
        code: code.trim(),
        new_password: newPassword,
      });
      navigate("/login", {
        state: { notice: "رمز عبور تازه ثبت شد؛ با آن وارد شوید." },
      });
    } catch (err) {
      setError(formatApiError(err, "خطایی رخ داد؛ دوباره تلاش کنید."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      data-theme={localStorage.getItem("app-theme") || "dark"}
      className="login-page min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 relative overflow-hidden"
      dir="rtl"
    >
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob"></div>
      <div className="absolute top-[20%] right-[-10%] w-96 h-96 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-2000"></div>

      <div className="relative z-10 w-full max-w-md p-8 bg-white/10 backdrop-blur-lg border border-white/20 rounded-3xl shadow-[0_8px_32px_0_rgba(0,0,0,0.37)]">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">
            بازیابی رمز عبور
          </h1>
          <p className="text-blue-200/80 text-sm">
            {step === 1
              ? "کد بازیابی به ایمیل‌تان می‌رسد"
              : "رمز تازه را ثبت کنید"}
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-xl text-red-100 text-sm text-center">
            {error}
          </div>
        )}
        {notice && (
          <div className="mb-6 p-4 bg-emerald-500/20 border border-emerald-500/50 rounded-xl text-emerald-100 text-sm text-center">
            {notice}
          </div>
        )}

        {step === 1 ? (
          <form onSubmit={submitRequest} className="space-y-6">
            <div>
              <label className={labelClass}>نام کاربری یا ایمیل</label>
              <input
                type="text"
                value={identifier}
                dir="ltr"
                onChange={(e) => setIdentifier(e.target.value)}
                className={inputClass}
                required
              />
            </div>
            <CaptchaField
              key={captchaKey}
              dark
              onChange={(id, answer) => setCaptcha({ id, answer })}
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-semibold shadow-lg shadow-blue-500/30 transition-all active:scale-[0.98] disabled:opacity-70"
            >
              {loading ? "در حال ارسال…" : "ارسال کد بازیابی"}
            </button>
          </form>
        ) : (
          <form onSubmit={submitReset} className="space-y-4">
            <div>
              <label className={labelClass}>کد بازیابی</label>
              <input
                type="text"
                value={code}
                dir="ltr"
                inputMode="numeric"
                onChange={(e) => setCode(e.target.value)}
                className={`${inputClass} text-center tracking-[0.4em]`}
                placeholder="••••••"
                required
              />
            </div>
            <div>
              <label className={labelClass}>رمز عبور تازه</label>
              <PasswordInput
                value={newPassword}
                dir="ltr"
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputClass}
                placeholder="••••••••"
                required
              />
              <ul className="mt-2 space-y-1 text-xs">
                {checks.map((check) => (
                  <li
                    key={check.key}
                    className={
                      check.ok ? "text-emerald-300" : "text-blue-200/60"
                    }
                  >
                    {check.ok ? "✓" : "○"} {check.label}
                  </li>
                ))}
              </ul>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-semibold shadow-lg shadow-blue-500/30 transition-all active:scale-[0.98] disabled:opacity-70"
            >
              {loading ? "در حال ثبت…" : "ثبت رمز تازه"}
            </button>
          </form>
        )}

        <p className="text-center text-sm text-blue-200/80 mt-6">
          <Link to="/login" className="text-white font-medium hover:underline">
            بازگشت به ورود
          </Link>
        </p>
      </div>
    </div>
  );
};

export default ForgotPassword;
