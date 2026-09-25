-- A booker rescheduling or cancelling from their own /b/{uuid} link is
-- neither staff nor the system. Logging those as 'system' hid them among
-- the job runner's own entries, and the console could not tell a customer
-- move from an operator's.
alter type actor_kind_t add value if not exists 'customer';
