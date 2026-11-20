-- Run Senda's reconciler every 5 minutes from Supabase (pg_cron + pg_net).
-- The reconciler confirms payments, expires stale ones, syncs job payments and
-- pays out waiting job fees. It lives in your deployed app, so this needs your
-- live URL (Supabase cannot reach localhost).
--
-- 1. Database > Extensions: enable pg_cron and pg_net.
-- 2. Replace YOUR-APP.vercel.app and YOUR_CRON_SECRET below, then run this block once.

select cron.schedule(
  'senda-reconcile',
  '*/5 * * * *',
  $$
  select net.http_get(
    url := 'https://YOUR-APP.vercel.app/api/cron/reconcile',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET'),
    timeout_milliseconds := 55000
  );
  $$
);

-- ───────────── Is it working? Run these any time ─────────────

-- a) Is the job scheduled and active?
select jobid, jobname, schedule, active from cron.job;

-- b) Did it fire? One row per run; status should be 'succeeded'.
select jobid, status, return_message, start_time, end_time
from cron.job_run_details
order by start_time desc
limit 10;

-- c) What did the app answer? status_code 200 and a JSON report means it worked.
--    401 = wrong CRON_SECRET. Null/timeout = wrong URL or the app is down.
select id, status_code, left(content::text, 300) as body, error_msg, created
from net._http_response
order by created desc
limit 5;

-- ───────────── Change or stop it ─────────────
-- select cron.unschedule('senda-reconcile');
