interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  color?: "indigo" | "white";
  label?: string;
}

const sizeMap = {
  sm: "h-4 w-4 border-2",
  md: "h-6 w-6 border-2",
  lg: "h-8 w-8 border-[3px]",
};

const colorMap = {
  indigo: "border-indigo-600 border-t-transparent",
  white: "border-white border-t-transparent",
};

export default function Spinner({
  size = "md",
  color = "indigo",
  label,
}: SpinnerProps) {
  return (
    <div className="inline-flex items-center gap-3">
      <div
        className={`${sizeMap[size]} ${colorMap[color]} animate-spin rounded-full`}
        role="status"
        aria-label={label ?? "Loading"}
      />
      {label && (
        <span className="text-sm text-slate-500">{label}</span>
      )}
    </div>
  );
}
