-- window.confirm() was replaced by an in-page sheet, which needs its own
-- two buttons. The month arrows had no accessible name either.
insert into translations (location_id, app, namespace, key, locale, value) values
  (null, 'booking', 'ui.buttons', 'cancel_confirm_yes', 'en', 'Yes, cancel it'),
  (null, 'booking', 'ui.buttons', 'cancel_confirm_yes', 'tr', 'Evet, iptal et'),
  (null, 'booking', 'ui.buttons', 'cancel_confirm_yes', 'es', 'Sí, cancelar'),
  (null, 'booking', 'ui.buttons', 'cancel_confirm_yes', 'de', 'Ja, stornieren'),

  (null, 'booking', 'ui.buttons', 'cancel_confirm_no', 'en', 'Keep my appointment'),
  (null, 'booking', 'ui.buttons', 'cancel_confirm_no', 'tr', 'Randevum kalsın'),
  (null, 'booking', 'ui.buttons', 'cancel_confirm_no', 'es', 'Mantener mi cita'),
  (null, 'booking', 'ui.buttons', 'cancel_confirm_no', 'de', 'Termin behalten'),

  (null, 'booking', 'ui.buttons', 'prev_month', 'en', 'Previous month'),
  (null, 'booking', 'ui.buttons', 'prev_month', 'tr', 'Önceki ay'),
  (null, 'booking', 'ui.buttons', 'prev_month', 'es', 'Mes anterior'),
  (null, 'booking', 'ui.buttons', 'prev_month', 'de', 'Voriger Monat'),

  (null, 'booking', 'ui.buttons', 'next_month', 'en', 'Next month'),
  (null, 'booking', 'ui.buttons', 'next_month', 'tr', 'Sonraki ay'),
  (null, 'booking', 'ui.buttons', 'next_month', 'es', 'Mes siguiente'),
  (null, 'booking', 'ui.buttons', 'next_month', 'de', 'Nächster Monat')
on conflict do nothing;
