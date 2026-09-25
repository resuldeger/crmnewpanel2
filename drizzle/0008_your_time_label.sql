-- The manage screen prints the studio's wall-clock time first and the
-- booker's own clock underneath. That second line had no dictionary key, so
-- a Turkish page read "Your time: 25 Eylül 2026 00:30".
-- Scoped to the locales that actually exist. These rows point at
-- `locales` by foreign key, and nothing in drizzle/ creates that table's
-- contents — it is seeded. So on a fresh database, migrated before any
-- seed has run, a straight INSERT fails on the foreign key and takes the
-- whole migration chain down with it. Which is exactly what happened the
-- first time the full chain was run end to end.
insert into translations (location_id, app, namespace, key, locale, value)
select null, 'booking', v.namespace, v.key, v.locale, v.value
  from (values
    ('ui.labels', 'your_time', 'en', 'Your time'),
    ('ui.labels', 'your_time', 'tr', 'Sizin saatinizle'),
    ('ui.labels', 'your_time', 'es', 'Tu hora'),
    ('ui.labels', 'your_time', 'de', 'Deine Zeit')
  ) as v(namespace, key, locale, value)
 where exists (select 1 from locales l where l.code = v.locale)
on conflict do nothing;
