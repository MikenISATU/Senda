/** Static poster of the hero motif. Used for reduced motion, low-power devices, before the 3D scene loads, and as the no-JS fallback. */
export function HeroPoster({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 600 560" className={className} role="img" aria-label="A ribbon of payments looping between people">
      <defs>
        <linearGradient id="rib" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#4169F5" /><stop offset="1" stopColor="#2D4FD6" /></linearGradient>
        <linearGradient id="rib2" x1="0" x2="1"><stop offset="0" stopColor="#24CBA8" /><stop offset="1" stopColor="#7BE3CD" /></linearGradient>
        <radialGradient id="glass" cx="35%" cy="30%" r="70%"><stop offset="0" stopColor="#FFFFFF" /><stop offset="0.6" stopColor="#E7EDFF" /><stop offset="1" stopColor="#B9C8F7" /></radialGradient>
      </defs>
      <path d="M90 300 C 120 120, 330 80, 450 170 S 560 420, 380 460 S 60 470, 90 300 Z" fill="none" stroke="url(#rib)" strokeWidth="34" strokeLinejoin="round" opacity="0.95" />
      <path d="M140 330 C 170 200, 320 150, 420 220 S 500 380, 360 410 S 120 420, 140 330 Z" fill="none" stroke="url(#rib2)" strokeWidth="10" />
      {[[100, 300, 46], [300, 110, 38], [500, 290, 44], [380, 460, 36], [190, 440, 30]].map(([x, y, r], i) => (
        <g key={i}>
          <polygon points={hex(x, y, r)} fill="url(#glass)" stroke="#101B2D" strokeOpacity="0.12" />
          <polygon points={hex(x, y, r * 0.45)} fill={i % 2 ? "#24CBA8" : "#4169F5"} opacity="0.9" />
        </g>
      ))}
      <circle cx="450" cy="170" r="9" fill="#24CBA8" />
    </svg>
  );
}

function hex(cx: number, cy: number, r: number) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
}
