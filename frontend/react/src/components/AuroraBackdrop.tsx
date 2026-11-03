/**
 * The light in the room.
 *
 * The app is dark because DFS happens at night, but a dark canvas on its own
 * is just a dark canvas. What makes it feel like a place is that there is
 * light in it, coming from somewhere, and that you can see it through the
 * glass the panels are made of.
 *
 * So the room is built in four layers, bottom to top:
 *   1. the field-lines photograph, blurred until the yard lines become
 *      streaks of light — baked into the asset, so the browser pays nothing;
 *   2. a cold key light from above, which gives the page a direction;
 *   3. a fill in the colour of the sport you are in, low and to the left —
 *      this is the brightest bloom, and it sits behind the working area so
 *      the numbers you are reading are the lit part of the room;
 *   4. a warm ember counter in the far corner, so the field is not flat.
 *
 * The colour is not decoration: it changes with the sport, so the light in
 * the room tells you which board you are looking at.
 */
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/** The colour each sport puts into the room. */
const SPORT_LIGHT: Record<string, string> = {
  "/nba": "#4c8dff",
  "/nfl": "#25c97f",
  "/mma": "#ff5a3c",
  "/golf": "#f0c64b",
  "/": "#4c8dff",
};

export function AuroraBackdrop() {
  const location = useLocation();

  useEffect(() => {
    const root = document.documentElement;
    const light = SPORT_LIGHT[location.pathname] ?? SPORT_LIGHT["/"];
    root.style.setProperty("--sport", light);
  }, [location.pathname]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* 1. The field, blurred until it is texture. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "url(/hero/field-blurred.webp)",
          backgroundSize: "cover",
          backgroundPosition: "center 40%",
          opacity: 0.5,
        }}
      />

      {/* 2. Key light from above — the direction of the room. */}
      <div
        className="absolute -top-[30vh] left-1/2 h-[70vh] w-[120vw] -translate-x-1/2"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(191,214,255,0.15) 0%, rgba(120,160,230,0.05) 40%, transparent 70%)",
          mixBlendMode: "screen",
        }}
      />

      {/* 3. The sport's colour, low and to the left, behind the work. */}
      <div
        className="drift-a absolute -bottom-[24vh] -left-[12vw] h-[76vh] w-[74vw]"
        style={{
          background:
            "radial-gradient(ellipse at center, color-mix(in srgb, var(--sport) 24%, transparent) 0%, color-mix(in srgb, var(--sport) 7%, transparent) 44%, transparent 70%)",
          mixBlendMode: "screen",
        }}
      />

      {/* 4. A warm counter in the far corner, so the field is not flat. */}
      <div
        className="drift-b absolute -top-[16vh] -right-[10vw] h-[54vh] w-[48vw]"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(255,122,69,0.13) 0%, rgba(255,122,69,0.035) 42%, transparent 68%)",
          mixBlendMode: "screen",
        }}
      />

      {/* A second, slower movement low and right so the room breathes. */}
      <div
        className="drift-c absolute -bottom-[30vh] right-[-14vw] h-[60vh] w-[52vw]"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(140,190,255,0.09) 0%, transparent 66%)",
          mixBlendMode: "screen",
        }}
      />

      {/* The floor of the room — a deep gradient that settles the edges. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(4,6,10,0.50) 0%, rgba(4,6,10,0.28) 34%, rgba(4,6,10,0.68) 100%)",
        }}
      />

      {/* Grain over the large flat area. */}
      <div
        className="absolute inset-0 opacity-[0.32] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  );
}
