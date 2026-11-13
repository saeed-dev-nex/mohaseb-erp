import React, { useState } from "react";
import { useDispatch } from "react-redux";
import { Link, useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { setTokens, setCurrentUser } from "../features/authSlice";
import api, { API_BASE_URL, accountSecurityAPI } from "../services/api";
import { queryClient } from "../lib/queryClient";
import PasswordInput from "../components/PasswordInput";
import CaptchaField from "../components/CaptchaField";
import { formatApiError } from "../utils/apiError";

const inputClass =
  "w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:ring-2 focus:ring-blue-400 focus:border-transparent text-white placeholder-blue-200/50 transition-all outline-none";
const labelClass = "block text-sm font-medium text-blue-100 mb-2";
const submitClass =
  "w-full py-3.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-semibold shadow-lg shadow-blue-500/30 transform transition-all active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center";

const Login = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captcha, setCaptcha] = useState({ id: "", answer: "" });
  const [captchaKey, setCaptchaKey] = useState(0);
  const [mode, setMode] = useState<"password" | "otp">("password");
  const [otpStep, setOtpStep] = useState(1);
  const [otpCode, setOtpCode] = useState("");
  const [otpNotice, setOtpNotice] = useState("");

  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;

  /** Shared post-login completion for password and OTP sign-ins. */
  const completeLogin = async (access: string) => {
    queryClient.clear();
    dispatch(setCurrentUser(null));
    dispatch(setTokens({ access }));
    try {
      const meRes = await api.get("users/me/", {
        headers: { Authorization: `Bearer ${access}` },
      });
      dispatch(setCurrentUser(meRes.data));
    } catch (_) {
      // Logged in but profile-less is a broken state (no modules, no
      // navigation, no explanation) — say so and stay on the form.
      setError(
        "ورود انجام شد، اما دریافت مشخصات کاربر از سرور ناموفق بود. دوباره تلاش کنید.",
      );
      return;
    }
    navigate("/");
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const payload: Record<string, string> = { username, password };
      if (captchaRequired) {
        payload.captcha_id = captcha.id;
        payload.captcha_answer = captcha.answer;
      }
      const response = await axios.post(`${API_BASE_URL}token/`, payload, {
        withCredentials: true,
        headers: { "X-Client-Type": "web" },
      });
      // For the web client the backend returns no refresh token in the
      // body; it is stored in an httpOnly cookie instead.
      await completeLogin(response.data.access);
    } catch (err: any) {
      if (!err?.response) {
        setError(
          "ارتباط با سرور برقرار نشد. از روشن بودن سرور مطمئن شوید و دوباره تلاش کنید.",
        );
      } else if (err.response.status === 429) {
        setError(
          "به‌دلیل تلاش‌های پی‌درپی، ورود موقتاً محدود شده است؛ یک دقیقه صبر کنید.",
        );
      } else if (err.response.data?.captcha_required) {
        // Repeated failures: the server now demands a CAPTCHA.
        setCaptchaRequired(true);
        setCaptchaKey((key) => key + 1);
        setError(
          err.response.data?.detail ||
            "برای ادامه، کد امنیتی تصویر را وارد کنید.",
        );
      } else {
        setError("نام کاربری یا رمز عبور اشتباه است.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOtpRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await accountSecurityAPI.otpRequest(username.trim());
      setOtpStep(2);
      setOtpNotice("اگر حسابی با این مشخصات باشد، کد ورود به ایمیلش ارسال شد.");
    } catch (err) {
      setError(formatApiError(err, "ارسال کد ناموفق بود."));
    } finally {
      setLoading(false);
    }
  };

  const handleOtpVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await accountSecurityAPI.otpVerify({
        identifier: username.trim(),
        code: otpCode.trim(),
      });
      await completeLogin(response.data.access);
    } catch (err) {
      setError(formatApiError(err, "کد ورود نادرست یا منقضی است."));
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
      {/* Decorative background elements */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob"></div>
      <div className="absolute top-[20%] right-[-10%] w-96 h-96 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-2000"></div>
      <div className="absolute bottom-[-20%] left-[20%] w-96 h-96 bg-indigo-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-4000"></div>

      <div className="relative z-10 w-full max-w-md p-8 bg-white/10 backdrop-blur-lg border border-white/20 rounded-3xl shadow-[0_8px_32px_0_rgba(0,0,0,0.37)]">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2 tracking-tight">
            محاسب پرو
          </h1>
          <p className="text-blue-200/80 text-sm">
            ورود به سیستم مدیریت مالی و فاکتور
          </p>
        </div>

        {notice && (
          <div className="mb-6 p-4 bg-emerald-500/20 border border-emerald-500/50 rounded-xl text-emerald-100 text-sm text-center">
            {notice}
          </div>
        )}
        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-xl text-red-100 text-sm text-center">
            {error}
          </div>
        )}

        {mode === "password" ? (
          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className={labelClass}>نام کاربری</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={inputClass}
                placeholder="نام کاربری خود را وارد کنید"
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
              <div className="text-left mt-2">
                <Link
                  to="/forgot-password"
                  className="text-xs text-blue-200/80 hover:text-white"
                >
                  رمز عبور را فراموش کرده‌ام
                </Link>
              </div>
            </div>

            {captchaRequired && (
              <CaptchaField
                key={captchaKey}
                dark
                onChange={(id, answer) => setCaptcha({ id, answer })}
              />
            )}

            <button type="submit" disabled={loading} className={submitClass}>
              {loading ? (
                <svg
                  className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
              ) : (
                "ورود به حساب"
              )}
            </button>
          </form>
        ) : otpStep === 1 ? (
          <form onSubmit={handleOtpRequest} className="space-y-6">
            <div>
              <label className={labelClass}>نام کاربری یا ایمیل</label>
              <input
                type="text"
                value={username}
                dir="ltr"
                onChange={(e) => setUsername(e.target.value)}
                className={inputClass}
                placeholder="نام کاربری یا ایمیل حساب"
                required
              />
              <p className="text-blue-200/60 text-xs mt-2">
                کد ورود به ایمیل ثبت‌شده در حسابتان ارسال می‌شود.
              </p>
            </div>
            <button type="submit" disabled={loading} className={submitClass}>
              {loading ? "در حال ارسال…" : "ارسال کد ورود"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleOtpVerify} className="space-y-6">
            {otpNotice && (
              <div className="p-4 bg-emerald-500/20 border border-emerald-500/50 rounded-xl text-emerald-100 text-sm text-center">
                {otpNotice}
              </div>
            )}
            <div>
              <label className={labelClass}>کد ورود</label>
              <input
                type="text"
                value={otpCode}
                dir="ltr"
                inputMode="numeric"
                onChange={(e) => setOtpCode(e.target.value)}
                className={`${inputClass} text-center tracking-[0.4em]`}
                placeholder="••••••"
                required
              />
            </div>
            <button type="submit" disabled={loading} className={submitClass}>
              {loading ? "در حال بررسی…" : "ورود با کد"}
            </button>
            <button
              type="button"
              onClick={() => setOtpStep(1)}
              className="w-full text-sm text-blue-200 hover:text-white"
            >
              بازگشت و ارسال دوباره
            </button>
          </form>
        )}

        <div className="mt-6 space-y-2 text-center text-sm">
          <button
            type="button"
            onClick={() => {
              setMode(mode === "password" ? "otp" : "password");
              setError("");
            }}
            className="block w-full text-blue-200 hover:text-white"
          >
            {mode === "password"
              ? "ورود سریع با کد تأیید ایمیلی"
              : "ورود با نام کاربری و رمز عبور"}
          </button>
          <p className="text-blue-200/80">
            حساب ندارید؟{" "}
            <Link
              to="/register"
              className="text-white font-medium hover:underline"
            >
              ثبت‌نام با کد مجوز
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
