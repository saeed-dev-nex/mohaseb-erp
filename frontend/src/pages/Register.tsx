import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import CaptchaField from "../components/CaptchaField";
import PasswordInput from "../components/PasswordInput";
import { registrationAPI } from "../services/api";
import { passwordChecks } from "../lib/passwordPolicy";
import { formatApiError } from "../utils/apiError";

const inputClass =
  "w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:ring-2 focus:ring-blue-400 focus:border-transparent text-white placeholder-blue-200/50 transition-all outline-none";
const labelClass = "block text-sm font-medium text-blue-100 mb-2";

/** Self-service signup: license code → account → email activation. */
const Register = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [licenseCode, setLicenseCode] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [captcha, setCaptcha] = useState({ id: "", answer: "" });
  const [verifyCode, setVerifyCode] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [captchaKey, setCaptchaKey] = useState(0);

  const checks = passwordChecks(password);

  const runStep = async (fn: () => Promise<void>) => {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (err) {
      setError(formatApiError(err, "خطایی رخ داد؛ دوباره تلاش کنید."));
      setCaptchaKey((key) => key + 1); // challenges are one-shot
    } finally {
      setLoading(false);
    }
  };

  const submitCode = (e: React.FormEvent) => {
    e.preventDefault();
    runStep(async () => {
      await registrationAPI.checkCode(licenseCode.trim());
      setStep(2);
    });
  };

  const submitAccount = (e: React.FormEvent) => {
    e.preventDefault();
    runStep(async () => {
      await registrationAPI.register({
        code: licenseCode.trim(),
        username: username.trim(),
        email: email.trim(),
        password,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        captcha_id: captcha.id,
        captcha_answer: captcha.answer,
      });
      setStep(3);
      setNotice("کد تأیید به ایمیل‌تان ارسال شد.");
    });
  };

  const submitVerify = (e: React.FormEvent) => {
    e.preventDefault();
    runStep(async () => {
      await registrationAPI.verifyEmail({
        username: username.trim(),
        code: verifyCode.trim(),
      });
      navigate("/login", {
        state: { notice: "حساب‌تان فعال شد؛ حالا وارد شوید." },
      });
    });
  };

  const resend = () =>
    runStep(async () => {
      await registrationAPI.resendCode(username.trim());
      setNotice("اگر حسابی در انتظار فعال‌سازی باشد، کد تازه ارسال شد.");
    });

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
            ثبت‌نام محاسب ERP
          </h1>
          <p className="text-blue-200/80 text-sm">
            گام {step} از ۳ —{" "}
            {step === 1
              ? "کد مجوز"
              : step === 2
                ? "مشخصات حساب"
                : "تأیید ایمیل"}
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

        {step === 1 && (
          <form onSubmit={submitCode} className="space-y-6">
            <div>
              <label className={labelClass}>کد مجوز ثبت‌نام</label>
              <input
                type="text"
                value={licenseCode}
                dir="ltr"
                onChange={(e) => setLicenseCode(e.target.value)}
                className={`${inputClass} text-center tracking-widest uppercase`}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                required
              />
              <p className="text-blue-200/60 text-xs mt-2">
                کد مجوز را از فروشنده یا مدیر سیستم دریافت می‌کنید؛ هر کد فقط
                برای ساخت یک حساب است.
              </p>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-semibold shadow-lg shadow-blue-500/30 transition-all active:scale-[0.98] disabled:opacity-70"
            >
              {loading ? "در حال بررسی…" : "ادامه"}
            </button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={submitAccount} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>نام</label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>نام خانوادگی</label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label className={labelClass}>نام کاربری</label>
              <input
                type="text"
                value={username}
                dir="ltr"
                onChange={(e) => setUsername(e.target.value)}
                className={inputClass}
                required
              />
            </div>
            <div>
              <label className={labelClass}>ایمیل</label>
              <input
                type="email"
                value={email}
                dir="ltr"
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                placeholder="you@example.com"
                required
              />
            </div>
            <div>
              <label className={labelClass}>رمز عبور</label>
              <PasswordInput
                value={password}
                dir="ltr"
                onChange={(e) => setPassword(e.target.value)}
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
              {loading ? "در حال ساخت حساب…" : "ساخت حساب"}
            </button>
          </form>
        )}

        {step === 3 && (
          <form onSubmit={submitVerify} className="space-y-6">
            <div>
              <label className={labelClass}>کد تأیید ایمیل</label>
              <input
                type="text"
                value={verifyCode}
                dir="ltr"
                inputMode="numeric"
                onChange={(e) => setVerifyCode(e.target.value)}
                className={`${inputClass} text-center tracking-[0.4em]`}
                placeholder="••••••"
                required
              />
              <p className="text-blue-200/60 text-xs mt-2">
                کد ۶رقمی به ایمیل {email} ارسال شد و ۱۰ دقیقه اعتبار دارد.
              </p>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-semibold shadow-lg shadow-blue-500/30 transition-all active:scale-[0.98] disabled:opacity-70"
            >
              {loading ? "در حال بررسی…" : "فعال‌سازی حساب"}
            </button>
            <button
              type="button"
              onClick={resend}
              disabled={loading}
              className="w-full text-sm text-blue-200 hover:text-white"
            >
              ارسال دوبارهٔ کد
            </button>
          </form>
        )}

        <p className="text-center text-sm text-blue-200/80 mt-6">
          حساب دارید؟{" "}
          <Link to="/login" className="text-white font-medium hover:underline">
            ورود
          </Link>
        </p>
      </div>
    </div>
  );
};

export default Register;
