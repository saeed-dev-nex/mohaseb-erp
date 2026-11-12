import React, { useEffect, useState } from "react";
import { useWaiting } from "../lib/waiting";

const faDigits = (n: number) =>
  String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

/**
 * Blocking waiting overlay for long-running operations. Rendered once in
 * Layout; driven by lib/waiting (showWaiting/hideWaiting). Shows the
 * operation message and the elapsed seconds so a long backup or restore
 * never looks like a frozen app.
 */
const WaitingModal: React.FC = () => {
  const { active, message, since } = useWaiting();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) return undefined;
    setElapsed(0);
    const t = setInterval(
      () => setElapsed(Math.floor((Date.now() - since) / 1000)),
      500,
    );
    return () => clearInterval(t);
  }, [active, since]);

  if (!active) return null;
  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-label={message || "در حال انجام عملیات"}
      aria-busy="true"
    >
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-slate-700 bg-slate-900 px-10 py-8 shadow-2xl">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-slate-700 border-t-blue-500" />
        <p className="text-sm font-medium text-slate-100">
          {message || "در حال انجام…"}
        </p>
        <p className="text-xs text-slate-400">
          لطفاً صبر کنید… ({faDigits(elapsed)} ثانیه)
        </p>
      </div>
    </div>
  );
};

export default WaitingModal;
