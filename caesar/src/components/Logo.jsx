/**
 * THE BALANCED VERDICT — the mark, drawn as vector so it is exact at 20px and
 * at 240px.
 *
 * Four elements, and each one is load-bearing:
 *
 *   · the deep-green badge — trust, a round table, a seal;
 *   · gold thumbs-up, left — support, usefulness;
 *   · terracotta thumbs-down, right — dissent, scepticism, constructive
 *     criticism. Not evil. Drawing it as a scowl would be the brand lying
 *     about its own premise;
 *   · Africa at the centre — the continent is the subject, not the backdrop.
 *
 * Both thumbs are the same size and sit on the same axis. That symmetry is the
 * whole argument: agreement and disagreement are equal citizens in a verdict.
 */

const AFRICA =
  "M26 16 L40 12 L56 16 L60 24 L66 34 L80 40 L62 44 L58 58 L54 72 L48 86 L42 80 L40 64 L44 54 L36 48 L26 40 L16 30 L20 20 Z";
const MADAGASCAR = "M63 60 l5 -1 2 7 -1 11 -4 3 -3 -8 z";

function Hand({ x, y, scale = 1, fill }) {
  return (
    <g fill={fill} transform={`translate(${x},${y}) scale(${scale})`}>
      {/* cuff */}
      <rect x="1" y="9" width="5" height="11" rx="1.6" />
      {/* the hand */}
      <path d="M7.6 9h3.1l1.5-4.4a1.9 1.9 0 0 1 3.6 0V9h5.4a2.1 2.1 0 0 1 2 2.7l-2.1 6.4a3 3 0 0 1-2.9 2H7.6Z" />
    </g>
  );
}

export function CaesarMark({ size = 40, className = "", title = "Caesar" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label={title}
      focusable="false"
    >
      <circle cx="32" cy="32" r="31" fill="#0B3D2E" />
      <circle cx="32" cy="32" r="28.5" fill="none" stroke="#F2C14E" strokeOpacity="0.26" strokeWidth="1" />

      {/* Support, at the left. */}
      <Hand x="3.5" y="20.4" scale="0.64" fill="#F2C14E" />
      {/* Dissent, at the right: the same hand, turned over. */}
      <g transform="translate(60.7,43.6) scale(-0.64,-0.64)">
        <g fill="#E07A5F">
          <rect x="1" y="9" width="5" height="11" rx="1.6" />
          <path d="M7.6 9h3.1l1.5-4.4a1.9 1.9 0 0 1 3.6 0V9h5.4a2.1 2.1 0 0 1 2 2.7l-2.1 6.4a3 3 0 0 1-2.9 2H7.6Z" />
        </g>
      </g>

      {/* The continent, at the centre. */}
      <g transform="translate(12.8,12.4) scale(0.4)">
        <path d={AFRICA} fill="#FFF8E7" />
        <path d={MADAGASCAR} fill="#FFF8E7" opacity="0.85" />
      </g>
    </svg>
  );
}

export function CaesarLogo({ size = 34, tagline = false, className = "" }) {
  return (
    <span className={`brand ${className}`}>
      <CaesarMark size={size} />
      <span className="brand__text">
        <span className="brand__word">Caesar</span>
        {tagline && <span className="brand__tag">The community decides</span>}
      </span>
    </span>
  );
}

export default CaesarMark;
