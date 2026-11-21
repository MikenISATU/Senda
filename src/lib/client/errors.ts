/**
 * Turns any error into words a person can act on.
 *
 * Every screen shows `error.message`, so the two places that produce errors
 * (our API helper and the payment flow) run them through here first. The
 * technical text is kept as `detail` for the "Details" section and the
 * browser console, never shown as the headline.
 */
export type Friendly = {
  /** Short heading, e.g. "No connection". */
  title: string;
  /** One or two plain sentences: what happened and what to do. */
  message: string;
  /** What the main button should do, if anything. */
  action: "retry" | "signin" | "reload" | "none";
  /** Stable short code people can quote to support, e.g. "NET-OFFLINE". */
  code: string;
  /** Original technical text, for the Details section. */
  detail: string;
  /** True when no money can have moved. Lets the UI say so plainly. */
  safe: boolean;
};

const f = (code: string, title: string, message: string, action: Friendly["action"] = "retry", safe = true) => ({ code, title, message, action, safe });

/** Technical fragments from the Stellar network, the wallet and browsers, with their plain meaning. */
const PATTERNS: [RegExp, ReturnType<typeof f>][] = [
  // Connection
  [/failed to fetch|networkerror|load failed|network request failed|err_internet|err_network|fetch failed/i, f("NET-OFFLINE", "No connection", "We couldn't reach Senda. Check your internet and try again.")],
  [/timed? ?out|timeout|aborted|took too long/i, f("NET-SLOW", "That took too long", "The connection is slow right now. Try again in a moment.")],
  // Wallet and signing
  [/user (rejected|denied|cancel+ed|closed)|rejected the request|cancel+ed by user|user exited|modal closed/i, f("WALLET-CANCELLED", "You cancelled", "Nothing was sent. You can try again whenever you're ready.", "none")],
  [/popup|pop-up|blocked a frame|third.party cookies|storage access|iframe/i, f("WALLET-BLOCKED", "Your browser blocked the wallet", "Open Senda in Chrome or Safari instead of inside another app, allow pop-ups, then try again.", "reload")],
  [/wallet (not found|unavailable|not ready|proxy)|no (embedded )?wallet|embedded wallet|wallet.*not.*initiali[sz]ed|recovery/i, f("WALLET-NOT-READY", "Your wallet isn't ready yet", "Close Senda and open it again. If it keeps happening, sign out and back in.", "reload")],
  [/signature (does not|doesn't) match|bad signature|invalid signature|tx_bad_auth/i, f("WALLET-SIGNATURE", "The approval didn't match", "Nothing was sent. Please start the payment again.", "none")],
  // Stellar network results
  [/op_underfunded|tx_insufficient_balance|insufficient balance|not enough (xlm|usdc|funds)/i, f("PAY-BALANCE", "Not enough balance", "You don't have enough to cover this amount and the small network fee. Top up or send less.", "none")],
  [/op_low_reserve|below.*reserve|minimum balance/i, f("PAY-RESERVE", "A little XLM must stay in your wallet", "Stellar keeps a small amount of XLM locked in every wallet. Send a bit less, or add XLM first.", "none")],
  [/op_no_trust|trustline|not authorized to hold/i, f("PAY-USDC-OFF", "USDC isn't turned on", "The person receiving hasn't turned on USDC yet. Ask them to open their Senda wallet once, or send XLM instead.", "none")],
  [/op_no_destination|destination.*(not exist|not found)|account not found/i, f("PAY-NO-ACCOUNT", "That wallet isn't active yet", "The receiving wallet hasn't been set up. Check the username or address and try again.", "none")],
  [/op_line_full/i, f("PAY-LIMIT", "They can't receive that much", "The receiving wallet has reached its limit for this currency. Try a smaller amount.", "none")],
  [/tx_bad_seq|sequence/i, f("PAY-BUSY", "Another payment is still finishing", "Wait a few seconds for your last payment to finish, then try again.")],
  [/tx_too_late|expired|too late/i, f("PAY-EXPIRED", "That took too long to approve", "The request expired before it was approved. Nothing was sent. Start it again.", "none")],
  [/tx_insufficient_fee|surge|fee.*too low/i, f("PAY-NETWORK-BUSY", "The network is busy", "Stellar is busy right now. Try again in a minute.")],
  [/simulation failed|host error|contract.*(panic|trap|error)|wasm|hosterror/i, f("PAY-REJECTED", "This payment can't be made right now", "The payment was checked and refused before anything was sent. Try again, or contact support if it keeps happening.")],
];

/** By HTTP status, for answers from our own server that carry no friendly text. */
function byStatus(status: number): ReturnType<typeof f> | null {
  if (status === 401) return f("AUTH-ENDED", "Please sign in again", "Your session ended to keep your account safe. Sign in to carry on.", "signin");
  if (status === 403) return f("AUTH-NOT-ALLOWED", "You can't do that", "Your account doesn't have access to this.", "none");
  if (status === 404) return f("NOT-FOUND", "We couldn't find that", "It may have been removed, or the link is wrong.", "none");
  if (status === 413) return f("TOO-BIG", "That file is too large", "Choose a smaller photo or file and try again.", "none");
  if (status === 429) return f("SLOW-DOWN", "Too many tries", "Please wait a minute, then try again.");
  if (status >= 500) return f("SERVER", "Something went wrong on our side", "This one is on us, not you. Try again in a moment.");
  return null;
}

const looksTechnical = (m: string) => /^[A-Za-z]+Error\b|[{}<>]|\bat \w+ \(|https?:\/\/|\b0x[0-9a-f]{6,}|[A-Za-z0-9_]{24,}|undefined|null is not|cannot read|is not a function|unexpected token|request failed \(\d+\)/i.test(m);

/**
 * @param e       anything that was thrown
 * @param status  HTTP status when the error came from our API
 * @param moneyMayHaveMoved  set when a payment was already sent to the network
 * @param fromServer  the text was written by our own server for a person
 */
export function friendlyError(e: unknown, opts: { status?: number; moneyMayHaveMoved?: boolean; fromServer?: boolean } = {}): Friendly {
  const existing = (e as { friendly?: Friendly } | null)?.friendly;
  if (existing) return existing;
  const detail = (e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e ?? "")) || "Unknown error";
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  const hit = offline ? PATTERNS[0][1] : PATTERNS.find(([re]) => re.test(detail))?.[1];
  const status = opts.status ?? (e as { status?: number } | null)?.status ?? 0;

  // Our server already writes its refusals for a person (for example "Amount must be
  // greater than zero"). Keep those exact words; only borrow a heading and code.
  const serverWords = !offline && (opts.fromServer || (status >= 400 && status < 500 && status !== 401)) && !!detail && !looksTechnical(detail);

  let base: ReturnType<typeof f>;
  if (serverWords) base = { ...(hit ?? f(status ? `REQ-${status}` : "REQ", "Please check and try again", detail, "none")), message: detail };
  else if (hit) base = hit;
  else base = byStatus(status) ?? f("UNKNOWN", "Something went wrong", "Please try again. If it keeps happening, contact support and mention the code below.");

  const out: Friendly = { ...base, detail, safe: opts.moneyMayHaveMoved ? false : base.safe };
  if (opts.moneyMayHaveMoved) {
    out.title = "We're not sure it went through";
    out.message = "Your payment may still complete. Don't send it again: tap Check status first.";
    out.action = "none";
  }
  return out;
}

/** An error whose `.message` is already friendly, with the full picture attached. */
export class FriendlyError extends Error {
  friendly: Friendly;
  status: number;
  code: string;
  constructor(friendly: Friendly, status = 0) {
    super(friendly.message);
    this.name = "FriendlyError";
    this.friendly = friendly;
    this.status = status;
    this.code = friendly.code;
  }
}

/** One structured line in the browser console per problem, so it can be found and reported. */
export function logError(where: string, fr: Friendly, extra: Record<string, unknown> = {}) {
  if (fr.code === "WALLET-CANCELLED") return; // a choice, not a problem
  console.error(`[senda] ${fr.code} in ${where}`, { title: fr.title, detail: fr.detail, online: typeof navigator === "undefined" ? null : navigator.onLine, at: new Date().toISOString(), ...extra });
}
