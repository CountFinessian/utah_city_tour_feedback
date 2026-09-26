"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, User } from "lucide-react";
import { CommandPalette } from "@/components/domain/CommandPalette";

const nav = [
  { href: "/command", label: "Command", shortLabel: "Command", mark: "C", helper: "Executive OS" },
  { href: "/analyst", label: "AI Analyst", shortLabel: "Analyst", mark: "A", helper: "Ask the corpus" },
  { href: "/journey", label: "Journey", shortLabel: "Journey", mark: "J", helper: "Lifecycle spine" },
  { href: "/signals", label: "Signals", shortLabel: "Signals", mark: "S", helper: "Themes & deltas" },
  { href: "/evidence", label: "Evidence", shortLabel: "Evidence", mark: "E", helper: "Source corpus" },
  { href: "/operations", label: "Operations", shortLabel: "Ops", mark: "O", helper: "Adoption quality" },
  { href: "/settings", label: "Settings", shortLabel: "Settings", mark: "⚙", helper: "Team & Admin" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ name: string; role: string; email: string } | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.user) setUser(data.user);
      })
      .catch(() => {});
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="app-shell lg:grid lg:grid-cols-[292px_1fr]">
      <aside className="sidebar hidden min-h-screen px-4 py-5 lg:block">
        <Link href="/command" className="brand-lockup">
          <span className="brand-mark">UC</span>
          <span>
            <span className="block text-sm font-extrabold">Utah City</span>
            <span className="block text-xs text-nav-muted">Operational Intelligence</span>
          </span>
        </Link>

        <div className="mt-8">
          <p className="nav-section">Platform</p>
          <nav className="mt-2 space-y-1">
            {nav.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link key={item.href} href={item.href} className={`nav-link ${active ? "nav-link-active" : ""}`}>
                  <span className="nav-mark">{item.mark}</span>
                  <span className="min-w-0">
                    <span className="block truncate">{item.label}</span>
                    <span className="block truncate text-[11px] font-medium text-nav-muted">{item.helper}</span>
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="mt-8 border-t border-white/10 pt-5">
          <p className="nav-section">Operating Model</p>
          <div className="sidebar-insight mt-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-nav-muted">Evidence posture</span>
              <span className="h-2 w-2 rounded-full bg-[#20d0c3]" />
            </div>
            <div className="sidebar-meter mt-3">
              <div className="sidebar-meter-fill w-[42%]" />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-300">
              Reality captured, then structured, then promoted when confidence supports it.
            </p>
          </div>
        </div>

        <div className="mt-8 border-t border-white/10 pt-5">
          <p className="nav-section">Session</p>
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-white/[0.04] p-3 border border-white/10">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-8 w-8 rounded-lg bg-[#43d9c7]/10 border border-[#43d9c7]/20 text-[#43d9c7] flex items-center justify-center font-bold text-xs shrink-0">
                {user ? user.name.charAt(0) : "U"}
              </div>
              <div className="min-w-0 truncate">
                <p className="text-xs font-bold text-slate-200 truncate">{user ? user.name : "Active User"}</p>
                <p className="text-[10px] text-[#43d9c7] font-medium capitalize truncate">{user ? `${user.role} workspace` : "Authenticated"}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              title="Sign out"
              className="h-8 w-8 rounded-lg flex items-center justify-center p-0 border border-white/10 hover:border-red-500/30 text-slate-400 hover:text-red-400 hover:bg-white/5 transition-colors shrink-0"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="min-w-0 bg-command-bg flex flex-col min-h-screen">
        <header className="sticky top-0 z-20 border-b border-white/10 bg-[#070b12]/95 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <Link href="/command" className="flex items-center gap-2 font-bold">
              <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-nav text-xs text-white">
                UC
              </span>
              <span className="text-[#e8eef7]">Utah City</span>
            </Link>
            <div className="flex items-center gap-2">
              <Link href="/" className="btn btn-primary px-3 py-2 text-xs">
                Capture
              </Link>
              <button
                onClick={handleLogout}
                title="Sign out"
                className="h-8 w-8 rounded-lg flex items-center justify-center p-0 border border-white/10 hover:border-red-500/30 text-slate-300 hover:text-red-400 hover:bg-white/5 transition-colors"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 text-sm">
            {nav.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`mobile-nav-link ${active ? "mobile-nav-link-active" : ""}`}
                >
                  {item.shortLabel}
                </Link>
              );
            })}
          </nav>
        </header>

        <div className="hidden border-b border-command-border bg-command-bg/95 px-8 py-3 lg:block">
          <div className="mx-auto flex w-full max-w-[1480px] items-center justify-between gap-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-command-muted">
              Leadership Intelligence
            </p>
            <div className="flex items-center gap-4">
              {user && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs">
                  <span className="h-2 w-2 rounded-full bg-[#43d9c7]" />
                  <span className="font-semibold text-slate-200">{user.name}</span>
                  <span className="text-[10px] text-slate-400 capitalize">({user.role})</span>
                </div>
              )}
              <CommandPalette />
              <button
                onClick={handleLogout}
                title="Sign out"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-red-400 hover:bg-white/5 border border-white/10 transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </div>

        <main className="mx-auto w-full max-w-[1480px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 bg-command-bg">{children}</main>
      </div>
    </div>
  );
}
