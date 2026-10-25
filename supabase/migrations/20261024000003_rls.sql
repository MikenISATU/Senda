-- Row Level Security.
-- Model: all writes go through the Senda server (service role, after Privy
-- verification). Clients may READ with a short-lived Senda-minted JWT whose
-- `sub` is their profile id; these policies decide what they can see.
-- The anon key alone can only see public social content.

alter table public.profiles enable row level security;
alter table public.profile_private enable row level security;
alter table public.linked_wallets enable row level security;
alter table public.follows enable row level security;
alter table public.posts enable row level security;
alter table public.post_premium_content enable row level security;
alter table public.post_media enable row level security;
alter table public.likes enable row level security;
alter table public.comments enable row level security;
alter table public.products enable row level security;
alter table public.purchases enable row level security;
alter table public.entitlements enable row level security;
alter table public.tips enable row level security;
alter table public.jobs enable row level security;
alter table public.applications enable row level security;
alter table public.job_offers enable row level security;
alter table public.escrows enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.attachments enable row level security;
alter table public.tx_intents enable row level security;
alter table public.transfers enable row level security;
alter table public.ledger_events enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.sync_cursors enable row level security;
alter table public.earn_positions enable row level security;
alter table public.earn_rate_snapshots enable row level security;
alter table public.faucet_claims enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.moderation_reports enable row level security;
alter table public.rate_limits enable row level security;

-- No client writes anywhere: revoke DML from client roles (service role bypasses RLS).
revoke insert, update, delete on all tables in schema public from anon, authenticated;

-- Membership helper (security definer avoids recursive RLS on members table).
create or replace function public.is_member(p_conversation uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from conversation_members where conversation_id = p_conversation and profile_id = public.current_profile_id())
$$;

create or replace function public.has_entitlement(p_post uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from products pr join entitlements e on e.product_id = pr.id
    where pr.post_id = p_post and e.profile_id = public.current_profile_id()
  ) or exists (select 1 from posts where id = p_post and author_id = public.current_profile_id())
$$;

-- Public social graph
create policy profiles_read on public.profiles for select using (not is_banned or id = public.current_profile_id());
create policy wallets_read on public.linked_wallets for select using (true); -- public addresses only
create policy follows_read on public.follows for select using (true);
create policy posts_read on public.posts for select using (status = 'active' or author_id = public.current_profile_id());
create policy post_media_public_read on public.post_media for select using (not is_premium or public.has_entitlement(post_id));
create policy premium_read on public.post_premium_content for select using (public.has_entitlement(post_id));
create policy likes_read on public.likes for select using (true);
create policy comments_read on public.comments for select using (status = 'active');
create policy products_read on public.products for select using (true);

-- Private: only the people involved
create policy purchases_read on public.purchases for select using (buyer_id = public.current_profile_id() or seller_id = public.current_profile_id());
create policy entitlements_read on public.entitlements for select using (profile_id = public.current_profile_id());
create policy tips_read on public.tips for select using (from_id = public.current_profile_id() or to_id = public.current_profile_id());

create policy jobs_read on public.jobs for select using (
  status = 'DRAFT' or client_id = public.current_profile_id() or freelancer_id = public.current_profile_id());
create policy applications_read on public.applications for select using (
  freelancer_id = public.current_profile_id()
  or exists (select 1 from public.jobs j where j.id = job_id and j.client_id = public.current_profile_id()));
create policy offers_read on public.job_offers for select using (
  freelancer_id = public.current_profile_id()
  or exists (select 1 from public.jobs j where j.id = job_id and j.client_id = public.current_profile_id()));
create policy escrows_read on public.escrows for select using (
  exists (select 1 from public.jobs j where j.id = job_id
          and (j.client_id = public.current_profile_id() or j.freelancer_id = public.current_profile_id())));

create policy conversations_read on public.conversations for select using (public.is_member(id));
create policy members_read on public.conversation_members for select using (public.is_member(conversation_id));
create policy messages_read on public.messages for select using (public.is_member(conversation_id));
create policy attachments_read on public.attachments for select using (public.is_member(conversation_id));

create policy intents_read on public.tx_intents for select using (profile_id = public.current_profile_id());
create policy transfers_read on public.transfers for select using (profile_id = public.current_profile_id());
create policy earn_read on public.earn_positions for select using (profile_id = public.current_profile_id());
create policy earn_rates_read on public.earn_rate_snapshots for select using (true);
create policy faucet_read on public.faucet_claims for select using (profile_id = public.current_profile_id());
create policy notifications_read on public.notifications for select using (profile_id = public.current_profile_id());
create policy reports_read on public.moderation_reports for select using (reporter_id = public.current_profile_id());

-- profile_private, ledger_events, workflow_runs, sync_cursors, audit_logs, rate_limits:
-- RLS enabled with NO policies => invisible to anon/authenticated. Server only.

-- Hide sensitive tx fields from clients even for their own rows.
revoke select (xdr) on public.tx_intents from anon, authenticated;

-- Realtime for chat and notifications (RLS applies to realtime too).
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.notifications;

-- ───────────────────────────── storage ─────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('public-media', 'public-media', true, 26214400, array['image/png','image/jpeg','image/webp','image/gif','video/mp4']),
  ('premium-media', 'premium-media', false, 26214400, array['image/png','image/jpeg','image/webp','image/gif','video/mp4','application/pdf','application/zip']),
  ('chat-attachments', 'chat-attachments', false, 26214400, null),
  ('avatars', 'avatars', true, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;
-- No storage.objects policies for clients: uploads use server-issued signed
-- upload URLs, and private reads use short-lived server-issued signed URLs
-- after the server checks membership / entitlement.
