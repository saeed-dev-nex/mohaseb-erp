import React, { useCallback, useEffect, useState } from "react";
import { appUpdateAPI } from "../../services/api";
import { hideWaiting, showWaiting } from "../../lib/waiting";
import { F, inp, Section } from "./shared";

type UpdateStatus = {
  available: boolean;
  reason: string;
  current_version: string;
  branch: string;
  current_sha: string;
  remote_sha: string;
  behind: number;
  latest_version: string;
  changes: { version: string; items: string[] }[];
  checked_at: string;
  approved_pending: boolean;
};

const faNum = (value: number) => value.toLocaleString("fa-IR");

const faDateTime = (value: string) =>
  value
    ? `${new Date(value).toLocaleDateString("fa-IR")} - ${new Date(value).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })}`
    : "—";

/** Superuser-only update panel: see what the next version changes,
 * then approve installing it at a quiet moment. The launcher no
 * longer pulls updates on its own. */
export const UpdateTab = ({ isSuperuser }: { isSuperuser: boolean }) => {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await appUpdateAPI.status();
      setStatus(data as UpdateStatus);
    } catch {
      setError("دریافت وضعیت به‌روزرسانی انجام نشد.");
    }
  }, []);

  useEffect(() => {
    if (isSuperuser) void load();
  }, [isSuperuser, load]);

  if (!isSuperuser) return null;

  const checkNow = async () => {
    setChecking(true);
    setError("");
    showWaiting("در حال بررسی نسخهٔ جدید…");
    try {
      const { data } = await appUpdateAPI.check();
      setStatus(data as UpdateStatus);
      setConfirming(false);
    } catch {
      setError(
        "بررسی به‌روزرسانی انجام نشد. اتصال اینترنت سرور را بررسی کنید.",
      );
    } finally {
      hideWaiting();
      setChecking(false);
    }
  };

  const apply = async () => {
    setError("");
    showWaiting("در حال آماده‌سازی نصب آپدیت…");
    try {
      await appUpdateAPI.apply();
      setApplied(true);
      setConfirming(false);
    } catch (err: any) {
      setError(
        err?.response?.data?.detail ||
          "ثبت تأیید آپدیت انجام نشد. دوباره تلاش کنید.",
      );
    } finally {
      hideWaiting();
    }
  };

  const hasUpdate = Boolean(status?.available && status.behind > 0 && !applied);

  return (
    <div className="space-y-6">
      <Section icon="⬆️" title="به‌روزرسانی برنامه">
        <p className="mb-4 text-sm leading-6 text-slate-400">
          آپدیت‌ها دیگر خودکار و بی‌خبر نصب نمی‌شوند. وقتی نسخهٔ تازه‌ای برسد،
          اول تغییراتش را همین‌جا می‌بینید و فقط وقتی خودتان تأیید کنید — در
          زمانی که سامانه زیر بار نیست — نصب می‌شود.
        </p>
        {error && (
          <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {!status && !error && (
          <p className="text-sm text-slate-400">در حال بارگذاری…</p>
        )}

        {status && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <F label="نسخهٔ فعلی">
                <input
                  className={inp}
                  value={status.current_version || "—"}
                  readOnly
                  dir="ltr"
                />
              </F>
              <F label="شاخهٔ دریافتی">
                <input
                  className={inp}
                  value={status.branch || "—"}
                  readOnly
                  dir="ltr"
                />
              </F>
              <F label="آخرین بررسی">
                <input
                  className={inp}
                  value={faDateTime(status.checked_at)}
                  readOnly
                />
              </F>
            </div>

            {status.available && status.behind === 0 && !applied && (
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-300">
                ✅ برنامه به‌روز است؛ نسخهٔ تازه‌ای در انتظار نصب نیست.
              </div>
            )}

            {!status.available && status.reason && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-300">
                ⚠️ {status.reason}
              </div>
            )}

            {status.approved_pending && !applied && (
              <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-4 text-sm text-sky-300">
                ℹ️ یک آپدیت قبلاً تأیید شده و در شروع بعدی برنامه اعمال می‌شود.
              </div>
            )}

            <div>
              <button
                type="button"
                onClick={checkNow}
                disabled={checking}
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700/40 disabled:opacity-50"
              >
                {checking ? "در حال بررسی…" : "🔍 بررسی مجدد"}
              </button>
            </div>
          </div>
        )}
      </Section>

      {hasUpdate && status && (
        <Section
          icon="📦"
          title={`نسخهٔ جدید آماده است: ${status.latest_version || "نسخهٔ تازه"}`}
        >
          <p className="mb-4 text-sm leading-6 text-slate-400">
            {faNum(status.behind)} تغییر در راه است. پیش از نصب، فهرست تغییرات
            را بخوانید؛ به‌خصوص موارد مهم را.
          </p>
          <div className="space-y-5">
            {status.changes.length === 0 && (
              <p className="text-sm text-slate-400">
                فهرست تغییراتی برای این نسخه ثبت نشده است.
              </p>
            )}
            {status.changes.map((section) => (
              <div key={section.version}>
                <h4
                  className="mb-2 text-sm font-bold text-slate-200"
                  dir="ltr"
                  style={{ textAlign: "right" }}
                >
                  {section.version === "Unreleased"
                    ? "تغییرات در راه"
                    : `نسخهٔ ${section.version}`}
                </h4>
                <ul className="list-disc space-y-1.5 pr-5 text-sm leading-6 text-slate-300 marker:text-slate-500">
                  {section.items.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}

            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm leading-6 text-amber-300">
              ⏰ نصب آپدیت برنامه را چند لحظه از دسترس خارج می‌کند و بعد خودش
              دوباره بالا می‌آید. این کار را وقتی انجام دهید که سامانه زیر بار
              نیست و می‌توانید آن را خاموش کنید.
            </div>

            {!confirming ? (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                ⬆️ نصب آپدیت
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={apply}
                  className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  تأیید نهایی و نصب
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-lg border border-slate-600 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-700/40"
                >
                  فعلاً نه
                </button>
              </div>
            )}
          </div>
        </Section>
      )}

      {applied && (
        <Section icon="🚀" title="آپدیت در حال اعمال است">
          <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-4 text-sm leading-7 text-sky-300">
            تأیید شما ثبت شد. برنامه تا چند لحظهٔ دیگر از دسترس خارج می‌شود،
            آپدیت نصب می‌شود و با نسخهٔ جدید دوباره بالا می‌آید. اگر به هر دلیلی
            این اتفاق نیفتاد، در شروع دستی بعدی برنامه همین آپدیتِ تأییدشده
            اعمال می‌شود.
          </div>
        </Section>
      )}
    </div>
  );
};
