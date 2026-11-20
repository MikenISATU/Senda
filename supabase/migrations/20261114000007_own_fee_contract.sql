-- 0007: Senda now splits fees with its own fee_splitter contract.
-- Removes the old third-party provider values and allows the 'fee_distribute'
-- intent used by Admin > Distribute. Safe to run more than once.

delete from public.ledger_events where source not in ('horizon', 'soroban');
delete from public.workflow_runs where provider not in ('stellar', 'soroban');
delete from public.tx_intents where provider not in ('stellar', 'soroban');

alter table public.tx_intents drop constraint if exists tx_intents_kind_check;
alter table public.tx_intents add constraint tx_intents_kind_check check (kind in (
  'payment', 'tip', 'purchase', 'trustline', 'escrow_fund', 'escrow_action',
  'earn_supply', 'earn_withdraw', 'fee_distribute'));

alter table public.tx_intents drop constraint if exists tx_intents_provider_check;
alter table public.tx_intents add constraint tx_intents_provider_check check (provider in ('stellar', 'soroban'));

alter table public.ledger_events drop constraint if exists ledger_events_source_check;
alter table public.ledger_events add constraint ledger_events_source_check check (source in ('horizon', 'soroban'));

alter table public.workflow_runs drop constraint if exists workflow_runs_provider_check;
alter table public.workflow_runs add constraint workflow_runs_provider_check check (provider in ('stellar', 'soroban'));
