/**
 * The hero panel.
 *
 * One place in the app carries atmosphere. It works the way the best sports
 * sites work it: a real photograph of the venue, graded into the same dark
 * room the rest of the app lives in, with the headline set on a plane of its
 * own in front of it.
 *
 * The four sport cards hang over the bottom of the photograph together, on one
 * line, so the row reads as a single band of glass in front of the room rather
 * than as boxes dropped at different heights. They are glass like everything
 * else, so the light behind them comes through.
 *
 * If the photograph fails to load the grade still carries the panel, so the
 * page never breaks.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

import { GolfLogo, NbaLogo, NflLogo, UfcLogo } from "@/components/sport-logos";

interface HeroSport {
  title: string;
  description: string;
  to: string;
  icon: React.ReactNode;
}

/**
 * The four sports, each on its own plane. The one the hero's primary action
 * points at is marked `featured` — it earns a quiet brand tint, not a
 * different height. Position is for reading, not for emphasis.
 */
const SPORTS: (HeroSport & { featured?: boolean })[] = [
  {
    title: "NFL Optimizer",
    description: "Quarterback, running back, receiver, tight end, flex and defense.",
    to: "/nfl",
    icon: <NflLogo size={44} />,
    featured: true,
  },
  {
    title: "NBA Optimizer",
    description: "Classic and Showdown, with position assignment and team limits.",
    to: "/nba",
    icon: <NbaLogo size={44} />,
  },
  {
    title: "MMA Optimizer",
    description: "Six-fighter cards, one fighter per bout, card correlation applied.",
    to: "/mma",
    icon: <UfcLogo size={44} />,
  },
  {
    title: "Golf Optimizer",
    description: "Tournament fields with tee times, cut projections and salary tuning.",
    to: "/golf",
    icon: <GolfLogo size={44} />,
  },
];

export function HeroPanel() {
  const [photoOk, setPhotoOk] = useState(true);

  return (
    <section className="relative z-20">
      {/* ── The photograph, in a glass frame ────────────────────────── */}
      <div className="relative -mx-6 md:-mx-0 overflow-hidden rounded-4 grain border border-line">
        <div aria-hidden className="absolute inset-0">
          {photoOk && (
            <img
              src="./hero/stadium-bowl-night.webp"
              alt=""
              onError={() => setPhotoOk(false)}
              className="absolute inset-0 w-full h-full object-cover"
            />
          )}
          {/* The grade. Heavy at the top and the left where the type sits,
              lighter toward the bowl so the stadium is actually visible
              rather than merely implied. */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(104deg, rgba(4,7,13,0.96) 0%, rgba(4,7,13,0.88) 34%, rgba(4,7,13,0.52) 68%, rgba(4,7,13,0.38) 100%)",
            }}
          />
          {/* The field's own light, so the photograph keeps some of its
              brightness in the lower right instead of going uniformly
              dark. */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(62% 56% at 78% 84%, rgba(140,185,255,0.26) 0%, transparent 64%)",
            }}
          />
          {/* A floor line, so the panel has a horizon to stand on. */}
          <div
            className="absolute inset-x-0 bottom-0 h-1/3"
            style={{
              background:
                "linear-gradient(180deg, transparent 0%, rgba(4,7,13,0.62) 100%)",
            }}
          />
        </div>

        {/* ── Content plane ────────────────────────────────────────── */}
        <div className="relative px-6 pt-14 pb-24 md:px-12 md:pt-20 md:pb-28">
          <div className="max-w-[54ch]">
            <h1
              className="font-condensed font-semibold text-ink"
              style={{
                fontSize: "var(--fs-hero)",
                lineHeight: 1.02,
                letterSpacing: "-0.03em",
                textWrap: "balance",
              }}
            >
              Every lineup you need, from the live board
            </h1>
            <p
              className="mt-5 text-ink-muted"
              style={{ fontSize: "var(--fs-lead)", maxWidth: "48ch" }}
            >
              The optimizer pulls ESPN&apos;s slate on its own, builds the full
              count you asked for, and shows you where your exposure sits before
              you enter anything.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/nfl"
                className="action inline-flex items-center gap-2 h-12 px-6 text-[15px]"
              >
                Open the NFL optimizer
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                to="/browse"
                className="control inline-flex items-center gap-2 h-12 px-6 text-[15px] font-medium"
              >
                Browse live scores
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ── The cards, one band in front of the photograph ───────────
          They hang over the bottom edge of the photograph together, on a
          single line, so the row reads as one object in front of the room
          rather than as boxes dropped at different heights. */}
      <div className="relative -mt-16 px-6 pb-12 md:px-12 md:pb-16">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-5">
          {SPORTS.map((s) => (
            <Link
              key={s.title}
              to={s.to}
              className={[
                "group relative flex h-full flex-col rounded-3 border bg-surface-1 backdrop-blur-2xl",
                "transition-[transform,border-color,background-color] duration-200",
                "hover:-translate-y-1 hover:border-line-strong hover:bg-surface-3",
                s.featured
                  ? "border-brand/40 shadow-3"
                  : "border-line shadow-3",
              ].join(" ")}
            >
              <div className="flex flex-1 flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="w-11 h-11 rounded-2 grid place-items-center bg-white/6 border border-line">
                    {s.icon}
                  </div>
                  {s.featured && (
                    <span className="shrink-0 rounded-full border border-brand/30 bg-brand-wash px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-brand">
                      Start here
                    </span>
                  )}
                </div>
                <h2 className="mt-4 font-condensed text-xl font-semibold text-ink tracking-tight">
                  {s.title}
                </h2>
                <p className="mt-1.5 text-sm text-ink-muted leading-relaxed">
                  {s.description}
                </p>
                <span className="mt-auto pt-5 inline-flex items-center gap-1.5 text-sm font-medium text-brand transition-[gap] duration-200 group-hover:gap-2.5">
                  Open
                  <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
