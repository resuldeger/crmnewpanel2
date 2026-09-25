-- window.confirm() was replaced by an in-page sheet, which needs its own
-- two buttons. The month arrows had no accessible name either.
-- Scoped to the locales that actually exist. These rows point at
-- `locales` by foreign key, and nothing in drizzle/ creates that table's
-- contents — it is seeded. So on a fresh database, migrated before any
-- seed has run, a straight INSERT fails on the foreign key and takes the
-- whole migration chain down with it. Which is exactly what happened the
-- first time the full chain was run end to end.
insert into translations (location_id, app, namespace, key, locale, value)
select null, 'booking', v.namespace, v.key, v.locale, v.value
  from (values
    ('ui.buttons', 'cancel_confirm_yes', 'en', 'Yes, cancel it'),
    ('ui.buttons', 'cancel_confirm_yes', 'tr', 'Evet, iptal et'),
    ('ui.buttons', 'cancel_confirm_yes', 'es', 'Sí, cancelar'),
    ('ui.buttons', 'cancel_confirm_yes', 'de', 'Ja, stornieren'),
    ('ui.buttons', 'cancel_confirm_no', 'en', 'Keep my appointment'),
    ('ui.buttons', 'cancel_confirm_no', 'tr', 'Randevum kalsın'),
    ('ui.buttons', 'cancel_confirm_no', 'es', 'Mantener mi cita'),
    ('ui.buttons', 'cancel_confirm_no', 'de', 'Termin behalten'),
    ('ui.buttons', 'prev_month', 'en', 'Previous month'),
    ('ui.buttons', 'prev_month', 'tr', 'Önceki ay'),
    ('ui.buttons', 'prev_month', 'es', 'Mes anterior'),
    ('ui.buttons', 'prev_month', 'de', 'Voriger Monat'),
    ('ui.buttons', 'next_month', 'en', 'Next month'),
    ('ui.buttons', 'next_month', 'tr', 'Sonraki ay'),
    ('ui.buttons', 'next_month', 'es', 'Mes siguiente'),
    ('ui.buttons', 'next_month', 'de', 'Nächster Monat')
  ) as v(namespace, key, locale, value)
 where exists (select 1 from locales l where l.code = v.locale)
on conflict do nothing;
