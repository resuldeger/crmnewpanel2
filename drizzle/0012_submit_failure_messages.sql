-- Every booking failure showed one sentence: "check your information".
-- A dropped connection, a proxy answering with HTML, a studio that could
-- not be reached — all told the customer their perfectly valid details
-- were wrong, with nothing to actually fix.
insert into translations (location_id, app, namespace, key, locale, value) values
  (null,'booking','ui.messages','no_connection','en','No internet connection. Your answers are saved — reconnect and try again.'),
  (null,'booking','ui.messages','no_connection','tr','İnternet bağlantısı yok. Bilgileriniz kayıtlı — bağlanıp tekrar deneyin.'),
  (null,'booking','ui.messages','no_connection','es','Sin conexión a internet. Tus datos están guardados: reconecta e inténtalo de nuevo.'),
  (null,'booking','ui.messages','no_connection','de','Keine Internetverbindung. Deine Angaben sind gespeichert — verbinde dich und versuche es erneut.'),

  (null,'booking','ui.messages','studio_unreachable','en','We could not reach the studio just now. Your answers are saved — please try again.'),
  (null,'booking','ui.messages','studio_unreachable','tr','Şubeye şu an ulaşamadık. Bilgileriniz kayıtlı — lütfen tekrar deneyin.'),
  (null,'booking','ui.messages','studio_unreachable','es','No pudimos contactar con el estudio ahora mismo. Tus datos están guardados: inténtalo de nuevo.'),
  (null,'booking','ui.messages','studio_unreachable','de','Wir konnten das Studio gerade nicht erreichen. Deine Angaben sind gespeichert — bitte versuche es erneut.'),

  (null,'booking','ui.messages','too_many_attempts','en','Too many attempts. Please wait a moment and try again.'),
  (null,'booking','ui.messages','too_many_attempts','tr','Çok fazla deneme yapıldı. Lütfen biraz bekleyip tekrar deneyin.'),
  (null,'booking','ui.messages','too_many_attempts','es','Demasiados intentos. Espera un momento e inténtalo de nuevo.'),
  (null,'booking','ui.messages','too_many_attempts','de','Zu viele Versuche. Bitte warte einen Moment und versuche es erneut.')
on conflict do nothing;
