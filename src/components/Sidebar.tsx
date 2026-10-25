import Link from "next/link";
import { ReactNode } from "react";

interface SidebarProps {
  activePage?: string;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

interface NavItem {
  id: string;
  href: string;
  label: string;
  badge?: string;
  icon: ReactNode;
}

export default function Sidebar({
  activePage = "dashboard",
  isMobileOpen = false,
  onCloseMobile,
}: SidebarProps) {
  const navItems: NavItem[] = [
    {
      id: "dashboard",
      href: "/",
      label: "Dashboard",
      icon: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
          />
        </svg>
      ),
    },
    {
      id: "new-proposal",
      href: "/new-proposal",
      label: "New Proposal",
      badge: "AI",
      icon: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 4v16m8-8H4"
          />
        </svg>
      ),
    },
    {
      id: "projects",
      href: "/#projects",
      label: "Projects",
      icon: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
        </svg>
      ),
    },
    {
      id: "payments",
      href: "/#payments",
      label: "Payments",
      badge: "Pending",
      icon: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
      ),
    },
  ];

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between p-5 sm:p-6">
      <div className="space-y-7">
        {/* Brand Header */}
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-slate-900 via-indigo-900 to-indigo-600 text-lg font-bold text-white shadow-md shadow-indigo-950/20 ring-1 ring-white/20">
              <span>N</span>
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-violet-400 ring-2 ring-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-base font-bold tracking-tight text-slate-900">
                  Niagora
                </span>
                <span className="rounded-md bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-2xs">
                  AI
                </span>
              </div>
              <p className="text-[11px] font-medium text-slate-400">
                Freelance Copilot
              </p>
            </div>
          </Link>

          {onCloseMobile && (
            <button
              onClick={onCloseMobile}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 md:hidden"
              aria-label="Close menu"
            >
              ✕
            </button>
          )}
        </div>

        {/* Navigation Group */}
        <div>
          <p className="mb-2.5 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Workspace
          </p>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const isActive = activePage === item.id;
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  onClick={onCloseMobile}
                  className={`group flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-medium transition ${
                    isActive
                      ? "bg-slate-900 text-white shadow-xs"
                      : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`transition ${
                        isActive
                          ? "text-indigo-400"
                          : "text-slate-400 group-hover:text-slate-600"
                      }`}
                    >
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </div>

                  {item.badge && (
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                        isActive
                          ? "bg-white/20 text-indigo-200"
                          : item.badge === "Pending"
                          ? "bg-amber-50 text-amber-700 border border-amber-200"
                          : "bg-indigo-50 text-indigo-600 border border-indigo-100"
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Bottom Information & Profile */}
      <div className="space-y-3 pt-6">
        <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-indigo-50/40 p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-800">
              PayPal Sandbox
            </span>
            <span className="flex items-center gap-1 text-[10px] text-amber-700 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Pending
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            AI proposal workflow with PayPal sandbox integration planned.
          </p>
        </div>

        {/* User Mini Profile */}
        <div className="flex items-center gap-3 rounded-xl border border-slate-200/70 bg-slate-50/60 p-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-slate-800 to-indigo-900 text-xs font-bold text-white shadow-2xs">
            N
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-slate-800">
              Freelancer Pro
            </p>
            <p className="truncate text-[10px] text-slate-400">
              workspace@niagora.ai
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-200/80 bg-white md:block">
        <div className="sticky top-0 h-screen overflow-y-auto">
          {sidebarContent}
        </div>
      </aside>

      {/* Mobile Drawer Backdrop & Sidebar */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
            onClick={onCloseMobile}
          />
          <div className="fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-2xl">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}
