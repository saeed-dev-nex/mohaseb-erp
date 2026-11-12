import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { setupAPI } from "../services/api";

const inp =
  "w-full px-3 py-2.5 bg-slate-700/50 border border-slate-600/50 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all";

type Step = "loading" | "database" | "restart" | "admin" | "done";

export default function SetupWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("loading");
  const [engine, setEngine] = useState("sqlite");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pg, setPg] = useState({
    host: "localhost",
    port: 5432,
    name: "",
    user: "postgres",
    password: "",
  });
  const [admin, setAdmin] = useState({
    username: "",
    first_name: "",
    last_name: "",
    password: "",
    password_confirm: "",
  });

  useEffect(() => {
    setupAPI
      .status()
      .then((res) => {
        if (!res.data.needs_setup) {
          navigate("/login", { replace: true });
          return;
        }
        setEngine(res.data.engine);
        setStep(res.data.engine === "postgresql" ? "admin" : "database");
      })
      .catch(() => setStep("database"));
  }, [navigate]);

  const detailOf = (err: unknown, fallback: string) =>
    (err as { response?: { data?: { detail?: string } } })?.response?.data
      ?.detail || fallback;

  const testPg = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await setupAPI.testDatabase(pg);
      setNotice("اتصال به PostgreSQL برقرار است و دیتابیس خالی و آماده است.");
    } catch (err) {
      setError(detailOf(err, "تست اتصال انجام نشد."));
    } finally {
      setBusy(false);
    }
  };

  const configurePg = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await setupAPI.configureDatabase(pg);
      if (res.data.restart_required) setStep("restart");
    } catch (err) {
      setError(detailOf(err, "تنظیم دیتابیس انجام نشد."));
    } finally {
      setBusy(false);
    }
  };

  const createAdmin = async () => {
    setBusy(true);
    setError("");
    try {
      await setupAPI.createAdmin(admin);
      setStep("done");
    } catch (err) {
      setError(detailOf(err, "ساخت حساب مدیر انجام نشد."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-lg rounded-3xl bg-slate-800/70 border border-slate-700/60 p-6 space-y-5">
        <div className="text-center space-y-1">
          <div className="text-4xl">🚀</div>
          <h1 className="text-xl font-bold text-white">
            راه‌اندازی اولیهٔ محاسب ERP
          </h1>
          <p className="text-sm text-slate-400">
            هنوز حساب مدیری ساخته نشده است؛ این ویزارد یک‌بار نمایش داده می‌شود.
          </p>
        </div>

        {error && (
          <p className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
            {error}
          </p>
        )}
        {notice && (
          <p className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2">
            {notice}
          </p>
        )}

        {step === "loading" && (
          <p className="text-center text-slate-400 text-sm">در حال بررسی…</p>
        )}

        {step === "database" && (
          <div className="space-y-4">
            <h2 className="text-white font-bold text-sm">
              گام ۱ از ۲ — پایگاه داده
            </h2>
            <button
              type="button"
              onClick={() => setStep("admin")}
              className="w-full text-right rounded-2xl border border-slate-600/60 bg-slate-700/30 hover:bg-slate-700/60 px-4 py-3 transition-all"
            >
              <span className="block text-white text-sm font-bold">
                ادامه با دیتابیس داخلی (SQLite)
              </span>
              <span className="block text-xs text-slate-400 mt-1">
                ساده و بدون تنظیم؛ برای شروع و کسب‌وکارهای کوچک کافی است. بعداً
                از تنظیمات می‌توانید به PostgreSQL مهاجرت کنید.
              </span>
            </button>
            <div className="rounded-2xl border border-slate-600/60 px-4 py-3 space-y-2">
              <span className="block text-white text-sm font-bold">
                PostgreSQL (پیشنهاد برای چند کاربر همزمان)
              </span>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className={inp}
                  placeholder="هاست"
                  value={pg.host}
                  onChange={(e) => setPg({ ...pg, host: e.target.value })}
                />
                <input
                  className={inp}
                  placeholder="پورت"
                  type="number"
                  value={pg.port}
                  onChange={(e) =>
                    setPg({ ...pg, port: Number(e.target.value) || 5432 })
                  }
                />
                <input
                  className={inp}
                  placeholder="نام دیتابیس (خالیِ ساخته‌شده در pgAdmin)"
                  value={pg.name}
                  onChange={(e) => setPg({ ...pg, name: e.target.value })}
                />
                <input
                  className={inp}
                  placeholder="نام کاربری"
                  value={pg.user}
                  onChange={(e) => setPg({ ...pg, user: e.target.value })}
                />
                <input
                  className={`${inp} col-span-2`}
                  placeholder="رمز عبور PostgreSQL"
                  type="password"
                  value={pg.password}
                  onChange={(e) => setPg({ ...pg, password: e.target.value })}
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={testPg}
                  className="px-4 py-2 rounded-xl bg-slate-600 hover:bg-slate-500 text-white text-sm disabled:opacity-50"
                >
                  تست اتصال
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={configurePg}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm disabled:opacity-50"
                >
                  ذخیره و ادامه
                </button>
              </div>
              <p className="text-xs text-slate-500">
                دیتابیس باید از قبل در pgAdmin ساخته و خالی باشد. پس از ذخیره،
                برنامه یک بار بسته و دوباره اجرا می‌شود و ویزارد برای ساخت حساب
                مدیر برمی‌گردد.
              </p>
            </div>
          </div>
        )}

        {step === "restart" && (
          <div className="space-y-3 text-center">
            <div className="text-4xl">🔄</div>
            <h2 className="text-white font-bold">
              تنظیمات PostgreSQL ذخیره شد
            </h2>
            <p className="text-sm text-slate-300">
              برنامه را یک بار کامل ببندید و دوباره اجرا کنید. پس از اجرا،
              برنامه روی PostgreSQL بالا می‌آید و همین ویزارد برای ساخت حساب
              مدیر سیستم نمایش داده می‌شود.
            </p>
          </div>
        )}

        {step === "admin" && (
          <div className="space-y-3">
            <h2 className="text-white font-bold text-sm">
              گام ۲ از ۲ — حساب مدیر سیستم
              {engine === "postgresql" && (
                <span className="text-slate-400 font-normal">
                  {" "}
                  (پایگاه داده: PostgreSQL)
                </span>
              )}
            </h2>
            <div className="grid grid-cols-2 gap-2">
              <input
                className={inp}
                placeholder="نام کاربری *"
                value={admin.username}
                onChange={(e) =>
                  setAdmin({ ...admin, username: e.target.value })
                }
              />
              <input
                className={inp}
                placeholder="نام"
                value={admin.first_name}
                onChange={(e) =>
                  setAdmin({ ...admin, first_name: e.target.value })
                }
              />
              <input
                className={inp}
                placeholder="نام خانوادگی"
                value={admin.last_name}
                onChange={(e) =>
                  setAdmin({ ...admin, last_name: e.target.value })
                }
              />
              <input
                className={inp}
                placeholder="رمز عبور (دست‌کم ۸ نویسه) *"
                type="password"
                value={admin.password}
                onChange={(e) =>
                  setAdmin({ ...admin, password: e.target.value })
                }
              />
              <input
                className={`${inp} col-span-2`}
                placeholder="تکرار رمز عبور *"
                type="password"
                value={admin.password_confirm}
                onChange={(e) =>
                  setAdmin({ ...admin, password_confirm: e.target.value })
                }
              />
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={createAdmin}
              className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold disabled:opacity-50"
            >
              ساخت حساب مدیر و پایان راه‌اندازی
            </button>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-3 text-center">
            <div className="text-4xl">✅</div>
            <h2 className="text-white font-bold">راه‌اندازی تمام شد</h2>
            <p className="text-sm text-slate-300">
              حساب مدیر ساخته شد. حالا با همان نام کاربری و رمز وارد شوید.
            </p>
            <button
              type="button"
              onClick={() => {
                window.location.href = "/login";
              }}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold"
            >
              رفتن به صفحهٔ ورود
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
