/**
 * The global app bar.
 *
 * Two layers of navigation, matching how a DFS site is actually used: a
 * permanent bar you always see, and a mega-menu that opens over the page
 * when you want to switch sport or look at tonight's board.
 *
 * The bar is glass. It is the one thing that is always in front of the
 * light in the room, so it carries the strongest blur and the clearest
 * hairline. The mega-menu below it is a separate sheet that floats free of
 * the bar, the way a panel detaches from a toolbar.
 *
 * Every item in the menu is a real route. The board tile only appears
 * when there is a live slate behind it.
 */
import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";
import { GolfLogo, NbaLogo, NflLogo, UfcLogo } from "@/components/sport-logos";

interface SportEntry {
  key: "nba" | "nfl" | "mma" | "golf";
  href: string;
  name: string;
  format: string;
  blurb: string;
}

/** The league mark shown on each optimizer tile. */
const SPORT_LOGO: Record<SportEntry["key"], React.ReactNode> = {
  nba: <NbaLogo size={36} />,
  nfl: <NflLogo size={36} />,
  mma: <UfcLogo size={36} />,
  golf: <GolfLogo size={36} />,
};

const OPTIMIZERS: SportEntry[] = [
  {
    key: "nba",
    href: "/nba",
    name: "NBA",
    format: "9-man rosters",
    blurb: "Every game on the board, priced against the $50k cap.",
  },
  {
    key: "nfl",
    href: "/nfl",
    name: "NFL",
    format: "9-man rosters",
    blurb: "Quarterback, running back, receiver, tight end, flex and defense.",
  },
  {
    key: "mma",
    href: "/mma",
    name: "MMA",
    format: "6-fighter cards",
    blurb: "Fight-night cards with bout and card correlation applied.",
  },
  {
    key: "golf",
    href: "/golf",
    name: "Golf",
    format: "6-player fields",
    blurb: "Tournament fields with tee times and cut projections.",
  },
];

const SPORT_BY_PATH: Record<string, SportEntry["key"]> = {
  "/nba": "nba",
  "/nfl": "nfl",
  "/mma": "mma",
  "/golf": "golf",
};

export function GlobalSiteAppBar({ pageTitle }: { pageTitle: string }) {
  const location = useLocation();
  /**
   * The menu is open when the pointer is over it, or when it has been
   * clicked. Keeping those separate stops the click from cancelling the
   * hover that opened it.
   */
  const [hoverOpen, setHoverOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const menuOpen = hoverOpen || pinned;
  const closeTimer = useRef<number | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);

  const sport = SPORT_BY_PATH[location.pathname] ?? null;
  const games = useAppStore((s) => (sport ? s.liveGames[sport] ?? [] : []));
  const status = useAppStore((s) => (sport ? s.liveStatus[sport] ?? "idle" : "idle"));
  const lastSyncedAt = useAppStore((s) => (sport ? s.lastSyncedAt[sport] ?? null : null));

  // Close the menu whenever the route changes.
  useEffect(() => {
    setHoverOpen(false);
    setPinned(false);
  }, [location.pathname]);

  // Escape closes it, and so does a click anywhere outside the header.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setHoverOpen(false);
      setPinned(false);
    };
    const onPointerDown = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setHoverOpen(false);
        setPinned(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [menuOpen]);

  const openMenu = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    setHoverOpen(true);
  };
  const scheduleClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setHoverOpen(false), 180);
  };

  const togglePinned = () => {
    if (pinned) {
      setPinned(false);
      setHoverOpen(false);
    } else {
      setPinned(true);
    }
  };

  const syncedLabel = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

  return (
    <header ref={headerRef} className="sticky top-0 z-40 on-chrome">
      {/* The page dims behind an open menu, the way a mega-menu should. */}
      {menuOpen && (
        <div
          aria-hidden
          className="scrim fixed inset-x-0 top-14 bottom-0"
          onClick={() => {
            setHoverOpen(false);
            setPinned(false);
          }}
        />
      )}

      {/* The chrome band — a sheet of glass with the light behind it. */}
      <div className="relative bg-chrome backdrop-blur-2xl border-b border-line">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0) 46%, rgba(0,0,0,0.18) 100%)",
          }}
        />
        <div className="relative mx-auto max-w-shell px-6 h-14 flex items-center gap-6">
          <NavLink to="/" className="flex items-center gap-2.5 shrink-0">
            <span className="w-8 h-8 rounded-2 bg-action grid place-items-center font-condensed font-bold text-canvas text-sm">
              FG
            </span>
            <span className="font-condensed text-lg font-semibold tracking-tight text-ink-on-dark">
              Fantasy Grinder
            </span>
          </NavLink>

          <nav className="flex items-center gap-1 text-sm" aria-label="Main">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                cn(
                  "px-3 h-8 grid place-items-center rounded-1 transition-colors",
                  isActive
                    ? "bg-white/12 text-ink-on-dark font-medium"
                    : "text-ink-on-dark-muted hover:text-ink-on-dark",
                )
              }
            >
              Home
            </NavLink>

            <div
              className="relative"
              onMouseEnter={openMenu}
              onMouseLeave={scheduleClose}
            >
              <button
                type="button"
                aria-expanded={menuOpen}
                aria-haspopup="true"
                onClick={togglePinned}
                className={cn(
                  "px-3 h-8 flex items-center gap-1.5 rounded-1 transition-colors",
                  menuOpen
                    ? "bg-white/12 text-ink-on-dark font-medium"
                    : "text-ink-on-dark-muted hover:text-ink-on-dark",
                )}
              >
                Optimizers
                <ChevronDown
                  className={cn(
                    "w-3.5 h-3.5 transition-transform",
                    menuOpen && "rotate-180",
                  )}
                />
              </button>
            </div>

            <NavLink
              to="/browse"
              className={({ isActive }) =>
                cn(
                  "px-3 h-8 grid place-items-center rounded-1 transition-colors",
                  isActive
                    ? "bg-white/12 text-ink-on-dark font-medium"
                    : "text-ink-on-dark-muted hover:text-ink-on-dark",
                )
              }
            >
              Browse
            </NavLink>
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {sport && status !== "idle" && (
              <span className="hidden sm:flex items-center gap-2 text-sm text-ink-on-dark-muted">
                {status === "live" && (
                  <span className="w-1.5 h-1.5 rounded-full bg-good live-dot" />
                )}
                <span>
                  {status === "live"
                    ? `Live · ${games.length} ${games.length === 1 ? "game" : "games"}`
                    : status === "loading"
                      ? "Pulling slate"
                      : status === "offline"
                        ? "Slate offline"
                        : "No slate"}
                </span>
                {status === "live" && syncedLabel && (
                  <span className="text-ink-on-dark-muted/70">{syncedLabel}</span>
                )}
              </span>
            )}
            {location.pathname !== "/" && (
              <span className="text-sm text-ink-on-dark-muted hidden md:inline">
                {pageTitle}
              </span>
            )}
          </div>
        </div>
      </div>

      {menuOpen && (
        <div
          className="absolute inset-x-0 top-full"
          onMouseEnter={openMenu}
          onMouseLeave={scheduleClose}
        >
          {/* The menu detaches from the bar: a glass sheet floating over the
              page, with a real gap above it so it reads as a separate
              plane rather than as part of the chrome. */}
          <div className="mx-auto max-w-shell px-6 pt-3">
            <div className="floating p-5 grid gap-5 lg:grid-cols-[1fr_340px]">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {OPTIMIZERS.map((o) => (
                  <NavLink
                    key={o.key}
                    to={o.href}
                    className={({ isActive }) =>
                      cn(
                        "group p-4 rounded-3 border transition-[background-color,border-color,box-shadow] duration-150",
                        isActive
                          ? "border-brand bg-brand-wash shadow-2"
                          : "border-line bg-surface-1 hover:border-line-strong hover:bg-surface-3 hover:shadow-2",
                      )
                    }
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-9 h-9 rounded-2 overflow-hidden shrink-0 grid place-items-center bg-white/6">
                        {SPORT_LOGO[o.key]}
                      </span>
                      <div className="min-w-0">
                        <div className="font-condensed text-xl font-semibold text-ink leading-none">
                          {o.name}
                        </div>
                        <div className="label-quiet mt-1">{o.format}</div>
                      </div>
                    </div>
                    <p className="label mt-3">{o.blurb}</p>
                  </NavLink>
                ))}
              </div>

              {/* The featured tile sits one level higher than the menu. It is
                  cut into the sheet and lit from behind by the colour of
                  the sport, so the board you are about to open is the thing
                  glowing on the wall. */}
              <div className="relative overflow-hidden rounded-3 border border-line bg-surface-2 p-5">
                <div
                  aria-hidden
                  className="absolute inset-0"
                  style={{
                    background:
                      "radial-gradient(120% 100% at 80% 115%, color-mix(in srgb, var(--sport) 34%, transparent) 0%, transparent 62%)",
                  }}
                />
                <div className="relative">
                  <div className="flex items-baseline justify-between">
                    <h2 className="font-condensed text-lg font-semibold text-ink">
                      Tonight&apos;s board
                    </h2>
                    {syncedLabel && (
                      <span className="text-xs text-ink-subtle">{syncedLabel}</span>
                    )}
                  </div>
                  {games.length > 0 ? (
                    <ul className="mt-3 space-y-1">
                      {games.slice(0, 9).map((g) => (
                        <li
                          key={g.id}
                          className="flex items-center gap-2 text-sm border-b border-line last:border-b-0 pb-1"
                        >
                          <span className="text-ink font-medium">{g.label}</span>
                          {g.detail && (
                            <span className="text-xs text-ink-subtle ml-auto shrink-0 truncate max-w-[9rem]">
                              {g.detail}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-ink-muted mt-2">
                      Open an optimizer and the live board loads on its own.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
