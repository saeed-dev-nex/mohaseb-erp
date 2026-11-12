import { useEffect, useState } from "react";
import { databaseConfigAPI } from "../../services/api";
import PasswordInput from "../../components/PasswordInput";
import { hideWaiting, showWaiting } from "../../lib/waiting";
import { F, Section, inp } from "./shared";

type DbStatus = {
  engine: "sqlite" | "postgresql";
  source: "env" | "file" | "default";
  pending: boolean;
  name?: string | null;
  host?: string | null;
  last_migration?: {
    ok: boolean;
    at: string;
    counts: Record<string, number> | null;
    error: string;
  } | null;
};

type DbForm = {
  host: string;
  port: number | string;
  name: string;
  user: string;
  password: string;
};

const totalRecords = (counts: Record<string, number> | null | undefined) =>
  counts ? Object.values(counts).reduce((sum, n) => sum + n, 0) : 0;

// Database tab (superuser only): shows the active engine and hosts the
// guided SQLite → PostgreSQL migration wizard. The switch itself is
// staged by the backend and takes effect on the next server restart;
// rolling back just drops the staged config.
export const DatabaseTab = ({ isSuperuser }: { isSuperuser: boolean }) => {
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  const [form, setForm] = useState<DbForm>({
    host: "localhost",
    port: 5432,
    name: "mohaseb",
    user: "mohaseb",
    password: "",
  });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [testing, setTesting] = useState(false);
  const [confirmRollback, setConfirmRollback] = useState(false);
  const [startedCounts, setStartedCounts] = useState<Record<
    string,
    number
  > | null>(null);

  const load = async () => {
    try {
      const { data } = await databaseConfigAPI.get();
      setDbStatus(data);
    } catch {
      setErr("دریافت وضعیت پایگاه داده انجام نشد.");
    }
  };

  useEffect(() => {
    if (isSuperuser) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperuser]);

  const payload = () => ({
    host: form.host,
    port: Number(form.port) || 5432,
    name: form.name,
    user: form.user,
    password: form.password,
  });

  const handleTest = async () => {
    setMsg("");
    setErr("");
    setTesting(true);
    try {
      await databaseConfigAPI.testConnection(payload());
      setMsg("اتصال برقرار است و دیتابیس مقصد خالی و آمادهٔ مهاجرت است. ✅");
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      setErr(detail || "تست اتصال انجام نشد.");
    } finally {
      setTesting(false);
    }
  };

  const handleStart = async () => {
    setMsg("");
    setErr("");
    showWaiting("در حال آماده‌سازی مهاجرت به PostgreSQL…");
    try {
      const { data } = await databaseConfigAPI.startMigration(payload());
      setStartedCounts(data.counts || null);
      await load();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      setErr(detail || "شروع مهاجرت انجام نشد.");
    } finally {
      hideWaiting();
    }
  };

  const handleRollback = async () => {
    setMsg("");
    setErr("");
    try {
      await databaseConfigAPI.rollback();
      setConfirmRollback(false);
      setStartedCounts(null);
      setMsg(
        "انجام شد؛ بعد از ری‌استارت برنامه، پایگاه داده به حالت قبل برمی‌گردد.",
      );
      await load();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      setErr(detail || "بازگشت انجام نشد.");
    }
  };

  if (!dbStatus) {
    return (
      <Section title="پایگاه داده" icon="🗄️">
        <p className="text-slate-400 text-sm">در حال بارگذاری…</p>
      </Section>
    );
  }

  return (
    <div className="space-y-6">
      <Section title="پایگاه دادهٔ فعلی" icon="🗄️">
        {dbStatus.engine === "postgresql" ? (
          <p className="text-sm text-slate-300">
            برنامه روی <span className="text-emerald-400">PostgreSQL</span> اجرا
            می‌شود
            {dbStatus.name ? (
              <>
                {" "}
                — دیتابیس «{dbStatus.name}» روی {dbStatus.host}
              </>
            ) : null}
            .
          </p>
        ) : (
          <p className="text-sm text-slate-300">
            برنامه روی <span className="text-amber-400">SQLite</span> (فایل
            محلی) اجرا می‌شود؛ برای یک سیستم کافی است، ولی برای چند اپراتور
            همزمان PostgreSQL مطمئن‌تر و سریع‌تر است.
          </p>
        )}
        {dbStatus.source === "env" && (
          <p className="text-xs text-slate-500 mt-2">
            این پایگاه داده با متغیر محیطی DATABASE_URL مدیریت می‌شود و از داخل
            برنامه قابل تغییر نیست.
          </p>
        )}
        {dbStatus.last_migration && (
          <div
            className={`mt-3 text-xs rounded-xl px-3 py-2 border ${
              dbStatus.last_migration.ok
                ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/30"
                : "text-rose-300 bg-rose-500/10 border-rose-500/30"
            }`}
          >
            {dbStatus.last_migration.ok
              ? `آخرین مهاجرت با موفقیت انجام شد — ${totalRecords(
                  dbStatus.last_migration.counts,
                ).toLocaleString("fa-IR")} رکورد منتقل شد.`
              : `آخرین تلاش برای مهاجرت ناموفق بود: ${dbStatus.last_migration.error}`}
          </div>
        )}
        {msg && <p className="text-emerald-400 text-xs mt-3">{msg}</p>}
        {err && <p className="text-rose-400 text-xs mt-3">{err}</p>}
      </Section>

      {dbStatus.engine === "postgresql" && dbStatus.source === "default" ? (
        <Section title="بازگشت در انتظار ری‌استارت" icon="⏳">
          <p className="text-sm text-amber-300">
            بازگشت به SQLite ثبت شده است، ولی این اجرا هنوز روی PostgreSQL کار
            می‌کند. <strong>برنامه را ری‌استارت کنید</strong> تا روی SQLite بالا
            بیاید.
          </p>
        </Section>
      ) : dbStatus.pending ? (
        <Section title="مهاجرت در انتظار ری‌استارت" icon="⏳">
          <p className="text-sm text-amber-300">
            داده‌ها خروجی گرفته شده و مهاجرت آماده است.{" "}
            <strong>حالا برنامه را ری‌استارت کنید</strong> (پنجره‌های سرور را
            ببندید و دوباره اجرا کنید) تا روی PostgreSQL بالا بیاید و داده‌ها
            به‌صورت خودکار وارد شوند.
          </p>
          <p className="text-xs text-slate-400 mt-2">
            تا قبل از ری‌استارت برنامه روی SQLite کار می‌کند؛ داده‌ای که از این
            لحظه به بعد ثبت شود در مهاجرت نخواهد بود، پس ری‌استارت را عقب
            نیندازید.
          </p>
          {startedCounts && (
            <p className="text-xs text-slate-400 mt-2">
              رکوردهای آمادهٔ انتقال:{" "}
              {totalRecords(startedCounts).toLocaleString("fa-IR")}
            </p>
          )}
          <button
            onClick={handleRollback}
            className="mt-4 px-4 py-2 rounded-xl bg-slate-700/60 hover:bg-slate-700 text-slate-200 text-xs transition-all"
          >
            لغو مهاجرت
          </button>
        </Section>
      ) : dbStatus.engine === "sqlite" && dbStatus.source !== "env" ? (
        <Section title="مهاجرت به PostgreSQL" icon="🐘">
          <div className="space-y-4">
            <p className="text-xs text-slate-400 leading-6">
              اول در PostgreSQL یک دیتابیس <strong>خالی</strong> بسازید (مثلاً
              در pgAdmin: راست‌کلیک روی Databases و ساخت دیتابیس، و یک کاربر با
              قابلیت ورود) و بعد مشخصاتش را اینجا وارد کنید. برنامه اتصال را تست
              می‌کند، از همهٔ داده‌ها خروجی می‌گیرد و بعد از یک ری‌استارت، روی
              PostgreSQL با همان داده‌ها بالا می‌آید. فایل SQLite در تمام مدت
              دست‌نخورده می‌ماند و هر وقت خواستید می‌توانید برگردید.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <F label="هاست">
                <input
                  className={inp}
                  dir="ltr"
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                />
              </F>
              <F label="پورت">
                <input
                  className={inp}
                  dir="ltr"
                  type="number"
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: e.target.value })}
                />
              </F>
              <F label="نام دیتابیس">
                <input
                  className={inp}
                  dir="ltr"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </F>
              <F label="نام کاربری">
                <input
                  className={inp}
                  dir="ltr"
                  value={form.user}
                  onChange={(e) => setForm({ ...form, user: e.target.value })}
                />
              </F>
              <F label="رمز عبور">
                <PasswordInput
                  className={inp}
                  dir="ltr"
                  value={form.password}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                />
              </F>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleTest}
                disabled={testing}
                className="px-4 py-2.5 rounded-xl bg-slate-700/60 hover:bg-slate-700 text-slate-100 text-xs transition-all disabled:opacity-50"
              >
                {testing ? "در حال تست…" : "تست اتصال"}
              </button>
              <button
                onClick={handleStart}
                className="px-4 py-2.5 rounded-xl bg-gradient-to-l from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white text-xs font-medium transition-all"
              >
                شروع مهاجرت
              </button>
            </div>
          </div>
        </Section>
      ) : dbStatus.engine === "postgresql" && dbStatus.source === "file" ? (
        <Section title="بازگشت به SQLite" icon="↩️">
          <p className="text-xs text-slate-400 leading-6">
            با بازگشت، برنامه بعد از ری‌استارت دوباره روی فایل SQLite قبلی بالا
            می‌آید. توجه: داده‌هایی که در مدت استفاده از PostgreSQL ثبت شده‌اند
            به SQLite برنمی‌گردند (SQLite همان وضعیت زمان مهاجرت را دارد).
          </p>
          {confirmRollback ? (
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <span className="text-xs text-amber-300">
                مطمئن هستید؟ این کار بعد از ری‌استارت اعمال می‌شود.
              </span>
              <button
                onClick={handleRollback}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs transition-all"
              >
                بله، بازگشت به SQLite
              </button>
              <button
                onClick={() => setConfirmRollback(false)}
                className="px-4 py-2 rounded-xl bg-slate-700/60 hover:bg-slate-700 text-slate-200 text-xs transition-all"
              >
                انصراف
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmRollback(true)}
              className="mt-4 px-4 py-2.5 rounded-xl bg-slate-700/60 hover:bg-slate-700 text-slate-100 text-xs transition-all"
            >
              بازگشت به SQLite
            </button>
          )}
        </Section>
      ) : null}
    </div>
  );
};
