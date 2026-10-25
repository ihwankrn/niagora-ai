interface WorkflowStepProps {
  number: string;
  title: string;
  detail: string;
  active?: boolean;
}

export default function WorkflowStep({
  number,
  title,
  detail,
  active = false,
}: WorkflowStepProps) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${active
            ? "bg-indigo-500 text-white"
            : "bg-white/10 text-slate-300"
          }`}
      >
        {number}
      </div>
      <div className="pt-0.5">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 text-xs text-slate-400">{detail}</p>
      </div>
    </div>
  );
}
