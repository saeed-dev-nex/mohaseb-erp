export const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft: {
    label: "پیش‌نویس",
    color: "bg-slate-500/20 text-slate-300 border-slate-500/30",
  },
  pending: {
    label: "پرداخت نشده",
    color: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  },
  paid: {
    label: "پرداخت شده",
    color: "bg-green-500/20 text-green-300 border-green-500/30",
  },
  commission_paid: {
    label: "کارمزد پرداخت شده",
    color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  },
  cancelled: {
    label: "لغو شده",
    color: "bg-red-500/20 text-red-300 border-red-500/30",
  },
};

export const StatusBadge = ({ status }: { status: string }) => {
  const s = STATUS_MAP[status] || STATUS_MAP.draft;
  return (
    <span
      className={`px-2.5 py-1 rounded-full text-xs font-medium border ${s.color}`}
    >
      {s.label}
    </span>
  );
};

// ─── Print CSS builder ─────────────────────────────────────────
