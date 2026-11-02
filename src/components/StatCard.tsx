import { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: string;
  detail: string;
  icon?: ReactNode;
  badge?: string;
}

export default function StatCard({
  label,
  value,
  detail,
  icon,
  badge,
}: StatCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="text-2xl font-bold tracking-tight text-slate-900">
            {value}
          </p>
        </div>
        {icon && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-600 transition group-hover:bg-indigo-50 group-hover:text-indigo-600">
            {icon}
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
        <p className="text-[11px] text-slate-400">{detail}</p>
        {badge && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
            {badge}
          </span>
        )}
      </div>
    </div>
  );
}
