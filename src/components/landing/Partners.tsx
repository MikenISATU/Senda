/** Partner strip that loops left to right. Marks come from each partner's own sources (Stellar, Supabase and Vercel via simple-icons, Paiflow from its repo); Privy and Web3 Iloilo as wordmarks. */

function StellarMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-8" fill="currentColor" aria-hidden>
      <path d="M12.003 1.716c-1.37 0-2.7.27-3.948.78A10.18 10.18 0 0 0 2.66 7.901a10.136 10.136 0 0 0-.797 3.954c0 .258.01.516.027.775a1.942 1.942 0 0 1-1.055 1.88L0 14.934v1.902l2.463-1.26.072-.032v.005l.77-.39.758-.385.066-.039 14.807-7.56 1.666-.847 3.392-1.732V2.694L17.792 5.86 3.744 13.025l-.104.055-.017-.115a8.286 8.286 0 0 1-.071-1.105c0-2.255.88-4.377 2.474-5.977a8.462 8.462 0 0 1 2.71-1.82 8.513 8.513 0 0 1 3.2-.654h.067a8.41 8.41 0 0 1 4.09 1.055l1.628-.83.126-.066a10.11 10.11 0 0 0-5.845-1.853zM24 7.143 5.047 16.808l-1.666.847L0 19.382v1.902l3.282-1.671 2.91-1.485 14.058-7.153.105-.055.016.115c.05.369.072.743.072 1.11 0 2.255-.88 4.383-2.475 5.978a8.461 8.461 0 0 1-2.71 1.82 8.305 8.305 0 0 1-3.2.654h-.06c-1.441 0-2.86-.369-4.102-1.061l-.066.033-1.683.857c.594.418 1.232.776 1.903 1.062a10.11 10.11 0 0 0 3.947.797 10.09 10.09 0 0 0 7.17-2.975 10.136 10.136 0 0 0 2.969-7.18c0-.259-.005-.523-.027-.781a1.942 1.942 0 0 1 1.055-1.88L24 9.044z" />
    </svg>
  );
}

function PaiflowMark() {
  return (
    <svg viewBox="0 0 32 32" className="size-8" fill="none" aria-hidden>
      <g stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6,7 10,11 6,15" />
        <polyline points="13,11 17,15 13,19" opacity="0.78" />
        <polyline points="20,15 24,19 20,23" opacity="0.55" />
      </g>
    </svg>
  );
}

function SupabaseMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-7" fill="currentColor" aria-hidden>
      <path d="M11.9 1.036c-.015-.986-1.26-1.41-1.874-.637L.764 12.05C-.33 13.427.65 15.455 2.409 15.455h9.579l.113 7.51c.014.985 1.259 1.408 1.873.636l9.262-11.653c1.093-1.375.113-3.403-1.645-3.403h-9.642z" />
    </svg>
  );
}

function VercelMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="currentColor" aria-hidden>
      <path d="m12 1.608 12 20.784H0Z" />
    </svg>
  );
}

const ITEMS = [
  { name: "Stellar", note: "Network", mark: <StellarMark />, word: "font-sans font-medium" },
  { name: "Paiflow", note: "Payment flows", mark: <PaiflowMark />, word: "font-sans font-medium" },
  { name: "Supabase", note: "Database", mark: <SupabaseMark />, word: "font-sans font-medium" },
  { name: "Privy", note: "Sign-in", mark: null, word: "font-display font-bold" },
  { name: "Vercel", note: "Hosting", mark: <VercelMark />, word: "font-sans font-semibold" },
  { name: "Web3 Iloilo", note: "Community", mark: null, word: "font-display font-bold" },
];

function Row({ hidden }: { hidden?: boolean }) {
  return (
    <ul className="flex shrink-0 items-center" aria-hidden={hidden || undefined}>
      {[...ITEMS, ...ITEMS].map((p, i) => (
        <li key={i} className="flex shrink-0 items-center gap-3 px-10 text-slate md:px-14">
          {p.mark}
          <span className={`text-[1.7rem] tracking-tight ${p.word}`}>{p.name}</span>
          <span className="text-sm">{p.note}</span>
        </li>
      ))}
    </ul>
  );
}

export function Partners() {
  return (
    <div className="marquee relative overflow-hidden py-6 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
      <div className="marquee-track flex w-max">
        <Row />
        <Row hidden />
      </div>
    </div>
  );
}
