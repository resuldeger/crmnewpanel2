# Cleopatra CRM & React Booking Engine — Kapsamlı Sistem Mimarisi, Servisler, Webhooklar, Commandlar ve Veritabanı Analiz Kılavuzu

> **Bu Dokümanın Amacı:**  
> Bu dosya; mevcut Laravel backend'ini, `reactproje` (müşteri randevu rezervasyon motoru) klasörünü, tüm servisleri, webhook akışlarını, cron/command işleyişlerini ve veritabanı şemasını yapay zekanın (ve geliştiricinin) sıfırdan anlayıp yeni panel/veritabanı mimarisi kurabilmesi ve veri aktarımını kusursuz yapabilmesi için hazırlanmış **ana referans rehberidir**.

---

## BÖLÜM 1: `reactproje` (React Rezervasyon Motoru) Tam Analizi

`reactproje/` klasörü, Cleopatra Ink stüdyoları için müşterilerin web üzerinden dövme/piercing randevusu aldığı interaktif, çok dilli, adım adım (multi-step) çalışan bir React SPA uygulamasıdır.

### 1.1. Nasıl Çalışır ve Entegrasyon Mimarisi
- **Çalışma Modeli:** Stüdyo bazlı çalışır. URL'den veya Blade şablonundan `window.__BOOKING_LOCATION__` aracılığıyla `location_slug` alınır (Örn: `miami`, `orlando`, `kadikoy`).
- **Dev / Production:** Vite ile build edilir (`vite.config.ts`), Laravel Blade view'ına (`resources/views/booking.blade.php`) gömülür veya bağımsız SPA olarak çalışır.

### 1.2. Müşteri Randevu Akışı (Step Flow & Dinamik Adımlar)
Adım sırası `useBookingFlow.ts` içinde `stepOrder` ile yönetilir:
1. **WELCOME (`FormStep.WELCOME`):** Müşteri karşılama ekranı. URL'de `?t={customer_uid}` varsa (`/api/customers/{uid}` üzerinden) müşterinin adı ve telefonu otomatik doldurulup ekranda kişiye özel gösterilir.
2. **PURPOSE (`FormStep.PURPOSE`):** Randevu türü seçimi (`tattoo`, `piercing`, `first` - ilk dövmem).
   - *Önemli Mantık:* Eğer `piercing` seçilirse `STORY`, `BODY_AREA` ve `SIZE` adımları otomatik atlanır.
   - Eğer `first` seçilirse `BODY_AREA` adımı atlanır.
3. **STYLE (`FormStep.STYLE`):** Backend `GET /api/booking/config/{slug}` servisinden gelen dinamik dövme stilleri (Realism, Minimal, Color, vb.) listelenir.
4. **STORY (`FormStep.STORY`):** Dövme fikri/hikayesi veya referans görsel yükleme. Görsel `POST /api/upload` endpoint'ine yüklenir (Cloudflare/Local storage URL'i döner).
5. **BODY_AREA (`FormStep.BODY_AREA`):** İnteraktif insan vücut haritası (`BodyMapZone.tsx` - Kol, Bacak, Sırt, Göğüs vb. çoklu seçim).
6. **SIZE (`FormStep.SIZE`):** Dövme boyutu seçimi (Küçük, Orta, Büyük, Full Sleeve).
7. **TIMING (`FormStep.TIMING`):** Takvim ve saat seçimi:
   - `GET /api/booking/availability/{slug}?month=YYYY-MM&timezone=...` çağrılarak stüdyonun o aydaki açık/kapalı günleri ve gün içindeki saat slotları listelenir.
   - İki saat öncesi kuralı: Aynı gün için rezervasyon yapılıyorsa en az 2 saat sonrasındaki slotlar seçilebilir.
   - Zaman dilimi desteği (`TimezoneSelect.tsx`): Kullanıcının yerel saati stüdyo saatine normalize edilir.
8. **CONTACT (`FormStep.CONTACT`):** Müşteri iletişim bilgileri:
   - `fullName`, `email`, `phone` (Uluslararası ülke kodu ve formatlama - `PhoneInputField.tsx`), `smsConsent` (SMS İzni checkbox), `timezone`.
   - *Dinamik Sıralama Parametresi:* URL'de `?x=` veya `?vip=` parametresi varsa CONTACT adımı en başa (1. adıma) çekilir (Lead yakalama optimizasyonu).
9. **ADDRESS (`FormStep.ADDRESS`):** Opsiyonel VIP transfer/Free Pick hizmeti açıksa adres bilgileri toplanır.
10. **SUCCESS (`FormStep.SUCCESS`):** Başarılı rezervasyon ekranı, randevu referans UUID'si ve ICS takvim dosyası indirme linki (`GET /api/booking/appointments/{uuid}/ics`).

### 1.3. Güvenlik, Bot Koruması ve Otomatik Lead Takibi (Session Drop-Off)
- **Cloudflare Turnstile:** `useTurnstile.ts` ile arka planda bot kontrolü yapılır, token alınır.
- **Physical Trust Signal (`_it`):** Kullanıcının gerçek fare/dokunma/klavye hareketleri `isTrusted` bayrağıyla toplanır (`window.navigator.webdriver` kontrolü dahil).
- **Adım Adım Terk Takibi (`useTracking.ts`):** Müşteri her adım değiştirdiğinde veya form alanını doldurduğunda `POST /api/booking/sessions` ve `PUT /api/booking/sessions/{uuid}/step` çağrılır. Müşteri formu bitirmeden çıkarsa bu bir "Abandoned Session" olur ve arka planda **Lead Recovery (Terk Kurtarma)** SMS mekanizması tetiklenir!

---

## BÖLÜM 2: React Projeyi Besleyen Backend API Servisleri

| Endpoint | HTTP Metodu | Controller | Ne İşe Yarar? / Hangi Veriyi Döner? |
| :--- | :--- | :--- | :--- |
| `/api/booking/config/{slug}` | `GET` | `BookingConfigController` | Lokasyon bilgileri (çalışma saatleri, adres, telefon, SMS/VIP ayarları), dinamik adım seçenekleri (`booking_step_options`), ve seçilen dildeki (`en`, `tr`, `es`) çeviriler (`booking_translations`). |
| `/api/booking/availability/{slug}` | `GET` | `BookingAvailabilityController` | İlgili lokasyonun Timely çalışma saatleri, mevcut randevuları ve randevu aralıklarına göre gün gün, saat saat boş/dolu slot listesi. |
| `/api/booking/appointments` | `POST` | `BookingAppointmentController` | Yeni randevu oluşturur. Çakışma kontrolü (collision detection), Turnstile doğrulaması, Müşteri kaydı oluşturma/güncelleme, Email bildirimi (`AppointmentNotification`) ve SMS Hatırlatıcı zamanlama işlemlerini tetikler. |
| `/api/booking/appointments/{uuid}/ics` | `GET` | `BookingAppointmentController@downloadIcs` | Randevu için `.ics` takvim dosyası üretir. |
| `/api/booking/sessions` | `POST` | `BookingSessionController@store` | Ziyaretçi randevu sihirbazına başladığında takip oturumu oluşturur (IP, UTM, kaynak bilgileriyle). |
| `/api/booking/sessions/{uuid}/step` | `PUT` | `BookingSessionController@updateStep` | Kullanıcı her adım geçişinde oturumdaki `step_data`, `current_step`, `drop_off_step`, `phone`, `email` alanlarını günceller. Telefon girildiği an terk SMS kurtarma zamanlayıcısını tetikler. |
| `/api/upload` | `POST` | `UploadController` | Müşterinin referans dövme görsellerini kabul eder (Max 10MB), storage'a yazar ve public URL döner. |
| `/api/customers/{uid}` | `GET` | `CustomerInfoController` | `uid` ile müşteri ad/soyad/telefon bilgilerini döner (Kişiselleştirilmiş karşılama için). |
| `/api/intake/customers` | `POST` | `CustomerIntakeController` | Stüdyoya gelen müşterilerin fiziksel/online form doldurması için intake endpoint'i. |

---

## BÖLÜM 3: Backend Core Servisleri (`app/Services`) ve İşlevleri

1. **`TwilioService.php`:**
   - Şube bazlı veya global Twilio kimlik bilgileri (`twilio_sid`, `twilio_auth_token`, `twilio_phone_number` / `twilio_from_number`) ile SMS gönderir.
   - Numara formatlama (E.164) ve sabit hat (landline) filtrelemesi yapar.
   - Karaliste / Unsubscribe kontrolü (`customer_unsubscribes`) yapar.
   - SMS gönderimlerini `sms_logs` tablosuna yazar, durumlarını günceller.
2. **`VonageService.php`:**
   - Vonage Business Communications (VBC) OAuth 2.0 API entegrasyonu.
   - Şube bazlı santralden yapılan gelen/giden çağrı kayıtlarını (`call_logs`), ses kayıtlarını (recordings) ve uzantıları (extensions) senkronize eder.
   - Müşteri telefon numaraları ile çağrı kayıtlarını eşleştirir (`linkAllUnmatchedCalls`), ses dosyasını güvenli stream eder.
3. **`SmsSchedulingService.php`:**
   - **Terk Kurtarma Zamanlayıcısı (`scheduleLeadRecovery`):** Formu terk eden kullanıcılara 5 dakika (`lead_recovery_5m`), 2 saat (`lead_recovery_2h`) ve 24 saat (`lead_recovery_24h`) sonra otomatik kurtarma SMS'i zamanlar.
   - **Randevu Hatırlatıcı Zamanlayıcısı (`scheduleAppointmentReminders`):** Randevu alan müşteriye randevudan 24 saat önce (`appointment_reminder_24h`) ve 3 saat önce (`appointment_reminder_3h`) otomatik hatırlatma SMS'i zamanlar.
   - Randevu tamamlandığında veya iptal edildiğinde bekleyen kuyrukları temizler (`cancelPendingSmsForSession`, `cancelPendingSmsForAppointment`).
4. **`AttributionResolver.php`:**
   - Gelen müşterilerin ve randevuların pazarlama kaynaklarını çözer (UTM Source, Medium, Campaign, GCLID, FBCLID, Referrer, Landing Page).
   - First-touch ve Last-touch attribution analizi sağlar.
5. **`DynamicMailService.php`:**
   - Şubelerin kendi özel SMTP ayarları (`timely_locations.mail_settings` - host, port, username, password, encryption) üzerinden dinamik e-posta gönderimi sağlar.
6. **`TurnstileService.php`:**
   - Cloudflare Turnstile token'larını Cloudflare Siteverify API üzerinden doğrular.
7. **`TimezoneService.php`:**
   - Kullanıcı, şube ve UTC arasındaki zaman dilimi dönüşümlerini ve normalizasyonunu yapar.
8. **`ReportCacheService.php`:**
   - Dashboard, Marketing ve Funnel raporlarının ağır SQL sorgularını Redis/File cache'de ısıtır (warm-up) ve hızlı yanıt verir.
9. **`CrmDataExportService.php`:**
   - Randevuları, filtrelenmiş temiz lead'leri ve pazarlama verilerini chunk'lar halinde CSV/Excel olarak dışa aktarır.

---

## BÖLÜM 4: Tüm Webhook'lar ve Çalışma Mekanizmaları

### 1. `POST /api/webhooks/twilio` (`TwilioWebhookController::__invoke`)
- **Amaç:** Müşteriden gelen yanıt SMS'lerini (Inbound SMS / MMS) karşılar.
- **İşleyiş:** 
  1. Gelen mesajın `From`, `To`, `Body`, `MessageSid` ve varsa MMS görsel URL'lerini alır.
  2. `ProcessTwilioWebhookUseCase` üzerinden müşteriyi telefon numarasından bulur.
  3. Mesaj "STOP", "UNSUBSCRIBE", "CANCEL" gibi kelimeler içeriyorsa `customer_unsubscribes` tablosuna ekler ve SMS iznini kapatır.
  4. Mesajı `customer_messages` ve `messages` tablolarına gelen mesaj (`direction: incoming`) olarak kaydeder. Admin paneldeki SMS Chat ekranına anlık düşer.

### 2. `POST /api/webhooks/twilio/status` (`TwilioWebhookController::handleStatus`)
- **Amaç:** Gönderilen SMS'lerin teslim durumunu (Delivery Status) takip eder.
- **İşleyiş:** Twilio'dan gelen `delivered`, `undelivered`, `failed`, `sent` durumlarını `sms_logs`, `customer_messages` ve `messages` tablolarındaki `message_sid` ile eşleştirip günceller. Hata varsa `error_message` alanına yazar.

### 3. `POST /api/webhooks/twilio/voice` (`TwilioWebhookController::handleVoice`)
- **Amaç:** Şubenin Twilio sanal numarasına gelen sesli aramaları karşılar.
- **İşleyiş:** Aranan `To` numarasının hangi `TimelyLocation` şubesine ait olduğunu bulur ve TwiML `<Dial>` komutu ile çağrıyı o şubenin gerçek fiziksel telefonuna (`timely_locations.phone`) yönlendirir (Call Forwarding).

---

## BÖLÜM 5: Tüm Artisan Command'ları ve Cron Görevleri (Kernel Schedule)

Projedeki `app/Console/Kernel.php` dosyasında tanımlı aktif Cron görevleri ve frekansları:

| Command Signature | Dosya | Zamanlama (Cron) | Ne İşe Yarar ve Nasıl Çalıştırılır? |
| :--- | :--- | :--- | :--- |
| `sms:process-scheduled` | `ProcessScheduledSms.php` | `everyMinute()` (Her dk) | `sms_logs` tablosundaki `scheduled` durumdaki SMS'leri (`lead_recovery`, `reminder`) tarar ve Twilio üzerinden gönderir. |
| `vonage:sync-calls` | `SyncVonageCalls.php` | `everyFiveMinutes()` (5 dk'da bir) | Vonage Business Cloud API'den canlı VoIP çağrı kayıtlarını çeker, müşteri numaralarıyla eşleştirir. |
| `vonage:sync-recordings --limit=50` | `SyncVonageRecordings.php` | `everyThirtyMinutes()` (30 dk'da bir) | Cevaplanan aramaların MP3 ses kayıtlarını Vonage sunucularından indirip yerel storage'a kaydeder. |
| `timely:sync` | `SyncTimelyData.php` | `twiceDaily(2, 14)` (Günde 2 kez) | Timely stüdyo, personel ve randevu verilerini senkronize eder. |
| `reports:send-daily-summary` | `SendDailyPerformanceReport.php` | `dailyAt('09:00')` (Her sabah 09:00) | Yöneticilere günlük stüdyo performans özet e-postasını gönderir. |
| `reports:warm-cache` | `WarmReportsCacheCommand.php` | `everyTenMinutes()` (10 dk'da bir) | Admin paneli raporlarının (marketing, funnel, timeline) SQL sorgu önbelleğini ısıtır. |
| `appointments:backfill-marketing` | `BackfillAppointmentMarketingData.php` | Manuel / İhtiyaç halinde | Geçmiş randevuların eksik UTM ve Click ID verilerini `booking_sessions` tablosundan toplu tamamlar. |
| `crm:v2-migrate-stream` | `CrmV2MigrateStreamCommand.php` | Manuel / Migration | Eski v1 tablosunu 5 adımda yeni V2 normalize mimariye (branches, contacts, tracking_sessions, appointments, comms) dönüştürür. |
| `phones:format` | `FormatPhonesCommand.php` | Manuel | Tüm veritabanındaki telefon numaralarını uluslararası E.164 formatına çevirir. |
| `sms:repair-conversations` | `RepairSmsConversationsCommand.php` | Manuel | Kopuk SMS chat mesajlarını müşterilerle yeniden bağlar. |

---

## BÖLÜM 6: Eski Veritabanı Şeması ve Yeni Veritabanı İçin Tablo Yapıları

Yeni panel için kullanılacak eski veritabanı tablolarının tam kolon ve ilişki haritası:

### 1. `timely_locations` (Şubeler / Branches)
- `id` (PK)
- `name`, `slug` (URL slug, örn: `miami`)
- `address`, `city`, `state`, `country`, `zip_code`
- `phone` (Fiziksel şube santral nosu), `email`
- `timezone` (Örn: `America/New_York`)
- `business_hours` (JSON: Pazartesi-Pazar açılış/kapanış saatleri)
- `booking_active` (boolean - Rezervasyona açık mı?)
- `appointment_interval` (integer - Randevu slot süresi dk: 30, 45, 60)
- `sms_enabled`, `twilio_sid`, `twilio_auth_token`, `twilio_phone_number`, `twilio_from_number`
- `mail_settings` (JSON: SMTP Host, Port, User, Password, Encryption)
- `social_links` (JSON: Instagram, Facebook, Google Maps)
- `gtm_id`, `gtm_country`, `gtm_city` (Pazarlama takip kodları)

---

## BÖLÜM 8: Özel Entegrasyonlar ve Gelişmiş İş Mantıkları

### 8.1. GetTimely Entegrasyonu (`gettimely/` & `SyncTimelyData.php`)
- **Amaç:** Randevu sistemi olarak GetTimely kullanan şubelerin randevu, personel (`timely_staff`) ve lokasyon verilerini senkronize eder.
- **Çalışma Şekli:**
  - `gettimely/timely_login.php`: Timely hesabı kullanıcı adı ve şifresi ile oturum açar, cookieleri `timely_cookies.txt` dosyasına yazar.
  - `SyncTimelyData.php`: Timely GraphQL/REST API veya SQLite önbelleği (`timely_data.sqlite`) üzerinden randevuları çekerek `timely_appointments`, `timely_staff` ve `timely_locations` tablolarına aktarır.

### 8.2. Vonage & Twilio Sesli Çağrı Mimarisi
- **Vonage VBC (Vonage Business Communications) Senkronizasyonu:**
  - `vonage:sync-calls` komutu 5 dakikada bir Vonage OAuth 2.0 API'sine bağlanır.
  - Şube dahili numaralarını (`extensions`), gelen/giden aramaları (`inbound`/`outbound`), arama sürelerini ve ses kayıtlarını (`recording_url`) `vonage_call_logs` tablosuna çeker.
  - Müşteri numarasını (`from_number` / `to_number`) `customers` tablosuyla eşleştirip çağrıyı lead profiline otomatik bağlar (`linkAllUnmatchedCalls`).
- **Twilio Voice Call Forwarding (Arama Aktarma):**
  - Müşteri şubenin Twilio numarasını aradığında `POST /api/webhooks/twilio/voice` tetiklenir.
  - Sistem Twilio numarasının ait olduğu `TimelyLocation` şubesini bulur ve TwiML `<Dial>` komutu ile çağrıyı şubenin gerçek fiziksel telefonuna (`timely_locations.phone`) yönlendirir.

### 8.3. Randevu Müsaitlik & Slot Hesaplama Algoritması (`BookingAvailabilityController`)
- **Çalışma Saatleri:** Şubenin `business_hours` alanındaki haftalık açılış/kapanış saatlerine ve `appointment_interval` (30/45/60 dk) değerine göre dinamik slot üretilir.
- **Dolu Slot Filtresi:**
  1. `timely_appointments` tablosundaki mevcut randevular UTC zaman dilimine çevrilerek çakışan slotlar `booked = true` yapılır.
  2. `booking_appointments` tablosundaki `pending` ve `confirmed` durumundaki randevular kontrol edilerek dolu olarak işaretlenir.
- **Zaman Dilimi (Timezone) Dönüşümü:** Kullanıcı hangi zaman diliminde olursa olsun (örn. `UTC+3`), şubenin yerel saati (`location.timezone`, örn. `America/New_York`) ile kullanıcının yerel saati arasında tampon (buffer) gün hesabı yapılarak doğru slotlar sunulur.
- **İki Saat Öncesi Kuralı (Today Restriction):** Aynı gün rezervasyonlarında şun anki saatten en az 2 saat sonrasındaki slotlar seçilebilir hale getirilir.

### 2. `customers` (Müşteriler / Leads)
- `id` (PK), `uid` (Unique hash)
- `first_name`, `last_name`, `full_name`
- `email`, `phone`, `formatted_phone` (E.164)
- `status` (`lead`, `contacted`, `converted`, `lost`, `spam`, `not_trusted`)
- `call_status` (`not_called`, `called_no_answer`, `called_answered`, `appointment_booked`)
- `is_trusted` (boolean - Bot/Spam filtresi)
- `unsubscribed_at` (timestamp)
- `booking_session_id` (FK -> `booking_sessions.id`)
- **Pazarlama / Reklam Kaynağı Alanları:**
  - `source_url` (Müşterinin stüdyoya ilk girdiği tam URL)
  - `referrer` / `referer` (Müşterinin geldiği dış site / in-app tarayıcı)
  - `utm_source` (Örn: `google`, `facebook`, `instagram`, `tiktok`, `email`)
  - `utm_medium` (Örn: `cpc`, `social`, `bio`, `story`, `banner`)
  - `utm_campaign` (Reklam kampanya adı)
  - `utm_term` (Anahtar kelime / Reklam hedeflemesi)
  - `utm_content` (Reklam görseli / metin varyasyonu)
  - `created_at`, `updated_at`

### 3. `booking_appointments` (Rezervasyon Randevu Talepleri)
- `id` (PK), `uuid` (Müşteri takip kodu)
- `timely_location_id` (FK -> `timely_locations.id`)
- `customer_id` (FK -> `customers.id`)
- `full_name`, `email`, `phone`, `formatted_phone`
- `purpose` (`tattoo`, `piercing`, `first`)
- `style` (Örn: `realism`, `minimal`, `color`, `blackwork`)
- `story_type` (`idea`, `meaningful`, `freehand`, `reference`)
- `story_description` (Müşteri notu / açıklaması)
- `reference_image` (Görsel URL)
- `body_areas` (JSON array: `["left_arm", "chest"]`)
- `size` (`small`, `medium`, `large`, `custom`)
- `preferred_date` (date), `preferred_time` (string: `14:00`)
- `user_timezone` (string), `location_preferred_time` (datetime)
- `status` (`pending`, `confirmed`, `rejected`, `cancelled`, `spam`, `not_trusted`, `unreachable`)
- `sms_consent` (boolean)
- `is_free_pick` (boolean), `address_street`, `address_city`, `address_state`, `address_zip`
- `ip_address`, `user_agent`, `turnstile_token`, `is_trusted`
- `session_uuid` (Bağlı form oturumu)
- **`marketing_fields` (Detaylı Pazarlama & Reklam JSON Kolonu):**
  - **Tıklama Kimlikleri (Click IDs):** `gclid`, `gbraid`, `wbraid` (Google iOS 14+), `fbclid` (Facebook/Meta), `ttclid` (TikTok), `msclkid` (Bing), `sc_clickid` (Snapchat), `twclid` (Twitter/X), `li_fat_id` (LinkedIn), `rdt_cid` (Reddit), `yclid` (Yandex), `epik` (Pinterest)
  - **Kampanya ve Reklam Grupları:** `campaign_id`, `adset_id` / `adgroup_id`, `ad_id` / `creative_id`
  - **Platform Parametreleri:** `gad_source`, `gad_campaignid`, `gad_creative`, `fb_source`, `fb_ref`, `fbadid`, `tt_source`, `igshid`
  - **Attribution Özeti:** `platform` (Çözümlenmiş kanal: `Google`, `Facebook`, `Instagram`, `TikTok`, `Direct`, vb.), `click_id`

### 4. `booking_sessions` (Form Adım Takibi & Terk Oturumu)
- `id` (PK), `session_uuid` (UUID)
- `location_slug` (string)
- `current_step` (string: `FormStep`), `drop_off_step` (string)
- `step_data` (JSON: Kullanıcının formda doldurduğu tüm geçici veriler)
- `ip_address`, `user_agent`, `landing_url`, `referrer_url`
- `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`
- **Tıklama Parametreleri:** `gclid`, `fbclid`, `ttclid`, `gbraid`, `wbraid`
- `is_converted` (boolean - Randevuya dönüştü mü?)
- `booking_appointment_id` (FK -> `booking_appointments.id`)
- `phone`, `email`, `full_name` (Adım esnasında yakalanan anlık iletişim)
- `created_at`, `updated_at`

### 5. `sms_logs` & `customer_messages` (SMS / MMS Logları)
- `id` (PK)
- `location_id` (FK -> `timely_locations.id`)
- `customer_id` (FK -> `customers.id`)
- `booking_session_id` (FK -> `booking_sessions.id`)
- `booking_appointment_id` (FK -> `booking_appointments.id`)
- `type` (`lead_recovery_5m`, `lead_recovery_2h`, `appointment_reminder_24h`, `custom_chat`, `bulk`)
- `direction` (`outgoing`, `incoming`)
- `recipient` / `to`, `from`
- `content` (Mesaj metni), `media_urls` (JSON MMS dosyaları)
- `payload` (JSON şablon değişkenleri)
- `status` (`scheduled`, `processing`, `sent`, `delivered`, `failed`, `cancelled`)
- `message_sid` (Twilio SID)
- `error_message` (Hata detayı)
- `scheduled_at`, `read_at`, `created_at`

### 6. `vonage_call_logs` (Sesli Çağrı & Santral Kayıtları)
- `id` (PK)
- `vonage_call_id` (string), `account_id` (string)
- `direction` (`inbound`, `outbound`)
- `from_number`, `to_number`, `extension`
- `start_time`, `end_time`, `duration` (saniye)
- `result` (`answered`, `missed`, `busy`, `rejected`, `failed`)
- `recording_url`, `recording_id`
- `customer_id` (FK -> `customers.id`), `appointment_id` (FK -> `booking_appointments.id`)

### 7. `booking_step_options` & `booking_translations` (Adım Seçenekleri ve Dinamik Çeviri Mimarisi)

#### A. `booking_step_options` (Adım Seçenekleri ve Şube Geçersiz Kılma - Override)
- **Veritabanı Alanları:** `id`, `timely_location_id` (nullable), `step_key` (`purpose`, `style`, `body_area`, `size`, `story`), `option_key`, `translations` (JSON), `description_translations` (JSON), `image_url`, `is_active` (boolean), `sort_order`.
- **Yönetim Paneli Endpoint'i:** `/admin/booking/options?step=style&location_id={location_id}` (`OptionController`)
- **Şube Override (Geçersiz Kılma) Mantığı:**
  1. `timely_location_id` `NULL` olan seçenekler **Global (Genel)** tüm şubelerde geçerli seçeneklerdir.
  2. Belirli bir şube (`location_id`) için aynı `option_key` ile yeni bir kayıt oluşturulduğunda, sistem o şube için **Global seçeneğin üzerini yazar (Override eder)**.
  3. Şube özelinde bir seçeneğin `is_active = false` yapılması durumunda, globalde aktif olsa bile o şubede **gizlenir/pasife alınır**.
  4. Stüdyolara özel görsel (`image_url`), sıralama (`sort_order`) veya özel başlık/açıklama dili tanımlanabilir.

#### B. `booking_translations` (Hiyerarşik Çeviri ve Şube Override Mimarisi)
- **Veritabanı Alanları:** `id`, `timely_location_id` (nullable), `namespace` (Örn: `ui.buttons`, `welcome`, `step.style.options`), `key`, `locale` (`en`, `tr`, `es`, `de`), `value` (Metin).
- **Yönetim Paneli Endpoint'i:** `/admin/booking/translations?namespace=ui.buttons&location_id={location_id}` (`TranslationController@index` & `@upsert`)
- **Çok Aşamalı Hiyerarşik Çeviri Çözümleme (`BookingTranslation::getForLocale`):**
  - **1. Katman (Global Fallback):** `timely_location_id IS NULL` ve `locale = 'en'` (İngilizce genel varsayılan metin).
  - **2. Katman (Global Target Locale):** `timely_location_id IS NULL` ve `locale = '{secilen_dil}'` (Genel hedef dil metni).
  - **3. Katman (Location Fallback):** `timely_location_id = {location_id}` ve `locale = 'en'` (Şubeye özel İngilizce metin).
  - **4. Katman (Location Target Locale - En Yüksek Öncelik):** `timely_location_id = {location_id}` ve `locale = '{secilen_dil}'` (Şubeye özel hedef dil metni).
- **Önbellek & Performans (Cache Flush):**
  - Çeviriler `booking_translations.{locale}.loc.{location_id}` anahtarıyla 5 dakika önbelleğe alınır.
  - Admin panelinden çeviri güncellendiğinde (`upsert`), hem seçilen dilin hem de İngilizce fallback'in önbelleği otomatik temizlenir (`flushCache`).

---

## BÖLÜM 7: Yeni Panel ve Yeni Veritabanı İçin Geçiş Stratejisi (Migration Roadmap)

Yeni panel mimarisinde yüksek performans ve kusursuz React entegrasyonu için:
1. **API Uyumluluğu:** Yeni backend'inizde yukarıdaki **Bölüm 2**'de belirtilen 5 temel API endpoint'inin (`config`, `availability`, `appointments`, `sessions`, `upload`) input/output JSON formatını birebir koruyun. Bu sayede `reactproje` frontend kodunda hiçbir şeyi bozmadan anında yeni backend'e bağlanabilir.
2. **Normalize İlişkiler (V2 Core):**
   - Müşteriyi (`customers / contacts`) tekilleştirin (E.164 `phone` ve `email` unique index).
   - `appointments` tablosunu `contact_id` ve `branch_id` ile bağlayın.
   - `conversations` ve `messages` tablosunu Twilio/SMS chat için tek bir kanalda birleştirin.
3. **Arka Plan İşleyicisi (Scheduler):**
   - Terk kurtarma (`lead_recovery_*`) ve randevu hatırlatıcı (`appointment_reminder_*`) için her dakika çalışan bir cron task (`ProcessScheduledSms`) kurun.
4. **Veri Aktarımı Sırası:**
   - 1. Şubeler (`timely_locations` -> `branches`)
   - 2. Müşteriler (`customers` -> `contacts`)
   - 3. Randevular (`booking_appointments` -> `appointments`)
   - 4. SMS Geçmişi (`sms_logs` / `customer_messages` -> `messages`)
   - 5. Çağrı Kayıtları (`vonage_call_logs` -> `call_logs`)
   - 6. Form Ayarları & Çeviriler (`booking_step_options`, `booking_translations`)
