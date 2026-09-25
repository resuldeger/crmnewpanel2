-- Every booking failure showed one sentence: "check your information".
-- A dropped connection, a proxy answering with HTML, a studio that could
-- not be reached — all told the customer their perfectly valid details
-- were wrong, with nothing to actually fix.
-- Scoped to the locales that actually exist. These rows point at
-- `locales` by foreign key, and nothing in drizzle/ creates that table's
-- contents — it is seeded. So on a fresh database, migrated before any
-- seed has run, a straight INSERT fails on the foreign key and takes the
-- whole migration chain down with it. Which is exactly what happened the
-- first time the full chain was run end to end.
insert into translations (location_id, app, namespace, key, locale, value)
select null, 'booking', v.namespace, v.key, v.locale, v.value
  from (values
    ('ui.messages', 'no_connection', 'en', 'No internet connection. Your answers are saved — reconnect and try again.'),
    ('ui.messages', 'no_connection', 'tr', 'İnternet bağlantısı yok. Bilgileriniz kayıtlı — bağlanıp tekrar deneyin.'),
    ('ui.messages', 'no_connection', 'es', 'Sin conexión a internet. Tus datos están guardados: reconecta e inténtalo de nuevo.'),
    ('ui.messages', 'no_connection', 'de', 'Keine Internetverbindung. Deine Angaben sind gespeichert — verbinde dich und versuche es erneut.'),
    ('ui.messages', 'studio_unreachable', 'en', 'We could not reach the studio just now. Your answers are saved — please try again.'),
    ('ui.messages', 'studio_unreachable', 'tr', 'Şubeye şu an ulaşamadık. Bilgileriniz kayıtlı — lütfen tekrar deneyin.'),
    ('ui.messages', 'studio_unreachable', 'es', 'No pudimos contactar con el estudio ahora mismo. Tus datos están guardados: inténtalo de nuevo.'),
    ('ui.messages', 'studio_unreachable', 'de', 'Wir konnten das Studio gerade nicht erreichen. Deine Angaben sind gespeichert — bitte versuche es erneut.'),
    ('ui.messages', 'too_many_attempts', 'en', 'Too many attempts. Please wait a moment and try again.'),
    ('ui.messages', 'too_many_attempts', 'tr', 'Çok fazla deneme yapıldı. Lütfen biraz bekleyip tekrar deneyin.'),
    ('ui.messages', 'too_many_attempts', 'es', 'Demasiados intentos. Espera un momento e inténtalo de nuevo.'),
    ('ui.messages', 'too_many_attempts', 'de', 'Zu viele Versuche. Bitte warte einen Moment und versuche es erneut.')
  ) as v(namespace, key, locale, value)
 where exists (select 1 from locales l where l.code = v.locale)
on conflict do nothing;
