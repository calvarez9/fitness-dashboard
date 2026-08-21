-- ============================================================
-- sync_state was deliberately left with no policy at all in 001_init.sql
-- (service_role-only bookkeeping) -- but the dashboard's "Last synced"
-- footer reads it as the logged-in user, which was always silently
-- getting a 403. Nothing sensitive lives in this table (just a couple
-- of small status strings), so a plain authenticated-read policy is safe.
-- ============================================================
create policy "authenticated read" on sync_state for select to authenticated using (true);
grant select on sync_state to authenticated;
