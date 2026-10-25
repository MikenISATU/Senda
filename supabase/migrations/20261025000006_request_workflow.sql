-- 0006: track chat request payments separately and repair workflow statuses.

alter table public.workflow_runs drop constraint if exists workflow_runs_workflow_key_check;
alter table public.workflow_runs add constraint workflow_runs_workflow_key_check
  check (workflow_key in ('SEND', 'RECEIVE', 'REQUEST', 'TIP', 'POST_PURCHASE', 'JOB_FUND', 'FEE_SWEEP'));

-- Requests created before this migration were recorded as generic SEND runs.
update public.workflow_runs wr
set workflow_key = 'REQUEST', updated_at = now()
from public.tx_intents ti
where wr.intent_id = ti.id
  and wr.workflow_key = 'SEND'
  and ti.kind = 'payment'
  and ti.payload ? 'requestId';

-- Older TIP, POST_PURCHASE and JOB_FUND runs were linked to an intent but their
-- final status was not copied back. Reconcile them from the authoritative
-- transaction intent without changing any payment or entitlement.
update public.workflow_runs wr
set status = ti.status,
    tx_hash = case when ti.status in ('submitted', 'confirmed', 'failed') then ti.tx_hash else wr.tx_hash end,
    updated_at = now()
from public.tx_intents ti
where wr.intent_id = ti.id
  and (wr.status is distinct from ti.status
       or (ti.status in ('submitted', 'confirmed', 'failed') and wr.tx_hash is distinct from ti.tx_hash));
