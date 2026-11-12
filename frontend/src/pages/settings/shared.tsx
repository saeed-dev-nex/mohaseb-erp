import type { ReactNode } from "react";

export const inp =
  "w-full px-3 py-2.5 bg-slate-700/50 border border-slate-600/50 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all";

type SectionProps = {
  title: string;
  icon: ReactNode;
  children: ReactNode;
};

export const Section = ({ title, icon, children }: SectionProps) => (
  <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
    <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-700/50 bg-slate-700/20">
      <span className="text-lg">{icon}</span>
      <h3 className="text-white font-semibold text-sm">{title}</h3>
    </div>
    <div className="p-6">{children}</div>
  </div>
);

type FieldProps = {
  label: string;
  children: ReactNode;
};

export const F = ({ label, children }: FieldProps) => (
  <div className="space-y-1.5">
    <label className="block text-xs font-medium text-slate-400">{label}</label>
    {children}
  </div>
);
