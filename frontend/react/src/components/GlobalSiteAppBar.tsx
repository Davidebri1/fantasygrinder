import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

interface Section {
  label: string;
  href: string;
  sport?: "nba" | "mma" | "golf";
}

const SECTIONS: Section[] = [
  { label: "Home", href: "/" },
  { label: "NBA", href: "/nba", sport: "nba" },
  { label: "MMA", href: "/mma", sport: "mma" },
  { label: "Golf", href: "/golf", sport: "golf" },
  { label: "Browse", href: "/browse" },
];

interface Props {
  pageTitle: string;
  /** Optional breadcrumb-style indicator for the active section. */
}

export function GlobalSiteAppBar({ pageTitle }: Props) {
  const location = useLocation();
  const isHome = location.pathname === "/";
  return (
    <header className="bg-brand-900 text-white shadow-soft">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <NavLink to="/" className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-white/10 grid place-items-center text-white font-bold">
              FG
            </div>
            <span className="font-semibold tracking-tight">Fantasy Grinder</span>
          </NavLink>
          {!isHome && (
            <span className="text-white/60 text-sm">· {pageTitle}</span>
          )}
        </div>
        <nav className="flex items-center gap-1 text-sm">
          {SECTIONS.map((s) => (
            <NavLink
              key={s.href}
              to={s.href}
              className={({ isActive }) =>
                cn(
                  "px-3 py-1.5 rounded-md transition-colors",
                  isActive ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10 hover:text-white",
                )
              }
            >
              {s.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}
