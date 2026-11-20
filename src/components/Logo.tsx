export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="16" fill="#101B2D" />
      <path d="M18 40c8 6 20 6 28-2" stroke="#24CBA8" strokeWidth="6" fill="none" strokeLinecap="round" />
      <path d="M46 24c-8-6-20-6-28 2" stroke="#4169F5" strokeWidth="6" fill="none" strokeLinecap="round" />
    </svg>
  );
}
