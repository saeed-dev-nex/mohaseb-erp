import { useEffect, useState } from "react";
import { backupConfigAPI } from "../../services/api";

export type FolderPickerData = {
  path: string;
  roots?: string[];
  parent?: string | null;
  folders?: { name: string; path: string }[];
};

type Props = {
  open: boolean;
  // Short name of what is being picked, shown in the dialog title
  // (e.g. «بکاپ» or «مدارک مشتریان»).
  title: string;
  onClose: () => void;
  onConfirm: (path: string) => void;
};

// Server-side folder browser used to pick the backup folder and the
// customer-documents folder. Self-contained: it loads the folder list
// from the API whenever it opens.
export const ServerFolderPicker = ({
  open,
  title,
  onClose,
  onConfirm,
}: Props) => {
  const [data, setData] = useState<FolderPickerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const browse = async (path: string = "") => {
    setLoading(true);
    setError("");
    try {
      const { data } = await backupConfigAPI.browseFolders(path);
      setData(data);
    } catch (error) {
      setError(
        (error as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail || "امکان دریافت پوشه‌های سرور وجود ندارد.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) browse("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="انتخاب پوشهٔ سرور"
    >
      <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
          <h3 className="font-semibold text-white">
            انتخاب پوشهٔ {title} از سیستم سرور
          </h3>
          <button
            type="button"
            onClick={() => onClose()}
            className="text-slate-400 hover:text-white"
            aria-label="بستن"
          >
            ✕
          </button>
        </div>
        <div className="space-y-3 p-5">
          <p
            className="break-all rounded-lg bg-slate-800 px-3 py-2 text-left font-mono text-xs text-slate-300"
            dir="ltr"
          >
            {data?.path || "درایوها"}
          </p>
          {data?.roots?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {data.roots.map((root) => (
                <button
                  type="button"
                  key={root}
                  onClick={() => browse(root)}
                  className="rounded-lg bg-slate-700 px-3 py-1.5 font-mono text-xs text-slate-200 hover:bg-slate-600"
                  dir="ltr"
                >
                  {root}
                </button>
              ))}
            </div>
          )}
          {data?.parent && (
            <button
              type="button"
              onClick={() => browse(data.parent)}
              className="w-full rounded-lg border border-slate-700 px-3 py-2 text-right text-sm text-blue-300 hover:bg-slate-800"
            >
              ⬆️ پوشهٔ بالاتر
            </button>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {loading ? (
              <p className="py-6 text-center text-sm text-slate-400">
                در حال خواندن پوشه‌ها…
              </p>
            ) : data?.folders?.length ? (
              data.folders.map((folder) => (
                <button
                  type="button"
                  key={folder.path}
                  onClick={() => browse(folder.path)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-sm text-slate-200 hover:bg-slate-800"
                >
                  <span>📁</span>
                  <span className="truncate">{folder.name}</span>
                </button>
              ))
            ) : (
              <p className="py-6 text-center text-sm text-slate-500">
                پوشه‌ای در این مسیر وجود ندارد.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-700 pt-3">
            <button
              type="button"
              onClick={() => onClose()}
              className="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              لغو
            </button>
            <button
              type="button"
              disabled={!data?.path || loading}
              onClick={() => {
                if (data?.path) onConfirm(data.path);
              }}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              انتخاب این پوشه
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
