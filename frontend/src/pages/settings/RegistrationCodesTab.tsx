import { useCallback, useEffect, useState } from "react";
import {
  registrationCodesAPI,
  type RegistrationCode,
} from "../../services/api";
import { formatApiError } from "../../utils/apiError";
import { F, Section, inp } from "./shared";

const STATUS_LABELS: Record<RegistrationCode["status"], string> = {
  available: "قابل استفاده",
  used: "مصرف‌شده",
  expired: "منقضی",
  revoked: "باطل‌شده",
};

const STATUS_CLASSES: Record<RegistrationCode["status"], string> = {
  available: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  used: "bg-slate-500/15 text-slate-300 border-slate-500/40",
  expired: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  revoked: "bg-rose-500/15 text-rose-300 border-rose-500/40",
};

const faDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString("fa-IR") : "—";

/**
 * Registration codes (licenses): the platform owner generates one-time
 * codes and hands them to customers, who then sign up themselves.
 * Plain codes are shown exactly once — only hashes are stored.
 */
export const RegistrationCodesTab = () => {
  const [codes, setCodes] = useState<RegistrationCode[]>([]);
  const [freshCodes, setFreshCodes] = useState<string[]>([]);
  const [count, setCount] = useState(1);
  const [note, setNote] = useState("");
  const [validDays, setValidDays] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await registrationCodesAPI.list();
      setCodes(res.data);
    } catch (err) {
      setError(formatApiError(err, "دریافت کدها ناموفق بود."));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const generate = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await registrationCodesAPI.generate({
        count,
        note: note.trim(),
        valid_days: validDays ? Number(validDays) : undefined,
      });
      setFreshCodes(res.data.codes);
      setCopied(false);
      setNotice(
        "کدها ساخته شدند. همین حالا آن‌ها را کپی و نگه دارید؛ بعداً دیگر نمایش داده نمی‌شوند.",
      );
      await load();
    } catch (err) {
      setError(formatApiError(err, "ساخت کد ناموفق بود."));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (code: RegistrationCode) => {
    setBusy(true);
    setError("");
    try {
      await registrationCodesAPI.revoke(code.id);
      await load();
    } catch (err) {
      setError(formatApiError(err, "ابطال کد ناموفق بود."));
    } finally {
      setBusy(false);
    }
  };

  const copyFresh = async () => {
    try {
      await navigator.clipboard.writeText(freshCodes.join("\n"));
      setCopied(true);
    } catch {
      setError("کپی خودکار ممکن نشد؛ کدها را دستی انتخاب و کپی کنید.");
    }
  };

  return (
    <div className="space-y-6">
      <Section title="ساخت کد مجوز ثبت‌نام" icon="🎟️">
        <div className="space-y-4">
          <p className="text-sm text-slate-400 leading-6">
            هر کد مجوز فقط برای ساخت <b className="text-slate-200">یک حساب</b>{" "}
            است. کد را به مشتری بدهید تا از صفحهٔ ثبت‌نام، خودش حساب بسازد و
            کسب‌وکارش را راه بیندازد.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <F label="تعداد">
              <input
                type="number"
                min={1}
                max={50}
                value={count}
                onChange={(e) => setCount(Number(e.target.value) || 1)}
                className={inp}
              />
            </F>
            <F label="یادداشت (مثلاً نام مشتری)">
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className={inp}
              />
            </F>
            <F label="مهلت مصرف (روز — خالی = بدون انقضا)">
              <input
                type="number"
                min={1}
                value={validDays}
                onChange={(e) => setValidDays(e.target.value)}
                className={inp}
              />
            </F>
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-medium transition-all disabled:opacity-60"
          >
            {busy ? "در حال ساخت…" : "ساخت کد"}
          </button>

          {freshCodes.length > 0 && (
            <div className="bg-slate-900/70 border border-amber-500/40 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-amber-300">
                  کدهای تازه — فقط همین یک بار نمایش داده می‌شوند
                </span>
                <button
                  type="button"
                  onClick={copyFresh}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-100 rounded-lg text-xs"
                >
                  {copied ? "کپی شد ✓" : "کپی همه"}
                </button>
              </div>
              <div
                dir="ltr"
                className="font-mono text-sm text-slate-100 space-y-1 select-all"
              >
                {freshCodes.map((code) => (
                  <div key={code}>{code}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Section>

      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/40 rounded-xl text-rose-200 text-sm">
          خطا: {error}
        </div>
      )}
      {notice && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/40 rounded-xl text-emerald-200 text-sm">
          {notice}
        </div>
      )}

      <Section title="کدهای صادرشده" icon="📋">
        {codes.length === 0 ? (
          <p className="text-sm text-slate-400">هنوز کدی ساخته نشده است.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 text-xs border-b border-slate-700/60">
                  <th className="py-2 px-2 text-right font-medium">کد</th>
                  <th className="py-2 px-2 text-right font-medium">یادداشت</th>
                  <th className="py-2 px-2 text-right font-medium">وضعیت</th>
                  <th className="py-2 px-2 text-right font-medium">
                    ساخته‌شده
                  </th>
                  <th className="py-2 px-2 text-right font-medium">انقضا</th>
                  <th className="py-2 px-2 text-right font-medium">
                    مصرف‌کننده
                  </th>
                  <th className="py-2 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {codes.map((code) => (
                  <tr
                    key={code.id}
                    className="border-b border-slate-700/30 text-slate-200"
                  >
                    <td dir="ltr" className="py-2.5 px-2 font-mono text-left">
                      …{code.code_hint}
                    </td>
                    <td className="py-2.5 px-2">{code.note || "—"}</td>
                    <td className="py-2.5 px-2">
                      <span
                        className={`px-2 py-0.5 rounded-full border text-xs ${STATUS_CLASSES[code.status]}`}
                      >
                        {STATUS_LABELS[code.status]}
                      </span>
                    </td>
                    <td className="py-2.5 px-2">{faDate(code.created_at)}</td>
                    <td className="py-2.5 px-2">{faDate(code.expires_at)}</td>
                    <td className="py-2.5 px-2">
                      {code.used_by_username || "—"}
                    </td>
                    <td className="py-2.5 px-2 text-left">
                      {code.status === "available" && (
                        <button
                          type="button"
                          onClick={() => revoke(code)}
                          disabled={busy}
                          className="px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-200 rounded-lg text-xs disabled:opacity-60"
                        >
                          ابطال
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
};
