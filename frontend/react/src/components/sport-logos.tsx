/**
 * Sport brand marks — self-contained inline SVG wordmarks.
 *
 * Rendered inline (not hotlinked) so they work offline, on file://, and
 * on any static host with zero network dependency. Each uses the sport's
 * real brand colors and a legible wordmark.
 */

export function NbaLogo({ size = 48 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="NBA"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="100" height="100" rx="12" fill="#1d428a" />
      <rect x="0" y="0" width="50" height="100" rx="12" fill="#17408b" />
      <rect x="50" y="0" width="50" height="100" rx="12" fill="#c8102e" />
      <rect x="46" y="0" width="8" height="100" fill="#ffffff" />
      <text
        x="50"
        y="63"
        textAnchor="middle"
        fontFamily="Barlow Condensed, Arial, sans-serif"
        fontSize="40"
        fontWeight="700"
        fill="#ffffff"
        letterSpacing="1"
      >
        NBA
      </text>
    </svg>
  );
}

export function UfcLogo({ size = 48 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="UFC"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="100" height="100" rx="12" fill="#d20a0a" />
      <text
        x="50"
        y="63"
        textAnchor="middle"
        fontFamily="Barlow Condensed, Arial, sans-serif"
        fontSize="42"
        fontWeight="700"
        fill="#ffffff"
        letterSpacing="-1"
      >
        UFC
      </text>
    </svg>
  );
}

export function GolfLogo({ size = 48 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="PGA Tour"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="100" height="100" rx="12" fill="#0b2f5c" />
      <text
        x="50"
        y="54"
        textAnchor="middle"
        fontFamily="Barlow Condensed, Georgia, serif"
        fontSize="34"
        fontWeight="700"
        fill="#ffffff"
        letterSpacing="1"
      >
        PGA
      </text>
      <text
        x="50"
        y="76"
        textAnchor="middle"
        fontFamily="Barlow Condensed, Georgia, serif"
        fontSize="16"
        fontWeight="600"
        fill="#c8a24a"
        letterSpacing="6"
      >
        TOUR
      </text>
    </svg>
  );
}
