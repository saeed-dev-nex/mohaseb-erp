import { useEffect, useState } from "react";
import { backupAPI, backupConfigAPI } from "../../services/api";
import PasswordInput from "../../components/PasswordInput";
import { hideWaiting, showWaiting } from "../../lib/waiting";
import { F, Section, inp } from "./shared";
import { ServerFolderPicker } from "./ServerFolderPicker";

const RESTORE_CONFIRMATION_PHRASE = "تایید";

type BackupCfg = {
  backup_path: string;
  auto_backup: boolean;
  backup_frequency: string;
  backup_hour: number;
  last_backup_at: string | null;
  last_backup_path: string;
  cloud_enabled: boolean;
  cloud_endpoint: string;
  cloud_bucket: string;
  cloud_access_key: string;
  cloud_retention: number;
  last_cloud_backup_at: string | null;
  last_cloud_backup_key: string;
  last_cloud_error: string;
};

type CloudBackupItem = {
  key: string;
  size: number;
  last_modified: string;
};

// Backup & restore tab (superuser only): local/cloud backup config,
// manual backup, cloud restore and local-file restore. Owns its config
// fetch; rendered by Settings when the backup tab is active.
export const BackupTab = ({ isSuperuser }: { isSuperuser: boolean }) => {
  const [backupCfg, setBackupCfg] = useState<BackupCfg>({
    backup_path: "",
    auto_backup: false,
    backup_frequency: "daily",
    backup_hour: 13,
    last_backup_at: null,
    last_backup_path: "",
    cloud_enabled: false,
    cloud_endpoint: "https://s3.ir-thr-at1.arvanstorage.ir",
    cloud_bucket: "",
    cloud_access_key: "",
    cloud_retention: 30,
    last_cloud_backup_at: null,
    last_cloud_backup_key: "",
    last_cloud_error: "",
  });
  const [cloudSecret, setCloudSecret] = useState("");
  const [cloudPassphrase, setCloudPassphrase] = useState("");
  const [cloudMsg, setCloudMsg] = useState("");
  const [cloudBackups, setCloudBackups] = useState<CloudBackupItem[]>([]);
  const [cloudRestoreKey, setCloudRestoreKey] = useState("");
  const [cloudRestorePassphrase, setCloudRestorePassphrase] = useState("");
  const [cloudRestoreCounts, setCloudRestoreCounts] = useState<Record<
    string,
    number
  > | null>(null);
  const [cloudRestorePhrase, setCloudRestorePhrase] = useState("");
  const [backupSaving, setBackupSaving] = useState(false);
  const [backupRunning, setBackupRunning] = useState(false);
  const [backupMsg, setBackupMsg] = useState("");
  const [backupPassphrase, setBackupPassphrase] = useState("");
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [restoreBackup, setRestoreBackup] = useState<string | null>(null);
  const [restoreCounts, setRestoreCounts] = useState<Record<
    string,
    number
  > | null>(null);
  const [restorePhrase, setRestorePhrase] = useState("");
  const [restoreBusy, setRestoreBusy] = useState(false);
  const isRestoreConfirmed =
    restorePhrase.trim() === RESTORE_CONFIRMATION_PHRASE;
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    backupConfigAPI
      .get()
      .then(({ data }) => {
        if (data && Object.keys(data).length)
          setBackupCfg((prev) => ({ ...prev, ...data }));
      })
      .catch(() => {});
  }, []);

  const setBcfg = (k: keyof BackupCfg, v: string | number | boolean) =>
    setBackupCfg((f) => ({ ...f, [k]: v }) as BackupCfg);

  const handleSaveBackupConfig = async () => {
    setBackupSaving(true);
    try {
      const payload: Record<string, string | number | boolean> = {
        backup_path: backupCfg.backup_path,
        auto_backup: backupCfg.auto_backup,
        backup_frequency: backupCfg.backup_frequency,
        backup_hour: Number(backupCfg.backup_hour),
        cloud_enabled: backupCfg.cloud_enabled,
        cloud_endpoint: backupCfg.cloud_endpoint,
        cloud_bucket: backupCfg.cloud_bucket,
        cloud_access_key: backupCfg.cloud_access_key,
        cloud_retention: Number(backupCfg.cloud_retention),
      };
      // Secrets are write-only: only send them when the user typed a new one.
      if (cloudSecret) payload.cloud_secret_key = cloudSecret;
      if (cloudPassphrase) payload.cloud_passphrase = cloudPassphrase;
      const { data } = await backupConfigAPI.update(payload);
      setBackupCfg((prev) => ({ ...prev, ...data }));
      setBackupMsg("✅ تنظیمات بکاپ ذخیره شد");
      setTimeout(() => setBackupMsg(""), 3000);
    } catch (e) {
      setBackupMsg("❌ خطا در ذخیره تنظیمات بکاپ");
      setTimeout(() => setBackupMsg(""), 4000);
    } finally {
      setBackupSaving(false);
    }
  };

  const handleRunBackup = async (saveToPath: boolean) => {
    setBackupRunning(true);
    setBackupMsg("");
    showWaiting("در حال تهیهٔ نسخهٔ پشتیبان…");
    try {
      if (saveToPath && backupCfg.backup_path) {
        // Save to disk
        const { data } = await backupConfigAPI.runBackup({
          path: backupCfg.backup_path,
          passphrase: backupPassphrase || undefined,
        });
        if (data.saved) {
          setBackupCfg((prev) => ({
            ...prev,
            last_backup_path: data.path,
            last_backup_at: new Date().toISOString(),
          }));
          let msg = `✅ بکاپ در مسیر ذخیره شد: ${data.path}`;
          if (data.cloud) {
            msg += data.cloud.uploaded
              ? " — ☁️ کپی ابری هم آپلود شد"
              : ` — ⚠️ آپلود ابری ناموفق بود: ${data.cloud.reason || ""}`;
          }
          setBackupMsg(msg);
        }
      } else {
        // Let the user choose a local filename and destination when supported.
        let saveHandle: any = null;
        const showSaveFilePicker = (window as any).showSaveFilePicker as
          undefined | ((options: unknown) => Promise<any>);
        if (showSaveFilePicker) {
          try {
            saveHandle = await showSaveFilePicker({
              suggestedName: `mohaseb_backup_${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
              types: [
                {
                  description: "فایل پشتیبان محاسب پرو",
                  accept: { "application/json": [".json"] },
                },
              ],
            });
          } catch (error) {
            if (error.name === "AbortError") {
              return;
            }
            // Fall back to the browser download when the native picker is unavailable.
          }
        }

        const response = await backupConfigAPI.runBackupDownload({
          passphrase: backupPassphrase || undefined,
        });
        const blob = new Blob([response.data]);
        const cd = response.headers?.["content-disposition"] || "";
        const fnMatch = cd.match(/filename="?([^"]+)"?/);
        const filename = fnMatch
          ? fnMatch[1]
          : `mohaseb_backup_${new Date().toISOString().slice(0, 10)}.json`;
        if (saveHandle) {
          const writable = await saveHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          setBackupMsg("✅ فایل بکاپ در محل انتخاب‌شده ذخیره شد");
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          a.click();
          URL.revokeObjectURL(url);
          setBackupMsg(
            "✅ دانلود بکاپ آغاز شد؛ محل ذخیره طبق تنظیمات مرورگر است",
          );
        }
      }
      setTimeout(() => setBackupMsg(""), 5000);
    } catch (e) {
      let errorData = e.response?.data;
      if (errorData instanceof Blob) {
        try {
          errorData = JSON.parse(await errorData.text());
        } catch {
          /* Keep the generic message. */
        }
      }
      const detail = errorData?.detail;
      setBackupMsg(`❌ ${detail || "خطا در اجرای بکاپ"}`);
      setTimeout(() => setBackupMsg(""), 4000);
    } finally {
      setBackupRunning(false);
      hideWaiting();
    }
  };

  const handleTestCloud = async () => {
    setCloudMsg("در حال بررسی اتصال ابری…");
    try {
      const { data } = await backupConfigAPI.testCloud({
        cloud_endpoint: backupCfg.cloud_endpoint,
        cloud_bucket: backupCfg.cloud_bucket,
        cloud_access_key: backupCfg.cloud_access_key,
        ...(cloudSecret ? { cloud_secret_key: cloudSecret } : {}),
      });
      if (data.ok) setCloudMsg("✅ اتصال ابری برقرار است");
    } catch (e) {
      setCloudMsg(
        `❌ ${e.response?.data?.detail || "بررسی اتصال ابری ناموفق بود"}`,
      );
    }
  };

  const handleListCloud = async () => {
    setCloudMsg("در حال خواندن فهرست ابری…");
    try {
      const { data } = await backupConfigAPI.listCloud();
      setCloudBackups(data.backups || []);
      setCloudMsg(
        data.backups?.length
          ? `☁️ ${data.backups.length} نسخه در ابر پیدا شد`
          : "☁️ باکتی خالی است؛ هنوز نسخه‌ای آپلود نشده",
      );
    } catch (e) {
      setCloudMsg(
        `❌ ${e.response?.data?.detail || "خواندن فهرست ابری ناموفق بود"}`,
      );
    }
  };

  const handleUploadLatest = async () => {
    setCloudMsg("در حال آپلود آخرین بکاپ…");
    showWaiting("در حال آپلود بکاپ به فضای ابری…");
    try {
      const { data } = await backupConfigAPI.uploadLatest();
      if (data.uploaded) {
        setCloudMsg(`✅ آخرین بکاپ به ابر آپلود شد: ${data.key}`);
        const { data: cfg } = await backupConfigAPI.get();
        setBackupCfg((prev) => ({ ...prev, ...cfg }));
      }
    } catch (e) {
      setCloudMsg(`❌ ${e.response?.data?.detail || "آپلود ابری ناموفق بود"}`);
    } finally {
      hideWaiting();
    }
  };

  const handleCloudRestoreValidate = async () => {
    setCloudMsg("");
    setCloudRestoreCounts(null);
    showWaiting("در حال بررسی فایل پشتیبان ابری…");
    try {
      const { data } = await backupConfigAPI.restoreCloud({
        key: cloudRestoreKey,
        passphrase: cloudRestorePassphrase || undefined,
      });
      if (data.valid) {
        setCloudRestoreCounts(data.counts);
        setCloudMsg("✅ فایل ابری سالم است؛ برای بازیابی، «تایید» را بنویسید");
      }
    } catch (e) {
      setCloudMsg(
        `❌ ${e.response?.data?.detail || "بررسی فایل ابری ناموفق بود"}`,
      );
    } finally {
      hideWaiting();
    }
  };

  const handleCloudRestoreConfirm = async () => {
    showWaiting("در حال بازیابی از بکاپ ابری…");
    try {
      const { data } = await backupConfigAPI.restoreCloud({
        key: cloudRestoreKey,
        passphrase: cloudRestorePassphrase || undefined,
        confirm_replace: true,
      });
      if (data.restored) {
        setCloudMsg("✅ بازیابی از بکاپ ابری انجام شد");
        setCloudRestoreCounts(null);
        setCloudRestorePhrase("");
      }
    } catch (e) {
      setCloudMsg(
        `❌ ${e.response?.data?.detail || "بازیابی از بکاپ ابری ناموفق بود"}`,
      );
    } finally {
      hideWaiting();
    }
  };

  const handleSelectRestoreFile = async (file: File | null | undefined) => {
    if (!file) return;
    setBackupMsg("");
    setRestoreBackup(null);
    setRestoreCounts(null);
    setRestorePhrase("");
    showWaiting("در حال بررسی فایل پشتیبان…");
    try {
      const rawBackup = await file.text();
      const { data } = await backupAPI.restore({
        backup_json: rawBackup,
        confirm_replace: false,
        passphrase: restorePassphrase || undefined,
      });
      setRestoreBackup(rawBackup);
      setRestoreCounts(data.counts);
      setBackupMsg("✅ فایل پشتیبان سالم است و برای بازیابی آماده است.");
    } catch (error) {
      setBackupMsg(
        `❌ ${error.response?.data?.detail || "فایل انتخاب‌شده معتبر نیست."}`,
      );
    } finally {
      hideWaiting();
    }
  };

  const handleRestore = async () => {
    if (!restoreBackup || !isRestoreConfirmed) return;
    setRestoreBusy(true);
    showWaiting("در حال بازیابی اطلاعات…");
    try {
      await backupAPI.restore({
        backup_json: restoreBackup,
        confirm_replace: true,
        passphrase: restorePassphrase || undefined,
      });
      setBackupMsg("✅ بازیابی انجام شد؛ برنامه در حال بارگذاری مجدد است.");
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      setBackupMsg(
        `❌ ${error.response?.data?.detail || "بازیابی انجام نشد."}`,
      );
    } finally {
      setRestoreBusy(false);
      hideWaiting();
    }
  };

  const persianDate = (d: string | null | undefined): string => {
    if (!d) return "---";
    try {
      return new Intl.DateTimeFormat("fa-IR", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(d));
    } catch {
      return d;
    }
  };

  return (
    <Section title="پشتیبان‌گیری (بکاپ)" icon="💾">
      <div className="space-y-5">
        {/* Last backup info */}
        {backupCfg.last_backup_at && (
          <div className="flex items-center gap-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl px-4 py-3">
            <span className="text-emerald-400 text-lg">✅</span>
            <div>
              <p className="text-emerald-400 text-sm font-medium">
                آخرین بکاپ موفق
              </p>
              <p className="text-slate-400 text-xs">
                {persianDate(backupCfg.last_backup_at)}
              </p>
              {backupCfg.last_backup_path && (
                <p className="text-slate-500 text-[10px] font-mono mt-0.5 break-all">
                  {backupCfg.last_backup_path}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Backup path */}
        <F label="📂 مسیر بکاپ روی رایانهٔ سرور">
          <div className="flex gap-2">
            <input
              className={`${inp} min-w-0 flex-1`}
              value={backupCfg.backup_path}
              readOnly
              placeholder="پوشه‌ای از سیستم سرور انتخاب کنید"
              dir="ltr"
            />
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="shrink-0 rounded-xl border border-blue-500/40 bg-blue-600/20 px-4 py-2 text-sm text-blue-200 hover:bg-blue-600/30"
            >
              انتخاب پوشه
            </button>
          </div>
          <p className="text-slate-600 text-xs mt-1">
            این پوشه باید از قبل روی رایانه‌ای که برنامهٔ سرور روی آن اجرا
            می‌شود وجود داشته باشد و سرور اجازهٔ نوشتن در آن را داشته باشد. برای
            ذخیره روی رایانهٔ خودتان از دکمهٔ «انتخاب محل و ذخیره فایل» استفاده
            کنید.
          </p>
        </F>

        <ServerFolderPicker
          open={pickerOpen}
          title="بکاپ"
          onClose={() => setPickerOpen(false)}
          onConfirm={(path) => {
            setBcfg("backup_path", path);
            setPickerOpen(false);
          }}
        />

        {/* Auto backup toggle */}
        <div className="flex items-center justify-between p-4 bg-slate-700/20 rounded-xl border border-slate-700/30">
          <div>
            <p className="text-white text-sm font-medium">⏰ بکاپ خودکار</p>
            <p className="text-slate-500 text-xs mt-0.5">
              بکاپ در ساعت مشخص هر روز به‌صورت خودکار اجرا می‌شود
            </p>
          </div>
          <button
            onClick={() => setBcfg("auto_backup", !backupCfg.auto_backup)}
            className={`relative w-12 h-6 rounded-full transition-colors ${backupCfg.auto_backup ? "bg-blue-600" : "bg-slate-600"}`}
          >
            <div
              className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${backupCfg.auto_backup ? "left-7" : "left-1"}`}
            />
          </button>
        </div>

        {/* Auto backup settings */}
        {backupCfg.auto_backup && (
          <div className="grid grid-cols-2 gap-3">
            <F label="فرکانس بکاپ">
              <select
                className={inp}
                value={backupCfg.backup_frequency}
                onChange={(e) => setBcfg("backup_frequency", e.target.value)}
              >
                <option value="daily">روزانه</option>
                <option value="weekly">هفتگی</option>
              </select>
            </F>
            <F label="ساعت اجرا">
              <select
                className={inp}
                value={backupCfg.backup_hour}
                onChange={(e) => setBcfg("backup_hour", e.target.value)}
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>
                    {String(i).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </F>
          </div>
        )}

        {backupMsg && (
          <div
            className={`text-sm px-4 py-3 rounded-xl border ${backupMsg.startsWith("✅") ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-red-500/10 border-red-500/30 text-red-400"}`}
          >
            {backupMsg}
          </div>
        )}

        {/* Optional backup encryption */}
        <F label="🔐 گذرواژهٔ رمزنگاری بکاپ (اختیاری)">
          <PasswordInput
            className={inp}
            value={backupPassphrase}
            onChange={(e) => setBackupPassphrase(e.target.value)}
            placeholder="خالی = بکاپ بدون رمزنگاری؛ دست‌کم ۸ نویسه"
            autoComplete="new-password"
            dir="ltr"
          />
          <p className="text-slate-600 text-xs mt-1">
            اگر گذرواژه بگذارید، فایل بکاپ با AES-256 رمزنگاری می‌شود و هنگام
            بازیابی همین گذرواژه لازم است. این گذرواژه فقط برای همین فایل است و
            هیچ‌جا ذخیره نمی‌شود؛ اگر فراموش شود، بکاپ قابل بازیابی نیست.
            (بکاپ‌های خودکار و کپی‌های ابری از «گذرواژهٔ رمزنگاری کپی ابری» در
            پایین استفاده می‌کنند.)
          </p>
        </F>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleSaveBackupConfig}
            disabled={backupSaving}
            className="px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm border border-slate-600 transition-all flex items-center gap-2 disabled:opacity-60"
          >
            {backupSaving ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              "⚙️"
            )}
            ذخیره تنظیمات بکاپ
          </button>

          {backupCfg.backup_path && (
            <button
              onClick={() => handleRunBackup(true)}
              disabled={backupRunning}
              className="px-4 py-2.5 rounded-xl bg-indigo-600/80 hover:bg-indigo-700 text-white text-sm border border-indigo-500/50 transition-all flex items-center gap-2 disabled:opacity-60"
            >
              {backupRunning ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                "💾"
              )}
              ذخیره بکاپ روی سرور
            </button>
          )}

          <button
            onClick={() => handleRunBackup(false)}
            disabled={backupRunning}
            className="px-4 py-2.5 rounded-xl bg-emerald-600/80 hover:bg-emerald-700 text-white text-sm border border-emerald-500/50 transition-all flex items-center gap-2 disabled:opacity-60"
          >
            {backupRunning ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              "⬇️"
            )}
            انتخاب محل و ذخیره فایل
          </button>
        </div>

        {isSuperuser && (
          <div className="space-y-4 border-t border-slate-700/30 pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white text-sm font-medium">
                  ☁️ بکاپ ابری (S3)
                </p>
                <p className="text-slate-500 text-xs mt-0.5">
                  پس از هر بکاپ محلی، یک نسخهٔ رمزنگاری‌شده هم به باکت ابری
                  فرستاده می‌شود؛ بکاپ محلی حتی اگر آپلود ابری ناموفق باشد سر
                  جایش می‌ماند
                </p>
              </div>
              <button
                onClick={() =>
                  setBcfg("cloud_enabled", !backupCfg.cloud_enabled)
                }
                className={`relative w-12 h-6 rounded-full transition-colors ${backupCfg.cloud_enabled ? "bg-blue-600" : "bg-slate-600"}`}
              >
                <div
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${backupCfg.cloud_enabled ? "left-7" : "left-1"}`}
                />
              </button>
            </div>

            {backupCfg.cloud_enabled && (
              <div className="space-y-3">
                <F label="نقطهٔ پایانی S3">
                  <input
                    className={inp}
                    value={backupCfg.cloud_endpoint}
                    onChange={(e) => setBcfg("cloud_endpoint", e.target.value)}
                    placeholder="https://s3.ir-thr-at1.arvanstorage.ir"
                    dir="ltr"
                  />
                </F>
                <div className="grid grid-cols-2 gap-3">
                  <F label="نام باکت">
                    <input
                      className={inp}
                      value={backupCfg.cloud_bucket}
                      onChange={(e) => setBcfg("cloud_bucket", e.target.value)}
                      placeholder="mohaseb-backups"
                      dir="ltr"
                    />
                  </F>
                  <F label="کلید دسترسی">
                    <input
                      className={inp}
                      value={backupCfg.cloud_access_key}
                      onChange={(e) =>
                        setBcfg("cloud_access_key", e.target.value)
                      }
                      dir="ltr"
                    />
                  </F>
                </div>
                <F label="کلید محرمانه (فقط برای تغییر وارد کنید)">
                  <PasswordInput
                    className={inp}
                    value={cloudSecret}
                    onChange={(e) => setCloudSecret(e.target.value)}
                    placeholder="بدون تغییر"
                    autoComplete="new-password"
                    dir="ltr"
                  />
                </F>
                <F label="🔐 گذرواژهٔ رمزنگاری کپی ابری">
                  <PasswordInput
                    className={inp}
                    value={cloudPassphrase}
                    onChange={(e) => setCloudPassphrase(e.target.value)}
                    placeholder="فقط برای تغییر وارد کنید؛ دست‌کم ۸ نویسه"
                    autoComplete="new-password"
                    dir="ltr"
                  />
                  <p className="text-slate-600 text-xs mt-1">
                    این «گذرواژهٔ اصلی بکاپ» است: بکاپ‌های خودکار و کپی‌های ابری
                    با همین گذرواژه رمزنگاری می‌شوند و موقع بازیابی، اگر
                    گذرواژه‌ای وارد نکنید همین یکی به‌صورت خودکار امتحان می‌شود.
                    تغییر آن فقط روی بکاپ‌های بعدی اثر دارد؛ بکاپ‌های قبلی با
                    گذرواژهٔ زمان ساخت خودشان باز می‌شوند (همان را در فرم
                    بازیابی وارد کنید). اگر فراموش شود، بکاپ‌های رمزنگاری‌شده
                    قابل بازیابی نیستند.
                  </p>
                </F>
                <F label="نگهداری نسخه‌های ابری (تعداد)">
                  <input
                    type="number"
                    min={1}
                    className={inp}
                    value={backupCfg.cloud_retention}
                    onChange={(e) => setBcfg("cloud_retention", e.target.value)}
                    dir="ltr"
                  />
                </F>

                {(backupCfg.last_cloud_backup_at ||
                  backupCfg.last_cloud_error) && (
                  <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-3 text-xs text-slate-400">
                    {backupCfg.last_cloud_backup_at && (
                      <p>
                        آخرین آپلود ابری:{" "}
                        {persianDate(backupCfg.last_cloud_backup_at)}
                        {backupCfg.last_cloud_backup_key
                          ? ` — ${backupCfg.last_cloud_backup_key}`
                          : ""}
                      </p>
                    )}
                    {backupCfg.last_cloud_error && (
                      <p className="text-red-400 mt-1">
                        آخرین خطای ابری: {backupCfg.last_cloud_error}
                      </p>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleTestCloud}
                    className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm border border-slate-600"
                  >
                    بررسی اتصال ابری
                  </button>
                  <button
                    type="button"
                    onClick={handleListCloud}
                    className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm border border-slate-600"
                  >
                    فهرست نسخه‌های ابری
                  </button>
                  {backupCfg.last_backup_path && (
                    <button
                      type="button"
                      onClick={handleUploadLatest}
                      className="px-4 py-2 rounded-xl bg-indigo-600/80 hover:bg-indigo-700 text-white text-sm border border-indigo-500/50"
                    >
                      آپلود آخرین بکاپ
                    </button>
                  )}
                </div>

                {cloudMsg && (
                  <div className="text-sm px-4 py-3 rounded-xl border border-slate-700/50 bg-slate-900/30 text-slate-300">
                    {cloudMsg}
                  </div>
                )}

                {cloudBackups.length > 0 && (
                  <div className="space-y-2">
                    {cloudBackups.map((item) => (
                      <div
                        key={item.key}
                        className="flex items-center justify-between gap-3 rounded-xl border border-slate-700/50 bg-slate-900/30 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p
                            className="truncate font-mono text-xs text-slate-200"
                            dir="ltr"
                          >
                            {item.key}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {persianDate(item.last_modified)} —{" "}
                            {new Intl.NumberFormat("fa-IR").format(item.size)}{" "}
                            بایت
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setCloudRestoreKey(item.key);
                            setCloudRestoreCounts(null);
                            setCloudRestorePhrase("");
                          }}
                          className="shrink-0 rounded-lg bg-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-600"
                        >
                          بازیابی
                        </button>
                      </div>
                    ))}
                    {cloudRestoreKey && (
                      <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                        <p
                          className="font-mono text-xs text-slate-300"
                          dir="ltr"
                        >
                          {cloudRestoreKey}
                        </p>
                        <PasswordInput
                          className={inp}
                          value={cloudRestorePassphrase}
                          onChange={(e) =>
                            setCloudRestorePassphrase(e.target.value)
                          }
                          placeholder="خالی = گذرواژهٔ ذخیره‌شده؛ یا گذرواژهٔ زمان ساخت فایل"
                          autoComplete="off"
                          dir="ltr"
                        />
                        {!cloudRestoreCounts ? (
                          <button
                            type="button"
                            onClick={handleCloudRestoreValidate}
                            className="rounded-lg bg-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-600"
                          >
                            بررسی فایل ابری
                          </button>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-xs text-slate-400">
                              فایل سالم است:{" "}
                              {new Intl.NumberFormat("fa-IR").format(
                                Object.values(cloudRestoreCounts).reduce(
                                  (sum, count) => sum + count,
                                  0,
                                ),
                              )}{" "}
                              رکورد برای بازیابی.
                            </p>
                            <div className="flex gap-2">
                              <input
                                value={cloudRestorePhrase}
                                onChange={(e) =>
                                  setCloudRestorePhrase(e.target.value)
                                }
                                placeholder="برای فعال‌شدن دکمه بنویسید: تایید"
                                className={`${inp} flex-1`}
                              />
                              <button
                                type="button"
                                disabled={cloudRestorePhrase !== "تایید"}
                                onClick={handleCloudRestoreConfirm}
                                className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-50"
                              >
                                تایید بازیابی
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <p className="text-slate-600 text-xs border-t border-slate-700/30 pt-3">
          💡 بکاپ شامل کاربران و هش رمزهایشان نیز هست؛ فایل را محرمانه نگه
          دارید. امضای SHA-256 خرابی یا تغییر فایل را پیش از بازیابی شناسایی
          می‌کند. برای بکاپ زمان‌بندی‌شده، برنامه باید باز و مدیر ارشد وارد شده
          باشد.
        </p>

        {isSuperuser && (
          <div className="space-y-3 border-t border-slate-700/30 pt-4">
            <h4 className="font-medium text-white">بازیابی از نسخهٔ پشتیبان</h4>
            <p className="text-xs leading-relaxed text-amber-600">
              بازیابی اطلاعات فعلی را با اطلاعات نسخهٔ پشتیبان جایگزین می‌کند.
              فایل ابتدا از نظر ساختار و صحت بررسی می‌شود؛ فایل‌های فیزیکی مدارک
              مشتریان باید در مسیر ذخیره‌سازی موجود باشند.
            </p>
            <PasswordInput
              className={inp}
              value={restorePassphrase}
              onChange={(e) => setRestorePassphrase(e.target.value)}
              placeholder="گذرواژهٔ بکاپ؛ خالی بماند، گذرواژهٔ ذخیره‌شده هم امتحان می‌شود"
              autoComplete="off"
              dir="ltr"
            />
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => handleSelectRestoreFile(e.target.files?.[0])}
              className="block w-full text-sm text-slate-400 file:ml-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-2 file:text-slate-200"
            />
            {restoreCounts && (
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-3 text-xs text-slate-400">
                فایل سالم است:{" "}
                {new Intl.NumberFormat("fa-IR").format(
                  Object.values(restoreCounts).reduce(
                    (sum, count) => sum + count,
                    0,
                  ),
                )}{" "}
                رکورد برای بازیابی.
              </div>
            )}
            {restoreBackup && (
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
                <input
                  value={restorePhrase}
                  onChange={(e) => setRestorePhrase(e.target.value)}
                  placeholder="برای فعال‌شدن دکمه بنویسید: تایید"
                  className={inp}
                />
                <button
                  type="button"
                  onClick={handleRestore}
                  disabled={restoreBusy || !isRestoreConfirmed}
                  className="rounded-xl bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {restoreBusy ? "در حال بازیابی..." : "بازیابی کردن"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Section>
  );
};
