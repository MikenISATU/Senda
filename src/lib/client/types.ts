export type PublicProfile = {
  id: string; username: string | null; display_name: string | null; bio: string | null; avatar_url: string | null;
  follower_count: number; following_count: number; role: "user" | "admin" | "mediator"; created_at: string;
};
export type PublicConfig = {
  network: "testnet" | "mainnet"; faucetEnabled: boolean; escrowConfigured: boolean; platformFeeBps: number; targetAprDisplay: number;
  earn: { enabled: boolean; experimental: boolean; reason: string | null };
  paiflow: { configured: boolean; feesUsdc: boolean; feesXlm: boolean };
  realtime: boolean;
};
export type Summary = { title: string; lines: { label: string; value: string }[]; network: string; feeNote: string };
export type PreparedIntent = { intentId: string; hash: string; expiresAt: string; summary: Summary; signer: string };
export type IntentStatus = { intentId: string; kind: string; status: "prepared" | "submitted" | "confirmed" | "failed" | "expired"; hash: string; error: string | null; explorerUrl: string | null; summary: Summary };
export type Media = { id: string; mime: string; url: string | null; locked: boolean };
export type Post = {
  id: string; author_id: string; body: string; repost_of: string | null; is_premium: boolean; like_count: number; comment_count: number;
  repost_count: number; tip_total_usdc: string; created_at: string; author: PublicProfile | null; liked: boolean; media: Media[];
  product: { id: string; price: string; asset: "XLM" | "USDC" } | null; unlocked: boolean; premiumBody: string | null; original?: Post | null;
};
