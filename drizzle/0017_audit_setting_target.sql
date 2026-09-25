-- Workspace settings changes had no target type of their own, so they were
-- filed under "role" — which reads, in the audit trail, as somebody having
-- changed permissions. The one screen where that distinction matters most.
alter type audit_target_t add value if not exists 'setting';
