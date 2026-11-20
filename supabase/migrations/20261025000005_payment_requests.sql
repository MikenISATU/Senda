-- 0005: payment requests in chat ("Request money").
-- A request is a chat message (kind 'request') plus a row here. The payer pays
-- with an ordinary signed payment; the request flips to 'paid' only after the
-- payment is confirmed on the ledger (see effects.ts, intent kind 'payment').

alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages add constraint messages_kind_check check (kind in ('text', 'proof', 'system', 'request'));

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid unique references public.messages(id) on delete set null,
  requester_id uuid not null references public.profiles(id),
  payer_id uuid not null references public.profiles(id),
  asset text not null check (asset in ('XLM', 'USDC')),
  amount numeric(20, 7) not null check (amount > 0),
  note text not null default '' check (char_length(note) <= 140),
  status text not null default 'open' check (status in ('open', 'paid', 'declined', 'cancelled')),
  intent_id uuid references public.tx_intents(id),
  tx_hash text,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  check (requester_id <> payer_id)
);
create index if not exists payment_requests_conv on public.payment_requests (conversation_id, created_at);
create index if not exists payment_requests_payer_open on public.payment_requests (payer_id) where status = 'open';

-- Server-only table: all reads and writes go through the API (service role).
alter table public.payment_requests enable row level security;
revoke all on public.payment_requests from anon, authenticated;
