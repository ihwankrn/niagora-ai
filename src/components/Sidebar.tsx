import Link from "next/link";

interface SidebarProps {
  activePage?: string;
}

export default function Sidebar({ activePage = "dashboard" }: SidebarProps) {
  const navItems = [
    { id: "dashboard", href: "#dashboard", icon: "▦", label: "Dashboard" },
    { id: "new-proposal", href: "#new-proposal", icon: "＋", label: "New proposal" },
    { id: "projects", href: "#projects", icon: "▤", label: "Projects" },
    { id: "payments", href: "#payments", icon: "↗", label: "Payments" },
  ];

  return (
    <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white p-6 md:flex md:flex-col">
      <Link href="/" className="mb-10 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white">
          N
        </div>
        <div>
          <p className="text-lg font-bold tracking-tight">Niagora AI</p>
          <p className="text-xs text-slate-500">Freelance workspace</p>
        </div>
      </Link>

      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
        Workspace
      </p>

      <nav className="space-y-2">
        {navItems.map((item) => (
          <a
            key={item.id}
            href={item.href}
            className={
              activePage === item.id
                ? "flex items-center gap-3 rounded-xl bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-700"
                : "flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-slate-600 transition hover:bg-slate-50"
            }
          >
            <span>{item.icon}</span> {item.label}
          </a>
        ))}
      </nav>

      <div className="mt-auto rounded-2xl bg-slate-50 p-4">
        <p className="text-sm font-semibold">From brief to payment</p>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          Organize client requests, prepare proposals, and track payments in one workspace.
        </p>
      </div>
    </aside>
  );
}
