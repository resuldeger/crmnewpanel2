-- ── Recordings are their own integration ──────────────────────────────
-- Company Call Recording is a separate permission on the VBC API user,
-- and it is not granted on this account:
--   "User is not authorized to search CCR recordings for this account"
--
-- Reported under "vonage", that one missing permission halted the call
-- sync, the directory sync and the live-call poller along with it — none
-- of which have anything to do with recordings, and all of which work.
--
-- Its own row means the panel can say "recordings are blocked on a VBC
-- permission" while the rest of the Vonage integration keeps running.
insert into integrations (provider, label, enabled)
values ('vonage-recordings', 'Vonage Call Recordings', true)
on conflict do nothing;
