"use client";

export default function ReloadButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white shadow-2xs transition hover:bg-indigo-700"
    >
      <span>🔄</span>
      <span>Retry Loading</span>
    </button>
  );
}
