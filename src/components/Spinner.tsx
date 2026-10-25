interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  label?: string;
}

const sizeMap = {
  sm: "h-4 w-4 border-2",
  md: "h-6 w-6 border-2",
  lg: "h-8 w-8 border-[3px]",
};

export default function Spinner({ size = "md", label }: SpinnerProps) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`${sizeMap[size]} animate-spin rounded-full border-indigo-600 border-t-transparent`}
        role="status"
        aria-label={label ?? "Loading"}
      />
      {label && (
        <span className="text-sm text-slate-500">{label}</span>
      )}
    </div>
  );
}
