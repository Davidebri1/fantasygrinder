/**
 * Canvas atmosphere — the layer behind the light canvas.
 *
 * The app sits on a light grey canvas, so this is not about making the page
 * dark. It is about giving the empty space around the cards some depth so
 * the white surfaces read as objects floating above a surface rather than
 * as paint on a wall.
 *
 * Three things do the work:
 *   1. a cool wash from the top, so the page has a direction of light;
 *   2. a soft pool of light low and centred, like spill from the stadium;
 *   3. a fine grain, which stops the large flat area from banding.
 *
 * Nothing animates. The only movement on the page is movement that carries
 * information.
 */
export function DepthBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Direction of light — brighter at the top, sinking toward the fold. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, #f2f5f9 0%, var(--canvas) 38%, #e4e8ee 100%)",
        }}
      />

      {/* Spill from the stadium, low and centred. */}
      <div
        className="absolute -bottom-[30vh] left-1/2 -translate-x-1/2 h-[62vh] w-[88vw]"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(27,86,196,0.09) 0%, rgba(27,86,196,0.035) 40%, transparent 68%)",
        }}
      />

      {/* A cool counter-light in the upper right, so the top of the page
          is not a flat field. */}
      <div
        className="absolute -top-[24vh] right-[-10vw] h-[52vh] w-[52vw]"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(10,31,68,0.09) 0%, transparent 66%)",
        }}
      />

      {/* Grain over the large flat area. */}
      <div
        className="absolute inset-0 opacity-[0.35] mix-blend-multiply"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  );
}
