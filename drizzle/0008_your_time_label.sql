-- The manage screen prints the studio's wall-clock time first and the
-- booker's own clock underneath. That second line had no dictionary key, so
-- a Turkish page read "Your time: 25 Eylül 2026 00:30".
insert into translations (location_id, app, namespace, key, locale, value) values
  (null, 'booking', 'ui.labels', 'your_time', 'en', 'Your time'),
  (null, 'booking', 'ui.labels', 'your_time', 'tr', 'Sizin saatinizle'),
  (null, 'booking', 'ui.labels', 'your_time', 'es', 'Tu hora'),
  (null, 'booking', 'ui.labels', 'your_time', 'de', 'Deine Zeit')
on conflict do nothing;
