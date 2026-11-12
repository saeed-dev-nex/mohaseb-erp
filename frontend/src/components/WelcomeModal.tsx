import React from "react";

type WelcomeModalProps = { message: string; onClose: () => void };

const WelcomeModal = ({ message, onClose }: WelcomeModalProps) => (
  <div
    className="welcome-backdrop fixed inset-0 z-[100] flex items-center justify-center p-4"
    role="presentation"
    onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}
  >
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      className="welcome-card relative w-full max-w-lg overflow-hidden rounded-3xl border border-white/20 bg-gradient-to-br from-slate-800 via-slate-900 to-indigo-950 p-8 text-center text-white shadow-2xl"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="بستن پیام خوش‌آمدگویی"
        className="absolute left-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20"
      >
        ×
      </button>
      <div className="welcome-sparkle mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-orange-500 text-4xl shadow-lg shadow-amber-500/30">
        ✨
      </div>
      <p className="mb-2 text-sm font-medium text-amber-200">
        شروع یک روز تازه
      </p>
      <h2 id="welcome-title" className="text-2xl font-bold">
        خوش آمدید 🌷
      </h2>
      <p className="mx-auto mt-4 max-w-md whitespace-pre-wrap text-sm leading-7 text-slate-200">
        {message}
      </p>
      <button
        type="button"
        onClick={onClose}
        className="mt-7 rounded-xl bg-gradient-to-l from-blue-500 to-indigo-500 px-7 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-900/30 transition hover:-translate-y-0.5 hover:shadow-indigo-500/30"
      >
        شروع کنیم
      </button>
      <span className="welcome-orb pointer-events-none absolute -bottom-16 -right-12 h-40 w-40 rounded-full bg-fuchsia-500/15 blur-2xl" />
      <span className="welcome-orb welcome-orb-delay pointer-events-none absolute -left-16 -top-16 h-44 w-44 rounded-full bg-sky-400/15 blur-2xl" />
    </section>
  </div>
);

export default WelcomeModal;
