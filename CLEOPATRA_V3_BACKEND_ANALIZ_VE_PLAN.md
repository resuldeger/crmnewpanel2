# Cleopatra v3 — Sistem Analizi & Backend Planı

> Kaynak: repo kodu + `CLEOPATRA_CRM_MASTER_BLUEPRINT.md` + `CLEOPATRA_AI_MASTER_KNOWLEDGE_BASE.md` + `AI_CONTEXT.md`
> + **canlı `https://booknow.cleopatraink.com` üzerinde doğrulanmış API çağrıları** (2026-09-22).
> Bu dosya "ne var / ne eksik / ne yapacağız"ın tek referansı.

---

## 1. SİSTEMİN ÜÇ PARÇASI

| # | Parça | Nerede | Durum |
|---|---|---|---|
| A | **Booking SPA** (müşteriye bakan randevu sihirbazı) | canlı: `booknow.cleopatraink.com/{slug}/book` · repo: `silinecek/reactproje/` | **Canlıda çalışıyor**, Laravel backend'e bağlı |
| B | **CRM Console** (operasyon paneli) | repo: `src/` (Next.js 14 app router, `feature/nextjs-migration`) | **%100 mock**, backend bağlantısı YOK |
| C | **Legacy Laravel backend** | repoda yok, sadece dokümante edilmiş | Canlı, A'yı besliyor; B'nin hedefi bu veriyi devralmak |

Yapılacak iş: **C'yi yeniden yazıp A + B'yi tek backend'e bağlamak** — ve tamamen çok dilli, veritabanı-sürümlü (DB-driven) hale getirmek.

---

## 2. CANLI API SÖZLEŞMESİ (doğrulandı)

Booking SPA bundle'ında **tam olarak 8 endpoint** var (`/booking/assets/index-*.js` içinden çıkarıldı):

| Endpoint | Method | Doğrulanmış davranış |
|---|---|---|
| `/api/booking/config/{slug}?lang=` | GET | location + locale + **translations** (namespace'li) + **steps** (purpose/style/size/story, `image_url` + `sort_order` ile) |
| `/api/booking/availability/{slug}?month=YYYY-MM&timezone=` | GET | `{location_id, month, timezone, availability: {"2026-09-22": {available, slots:[{time,booked}]}}}` |
| `/api/booking/sessions` | POST | → `{status:"success", session_uuid}` — sayfa açılır açılmaz, UTM/click-id payload'ıyla |
| `/api/booking/sessions/{uuid}/step` | PUT | her adım geçişinde anında; aynı adımda form değişince **1sn debounce** ile |
| `/api/booking/appointments` | POST | final submit → `{booking_uuid}` |
| `/api/booking/appointments/{uuid}/ics` | GET | takvim dosyası |
| `/api/customers/{uid}` | GET | `?t={uid}` ile kişiselleştirilmiş karşılama (ad + telefon önden dolu) |
| `/api/upload` | POST | referans görsel (max 10MB, jpeg/png/gif/webp/heic) |

**Kural:** Yeni backend bu 8 endpoint'in **input/output JSON'unu birebir korumalı.** O zaman booking SPA'da tek satır değişmeden yeni backend'e geçer.

### 2.1 Canlı config örneği (tacoma)
```jsonc
{
  "location": { "id": 29, "slug": "tacoma", "name": "Tacoma", "address": "...", "timezone": "America/New_York", "meta": null },
  "locale": "en",
  "translations": {
    "ui.buttons": { "continue": "Continue →", "submit": "Finalize My Booking", "reschedule_button": "RESCHEDULE", ... },
    "welcome": {...}, "ui.labels": {...}, "ui.placeholders": {...},
    "step.purpose": {...}, "step.style": {...}, "step.story": {...},
    "step.body_area": {...}, "body.areas": {...}, "step.size": {...},
    "step.calendar": {...}, "step.contact": {...}, "ui.contact": {...},
    "ui.messages": {...}, "ui.validation": {...},
    "calendar.days": {...}, "calendar.ics": {...},
    "tz.groups": {...}, "tz.labels": {...}, "step.address": {...}
  },
  "steps": {
    "purpose": [{ "key":"new","label":"NEW TATTOO","description":null,"image_url":null,"sort_order":1 }, ...],
    "style":   [{ "key":"realism","label":"Realism","image_url":"https://.../gercekci.jpg","sort_order":1 }, ...],
    "size":    [...], "story": [...]
  }
}
```
→ **21 namespace**. Her şey DB'den geliyor: buton metni, hata mesajı, timezone etiketi, body-area adları, adım seçenekleri, seçenek görselleri, sıralama.

### 2.2 Canlı dil durumu
`lang=` ile denendi: **`en`, `tr`, `es`, `de` gerçek çeviri döndürüyor.**
`fr/it/nl/ru/ar/pl/pt` → HTTP 200 + `locale:"en"` + İngilizce içerik (sessiz fallback, uyarı yok).

Çeviri çözümleme (dokümante edilmiş 4 katman, en yükseği kazanır):
```
1. location_id IS NULL + locale='en'      (global fallback)
2. location_id IS NULL + locale=hedef     (global hedef dil)
3. location_id = X     + locale='en'      (şube İngilizce)
4. location_id = X     + locale=hedef     (şube hedef dil)  ← en yüksek öncelik
```
Cache anahtarı: `booking_translations.{locale}.loc.{location_id}`, 5 dk TTL, admin upsert'te flush.

---

## 3. REKLAM TRAFİĞİ → "ÖNCE İLETİŞİM" MEKANİZMASI (doğrulandı)

Canlıda `window.__BOOKING_CONFIG__` (Blade tarafından enjekte ediliyor):
```json
{
  "contactStepOverride": {
    "targetStepIndex": 1,
    "triggerParams": ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","page_form"]
  },
  "turnstileSiteKey": "0x4AAAAAAEhUrI6M30CEsMGp"
}
```
**Doğrulama:** `/tacoma/book?utm_source=google&utm_medium=cpc&...` ile girildiğinde "Start Journey"den sonra ilk ekran **doğrudan "Your Contact Info"** (Ad Soyad / E-posta / Telefon / SMS izni). Yani reklamdan gelen ziyaretçiden **daha stil/beden/tarih sorulmadan önce** lead bilgisi alınıyor. İstenen davranış zaten canlıda var — yeni backend'de korunacak ve **API config'e taşınacak** (§6, bulgu #6).

Ek tetikleyiciler (`useBookingFlow.ts`):
- `?free_pick` ya da `utm_source` içinde `free_pick` → CONTACT sonrası **ADDRESS (VIP Pickup)** adımı eklenir
- `purpose=piercing` → STORY + BODY_AREA + SIZE adımları atlanır
- `purpose=first` → BODY_AREA atlanır
- `?t={customer_uid}` → `/api/customers/{uid}` ile isim/telefon önden doldurulur

---

## 4. YARIDA KALAN İSTEKLER (ABANDONED / DROP-OFF)

Akış:
```
sayfa açılır ──► POST /api/booking/sessions
                 payload: location_slug, utm_source/medium/campaign/term/content/id,
                          gclid|gbraid|wbraid|dclid, fbclid, msclkid, ttclid, sccid, epik, twclid,
                          landing_url, initial_step, extra_data(tüm query string JSON)
                 ◄── { session_uuid }

her adım geçişi ──► PUT /api/booking/sessions/{uuid}/step   (anında)
aynı adımda yazarken ──► aynı PUT  (1000ms debounce)
                 payload: step, location_slug, landing_url, form_data(TÜM form), _it(trust)

telefon girildiği AN ──► SmsSchedulingService.scheduleLeadRecovery()
                          · lead_recovery_5m   (+5 dk)
                          · lead_recovery_2h   (+2 sa)
                          · lead_recovery_24h  (+24 sa)

randevu tamamlanırsa ──► cancelPendingSmsForSession()  → bekleyen kurtarma SMS'leri iptal
```
Bot/spam sinyalleri: **Cloudflare Turnstile** token + `_it` (physical trust: `isTrusted` event bayrağı + `navigator.webdriver` kontrolü).

Cron: `sms:process-scheduled` **her dakika** → `scheduled` durumdaki SMS'leri Twilio'ya basar.

---

## 5. CRM CONSOLE — MEVCUT DURUM

- Next.js 14 app router; `src/app/page.tsx` + `[...slug]/page.tsx` → `dynamic(() => import("../App"), { ssr: false })`. Yani **tüm uygulama client-side**, SSR yok.
- **`src/store.tsx` tek veri kapısı** (783 satır). Tüm mutasyonlar buradan geçiyor → Supabase/API'ye geçişte **değişecek tek dosya**.
- `@supabase/supabase-js` package.json'da **kurulu ama hiç kullanılmıyor**.
- RBAC hazır: **6 rol × 18 izin**, `DEFAULT_MATRIX`, 3 katmanlı enforcement (sidebar filtresi + `ROUTE_PERM` + buton `locked`).
- i18n: **sadece EN/TR**, `t("English string")` gettext tarzı. Kaynak zinciri `GET /api/v1/locales/tr.json` → localStorage cache → gömülü `TR_SNAPSHOT`. `Lang = "en" | "tr"` hardcoded.
- `backend/schema.sql`: 25 tablo, RLS, `convert_lead()` / `merge_leads()` RPC'leri, seed'li. Sadece **CRM tarafını** kapsıyor.

---

## 6. BULGULAR — ŞU AN EKSİK/HATALI OLANLAR

| # | Bulgu | Etki |
|---|---|---|
| 1 | **`backend/schema.sql` booking funnel'ı hiç kapsamıyor.** Yok: `booking_sessions`, `booking_step_options`, `booking_translations`, zamanlanmış SMS (`scheduled_at`+`type`), upload/asset tablosu, müsaitlik kaynağı (blocked slots / harici randevular) | Yarıda kalan istekler, çok dillilik ve adım seçenekleri backend'siz kalır — projenin ana hedefi |
| 2 | **İki ayrı i18n mimarisi.** Booking: DB, namespace'li, şube override'lı, 4 dil. CRM: flat `(locale,key,value)` tablo + hardcoded EN/TR | Tek sözlük servisi olmalı; CRM `Lang` tipi `en/tr/es/de` (+genişleyebilir) olmalı |
| 3 | **`sms_messages` tablosunda `scheduled_at` ve `type` yok** | `lead_recovery_5m/2h/24h` ve `appointment_reminder_24h/3h` kuyruğunun yeri yok |
| 4 | **`appointments` UTC instant saklamıyor** — `preferred_date date` + `preferred_time time`, `user_timezone` kolonu hiç yok | Çakışma kontrolü, hatırlatıcı zamanlaması ve takvim yanlış hesaplanır. `starts_at timestamptz` + `display_timezone` gerekli |
| 5 | **Canlı veri hatası: Tacoma `location.timezone = "America/New_York"`** (olması gereken `America/Los_Angeles`) | Slot üretimi 3 saat kayık. Tüm 45 şubenin tz'i denetlenmeli |
| 6 | **`contactStepOverride` API'de değil, Blade'den enjekte ediliyor** (`window.__BOOKING_CONFIG__`) | Headless/standalone SPA'da reklam→contact-first davranışı kaybolur. `/api/booking/config/{slug}` payload'ına taşınmalı |
| 7 | **Desteklenmeyen dil sessizce EN'e düşüyor** (HTTP 200, `locale:"en"`, `Content-Language` yok) | İstemci hangi dilin gerçekten servis edildiğini bilemez; `supported_locales[]` + doğru `Content-Language` dönmeli |
| 8 | **`PUT /sessions/{uuid}/step` her seferinde TÜM `form_data`'yı gönderiyor** (1sn debounce'la) | İsim/e-posta/telefon her tuş kümesinde sunucuya gidiyor. Alan whitelist'i + rate limit + PII saklama politikası gerekli |
| 9 | **`turnstile_token` ve `_it` trust sinyalinin şemada yeri yok** | Spam/not_trusted kararı denetlenemez |
| 10 | **ID uyumsuzluğu:** yeni `leads.id text` (`LEAD-1042`) vs legacy `customers.id CHAR(36)` UUID | Migrasyonda kimlik eşleme tablosu şart |
| 11 | **Manage/Reschedule/Cancel çevirileri var ama SPA'da o ekran yok** (`reschedule_button`, `cancel_confirm`, `manage_booking`…) | Yarım kalmış özellik — backend'de endpoint, SPA'da rota gerekli |
| 12 | **CRM'de hiçbir API katmanı yok** — 25 tablo + RLS tasarlanmış ama kod yazılmamış | Backend'in kendisi bu |

---

## 7. BACKEND PLANI

### 7.1 Şemaya eklenecek tablolar (booking domain)

```
booking_sessions          -- yarıda kalan istekler / drop-off
  id, session_uuid uuid unique, location_id, locale,
  current_step, drop_off_step, max_step_reached, is_completed,
  step_data jsonb, full_name, email, phone_e164,          -- adım esnasında yakalanan
  landing_url, referrer, ip, user_agent, device_type, browser, os,
  utm jsonb, click_ids jsonb, extra_params jsonb,
  turnstile_passed bool, is_trusted bool,
  appointment_id, converted_at, created_at, updated_at, last_seen_at

booking_step_options      -- adım seçenekleri + şube override
  id, location_id NULL=global, step_key, option_key,
  label_translations jsonb, description_translations jsonb,
  image_url, is_active, sort_order
  UNIQUE (coalesce(location_id,0), step_key, option_key)

booking_translations      -- 4 katmanlı hiyerarşik çeviri
  id, location_id NULL=global, namespace, key, locale, value
  UNIQUE (coalesce(location_id,0), namespace, key, locale)

locales                   -- desteklenen dil kaydı
  code, name, native_name, is_active, is_default, fallback_code

scheduled_messages        -- lead recovery + hatırlatıcılar (sms_messages'ı genişlet ya da ayır)
  id, type, channel(sms|email|whatsapp), session_id, appointment_id, lead_id,
  location_id, to_e164, template_key, payload jsonb,
  status(scheduled|processing|sent|delivered|failed|cancelled),
  scheduled_at, sent_at, provider_sid, error

availability_blocks       -- müsaitlik kaynağı (Timely/harici + manuel kapatma)
  id, location_id, artist_id NULL, starts_at timestamptz, ends_at timestamptz,
  source(timely|manual|appointment), external_id

uploads                   -- referans görseller
  id, session_id, appointment_id, url, mime, bytes, checksum, created_at
```

### 7.2 `appointments` düzeltmeleri
```
+ starts_at         timestamptz   -- UTC instant (tek doğruluk kaynağı)
+ display_timezone  text          -- müşterinin gördüğü tz
+ user_timezone     text          -- gönderim anındaki tarayıcı tz'i
+ session_id        bigint        -- booking_sessions'a bağ
+ locale            text
+ turnstile_passed  bool
+ is_trusted        bool
+ address_* / is_free_pick        -- VIP pickup
```
`preferred_date`/`preferred_time` **görüntüleme** için kalır; çakışma/hatırlatıcı hesabı `starts_at` üzerinden.

### 7.3 Endpoint yüzeyi

**Public (booking SPA — sözleşme birebir korunur):**
`GET /api/booking/config/{slug}` · `GET /api/booking/availability/{slug}` ·
`POST /api/booking/sessions` · `PUT /api/booking/sessions/{uuid}/step` ·
`POST /api/booking/appointments` · `GET /api/booking/appointments/{uuid}/ics` ·
`GET /api/customers/{uid}` · `POST /api/upload`
**+ yeni:** `GET/PATCH/DELETE /api/booking/appointments/{uuid}` (manage / reschedule / cancel — bulgu #11)

**Admin (CRM console):** leads, appointments, calls, sms, campaigns, tasks, notes, locations, artists, staff, reports, translations, step-options, audit — RLS + `can()`/`in_scope()` ile.

**Webhooks:** `twilio/inbound` · `twilio/status` · `twilio/voice` · `vonage/event` · `vonage/recording` · `meta/lead` · `timely/event` — hepsi imza doğrulamalı, `webhook_deliveries` ile idempotent.

**Workers (cron):**
| İş | Frekans |
|---|---|
| `process-scheduled-messages` (lead recovery + hatırlatıcı) | 1 dk |
| `campaign-dispatcher` (≤1 msg/s/şube) | 1 dk |
| `sla-monitor` (not_called > 15 dk → görev + eskalasyon) | 5 dk |
| `vonage-sync-calls` | 5 dk |
| `vonage-sync-recordings` | 30 dk |
| `availability-sync` (Timely) | 2×/gün |
| `duplicate-detector` | gecelik |
| `winback` (cancelled +30g) | günlük |
| `daily-digest` (şube tz'inde 08:00) | günlük |
| `reports-warm-cache` | 10 dk |

### 7.4 Çok dillilik — hedef mimari
- Tek `booking_translations` + `locales` tablosu; **hem booking SPA hem CRM console** aynı servisten beslenir.
- Çözümleme: 4 katman (global-en → global-locale → location-en → location-locale).
- `GET /api/booking/config/{slug}?lang=xx` → `supported_locales[]`, gerçek `locale`, `fallback_used: true|false`, `Content-Language` header (bulgu #7).
- CRM `Lang` tipi `en|tr|es|de` + admin panelden dil ekleme (`locales.is_active`).
- Admin'de çeviri editörü: namespace × key × locale grid, şube override, kayıtta cache flush.

### 7.5 Fazlar
| Faz | Kapsam |
|---|---|
| **F0** | Stack + DB kararı, şema v3 (booking tabloları + appointments düzeltmeleri), lokal ortam |
| **F1** | Public booking API (8 endpoint, sözleşme birebir) + `booking_sessions` yazımı + Turnstile/trust |
| **F2** | Çok dillilik: `locales` + `booking_translations` + hiyerarşik çözümleyici + cache + `supported_locales` |
| **F3** | Yarıda kalan istekler: scheduled_messages + her-dakika worker + lead recovery 5m/2h/24h + iptal kuralları |
| **F4** | CRM API + RLS; `src/store.tsx`'i mock'tan gerçek API'ye çevir (tek dosya) |
| **F5** | Twilio/Vonage webhook + SMS chat + çağrı merkezi + kayıt stream |
| **F6** | Legacy migrasyon: şubeler → müşteriler → randevular → SMS → çağrılar → çeviriler/seçenekler (ID eşleme tablosuyla) |
| **F7** | Manage/reschedule/cancel ekranı, raporlar 2.0 (gelir/kapora, ROI, cohort, sanatçı utilizasyonu), WhatsApp kanalı |

---

## 8. KARAR BEKLEYEN KONULAR

1. **Stack:** (a) Next.js Route Handlers + Supabase Postgres (repoda `@supabase/supabase-js` zaten kurulu, `backend/schema.sql` Supabase'e göre yazılmış) · (b) ayrı NestJS/Fastify + Postgres · (c) Laravel'i modernize edip devam.
2. **Veritabanı:** yeni greenfield Postgres mi, legacy MySQL'den migrasyon mu? Migrasyon ise legacy DB dump/erişimi gerekli.
3. **Dil seti:** canlıda `en/tr/es/de`. Hedef bu 4'ü mü, yoksa daha fazlası mı (fr/it/nl/ru/ar…)?
4. **Müsaitlik kaynağı:** Timely entegrasyonu kalacak mı, yoksa slotlar tamamen yeni sistemde mi yönetilecek?
5. **Booking SPA'nın yeri:** `silinecek/reactproje` bu repoya taşınıp Next içinde mi build edilecek, ayrı Vite app olarak mı kalacak?

---

## 9. KARARLAR (onaylandı) & GENİŞLETİLMİŞ KAPSAM

**Verilen kararlar:**
- Stack: **Next.js Route Handlers + kendi sunucunda PostgreSQL 16 + Drizzle + Auth.js + pg-boss** (Supabase yok — veri bizde)
- Veritabanı: **sıfırdan greenfield**, legacy migrasyonu en sona (F6)
- Diller: **en / tr / es / de**, admin panelden genişletilebilir
- Müsaitlik: **hibrit** — Timely'den oku, yeni randevuları bizde yaz

**Sonradan eklenen gereksinimler:**
1. **Operatör hesap verebilirliği** — hangi editör hangi randevuya ne yaptı, hangi aramayı yaptı. → `activity_log` (append-only, trigger korumalı) + `leads/appointments/calls/sms_messages` üzerinde `*_staff_id` kolonları.
2. **Raporlama birinci sınıf** — ham tablolar yerine önceden toplanmış rollup tabloları: `staff_daily_stats`, `location_daily_stats`, `funnel_daily_stats`, `attribution_daily_stats`, `demand_heatmap`.
3. **WebSocket** — ayrı Socket.IO process'i. Fan-out `realtime_events` tablosu + Postgres `NOTIFY` (Redis yok). İzin bazlı kanal filtreleme (`required_permission`), `staff_presence` ile canlı ajan listesi.
4. **Rol bazlı ekranlar** — admin vs çalışan görünümleri ayrıştırılacak.
5. **Mobil kullanılabilirlik** — tablolar kart görünümüne, sidebar ikon rayına.

---

## 10. F0 — TAMAMLANDI (doğrulanmış)

| Teslim | Durum |
|---|---|
| Drizzle şema v3 — **45 tablo, 20 enum** | ✅ `src/db/schema/` (8 dosya) |
| Migration'lar (3) gerçek Postgres 16'ya uygulandı | ✅ `drizzle/0000..0002` |
| Trigger'lar: `updated_at`, append-only audit, realtime NOTIFY, randevu→slot senkronu, global opt-out kaskadı | ✅ smoke test geçti |
| NULL-güvenli unique index'ler (Postgres'te NULL'lar farklı sayılır → dedupe kaçağı) | ✅ 4 index düzeltildi |
| Docker Compose Postgres 16 (port **5433**, 5432'de başka proje var) | ✅ çalışıyor |
| Canlıdan seed çekici | ✅ `scripts/fetch-live-seed.ts` |
| Seed: 6 rol · 20 izin · 87 grant · 4 dil · **568 çeviri** · 20 namespace · 16 adım seçeneği · **46 stüdyo** · 10 demo hesap | ✅ `npm run db:seed` |
| **Timezone düzeltmesi: 46 stüdyonun 21'i yanlış** | ✅ `scripts/timezones.ts` |
| 4 katmanlı çeviri çözümlemesi | ✅ SQL ile doğrulandı |
| `tsc --noEmit` | ✅ 0 hata |

### Üretimdeki timezone hatası — tam liste
Canlıda **46 stüdyonun tamamı** `America/New_York` kayıtlı. Gerçekte 21'i farklı:

| Doğru zaman dilimi | Stüdyolar |
|---|---|
| `America/Los_Angeles` | seattle, tacoma, lynnwood, vancouver, spokane, las-vegas, orange-county, riverside, santa-barbara, san-francisco |
| `America/Chicago` | madison, new-orleans, oklahoma-city, destin, panama |
| `America/Phoenix` | chandler, tucson |
| `America/Denver` | denver |
| `America/Indiana/Indianapolis` | indianapolis |
| `America/Detroit` | detroit |
| `America/Kentucky/Louisville` | louisville |

Etki: bu stüdyolarda müşteriye gösterilen slot saatleri **1–3 saat kayık**. "2 saat önceden" kuralı ve hatırlatıcı zamanlaması da aynı oranda yanlış. San Francisco adresinde eyalet kodu olmadığı için otomatik tespitten de kaçıyordu — elle override eklendi.

### Geliştirme komutları
```
npm run db:up        # Postgres 16 (localhost:5433)
npm run db:migrate   # migration'ları uygula
npm run db:seed      # gerçek stüdyo + çeviri verisiyle doldur
npm run db:studio    # Drizzle Studio
npm run db:psql      # psql kabuğu
npx tsx scripts/fetch-live-seed.ts   # canlıdan seed'i tazele
```

---

## 11. LEAD → RANDEVU YAŞAM DÖNGÜSÜ (veritabanına gömüldü, test edildi)

Kural tek yerde tanımlı ve veritabanı tarafından zorlanıyor (`drizzle/0004_lead_lifecycle_rules.sql`):

```
1. Ziyaretçi formu açar
     → booking_sessions satırı.  LEAD DEĞİL. Kimse aramaz.

2. İsim / e-posta / telefon bırakır, BİTİRMEZ
     → capture_lead()  →  customer + LEAD
        source = 'abandoned_form', call_status = 'not_called'
     → çağrı merkezi hattına düşer, SLA saati başlar
     → lead_recovery SMS'leri (5dk / 2sa / 24sa) kuyruğa girer

3. Formu BİTİRİR
     → appointments satırı  →  trigger otomatik:
          lead.converted_at        = now()   → LEAD HATTAN ÇIKAR
          lead.call_status         = 'appointment_made'
          lead.lifecycle_status    = 'done'
          session.is_completed     = true
          bekleyen kurtarma SMS'leri → cancelled ('booked')
          randevu kendi slotunu bloklar

4. Tek oturumda hiç terk etmeden randevu alan
     → hattan hiç geçmez, ama lead satırı yine açılır
       (source = 'completed_form', zaten converted)
       → huni ve attribution raporları eksik kalmasın diye
```

**Lead satırı asla silinmez.** Hattın tek ölçütü `converted_at IS NULL`.
Çağrı merkezi ekranı `lead_pipeline` view'ını okur — dönüşmüş lead'i yanlışlıkla gösteremez.

### Doğrulanmış senaryolar
| Senaryo | Sonuç |
|---|---|
| Reklamdan geldi, iletişim bıraktı, terk etti | `LEAD-1002` · `abandoned_form` · `not_called` · hatta ✅ · gclid/kampanya korundu |
| Aynı oturum tekrar adım gönderdi | Aynı lead döndü, **kopya açılmadı** ✅ |
| Geri döndü, randevuyu tamamladı | `appointment_made` · `done` · hattan çıktı · 3 kurtarma SMS'i `cancelled/booked` · slot bloklandı ✅ |
| Tek oturumda randevu aldı | `LEAD-1003` · `completed_form` · zaten converted · hatta hiç görünmedi ✅ |
| E-posta bıraktı ama **telefon yok** | `LEAD-1004` · `call_status = no_pn` (aranamaz) ✅ |
| Hiç iletişim bırakmadan terk etti | **Lead açılmadı** ✅ |

---

## 12. LOKAL SERVİSLER

| Servis | Adres | Giriş |
|---|---|---|
| PostgreSQL 16 | `localhost:5433` | `cleo` / `cleo` / db `cleopatra` |
| **Adminer** (phpMyAdmin muadili) | http://localhost:8081 | sistem `PostgreSQL`, sunucu `postgres`, `cleo`/`cleo`, db `cleopatra` |
| Redis 7 | `localhost:6380` | — |
| **RedisInsight** | http://localhost:5540 | ekle: host `redis`, port `6379` |

Port notu: 5432 ve 6379'da başka projen (`grinder`) olduğu için 5433/6380 kullanıldı.

`npm run db:up` hepsini ayağa kaldırır.

---

## 13. F1 — REZERVASYON MOTORU `apps/booking/` (tamamlandı)

`silinecek/reactproje/` → **`apps/booking/`** kopyalandı ve yeniden yapılandırıldı.
Her şey **sadece localhost** üzerinde çalışır; canlı sisteme hiçbir istek gitmez.

### 13.1 Tasarım tek yere toplandı
Aynı CSS **üç yerde** birden duruyordu ve birbirinden ayrışmıştı:
Laravel Blade `<style>`, `index.html <style>`, `App.tsx` içindeki inline `<style>`.
Hepsi tek dosyada birleşti: **`src/styles/theme.css`**
(marka token'ları, scrollbar, dark autofill, focus halkası, animasyonlar, reduced-motion, 44px dokunma hedefleri).

Laravel'de kalan parçalar React bileşenine dönüştü:
| Blade'deydi | Artık |
|---|---|
| Hamburger menü (ham HTML + DOM script) | `src/shell/SiteMenu.tsx` — ESC ile kapanır, scroll kilidi, a11y |
| Stüdyo seçme sayfası | `src/screens/StudioPicker.tsx` — arama + boş durum + iskelet yükleme |
| Fontlar, body bg, GTM, LiveChat, Turnstile script | `theme.css` + `src/lib/analytics.ts` (env ile, id yoksa hiç yüklenmez) |
| `window.__BOOKING_LOCATION__` / `__BOOKING_CONFIG__` | `/api/booking/config/{slug}` yanıtı |

### 13.2 Rotalama (yeni)
Adım yalnızca React state'indeydi: adres çubuğu hiç değişmiyordu, **tarayıcı geri tuşu siteden çıkarıyordu**, yenileme ilk adıma atıyordu, onay ekranının adresi yoktu.

| Rota | Ekran |
|---|---|
| `/` | Stüdyo seçimi |
| `/:slug/book` | Sihirbaz — karşılama |
| `/:slug/book/:step` | `purpose · style · story · placement · size · when · contact · pickup` |
| `/:slug/book/done/:uuid` | Onay — **yenilemeye dayanıklı, paylaşılabilir** |
| `/b/:uuid` | Randevu yönet / ertele / iptal |
| `*` | 404 |

Geri/ileri ve derin link doğrulandı.

### 13.3 Düzeltilen görünür/yazılımsal hatalar
| # | Sorun | Düzeltme |
|---|---|---|
| 1 | `cdn.tailwindcss.com` (dev aracı, ~400KB JIT, render engelliyor, konsol uyarısı) | Gerçek Tailwind v4 build |
| 2 | `index.html`'de esm.sh importmap + package.json'da React → **iki React kaynağı** | Importmap silindi |
| 3 | Dil seçici `en/tr/es` sabit → **Almanca erişilemiyordu** | `/api/booking/locales` + `supportedLocales` |
| 4 | Desteklenmeyen dil sessizce EN dönüyordu | `fallbackUsed` + `Content-Language` header |
| 5 | "Welcome to Cleopatra Ink **Cleopatra Ink** Tacoma" | API `shortName` yayınlıyor |
| 6 | "SONRAKI ADIM **→ →**" (çeviride zaten ok var) | Ok varsa ikincisi eklenmiyor |
| 7 | Turnstile script yalnızca Blade'de → SPA'da hiç yüklenmiyordu | Hook lazy yüklüyor |
| 8 | **Turnstile production site key kaynak koda gömülüydü** | API'den geliyor, yoksa challenge kapalı |
| 9 | Her tuş vuruşunda **tüm form** (ad/mail/telefon) sunucuya | Alan whitelist'i + rate limit |
| 10 | `user-scalable=no` — pinch zoom engelli (WCAG 1.4.4) | Kaldırıldı |
| 11 | Piercing kategorileri koda gömülü liste | `skips_steps` DB'den |
| 12 | "2 saat" ve "14 gün" kuralları koda gömülü | Şube ayarından |
| 13 | Kullanılmayan zod şeması 72KB bundle'a giriyordu | Düz kontrollerle değişti → **3.85KB** |
| 14 | `SignaturePad`, `HEALTH_OPTIONS`, `LEGAL_TEXT`, `GEMINI_API_KEY`, kamera izni | Silindi (AI Studio iskelet artığı) |
| 15 | `/b/{uuid}` linki onay ekranında vardı ama **sayfa yoktu** | `ManageBooking` ekranı |
| 16 | Config/availability tarayıcıda 60sn cache → admin değişikliği geç görünüyor, bayat slot 409 üretiyor | `no-store`, yük Redis'te |

### 13.4 Backend uçları (Next Route Handlers → kendi Postgres'imiz)
`GET /api/booking/locations` · `GET /api/booking/locales` · `GET /api/booking/config/{slug}` ·
`GET /api/booking/availability/{slug}` · `POST /api/booking/sessions` ·
`PUT /api/booking/sessions/{uuid}/step` · `POST /api/booking/appointments` ·
`GET|PATCH|DELETE /api/booking/appointments/{uuid}`

**Doğrulanan uçtan uca akış** (lokal):
```
POST /sessions            → session_uuid, platform=google, device=mobile/Instagram In-App/iOS
PUT  /sessions/{u}/step   → LEAD-1000 (abandoned_form, not_called, gclid korundu)
PUT  (tekrar)             → LEAD-1000 (kopya YOK)
POST /appointments        → BK-…  lead: appointment_made/done, pipeline: 0
                            starts_at = 2026-09-25 21:00 UTC  (14:00 Pacific ✓)
aynı slot tekrar          → 409 "That slot was just taken"
availability              → 14:00 booked:true
consent yok               → 422 · geçmiş tarih → 409
```
Eski hatalı `America/New_York` ile bu randevu 18:00 UTC kaydedilirdi — müşteri **3 saat erken** gelirdi.

### 13.5 Çalıştırma
```
npm run db:up                      # postgres :5433 · redis :6380 · adminer :8081 · redisinsight :5540
npm run dev                        # CRM + API  :3000
cd apps/booking && npm run dev     # rezervasyon motoru :5174
```

### 13.6 Açık kalanlar
- `POST /api/upload` (referans görsel) ve `GET /appointments/{uuid}/ics` henüz yazılmadı
- `silinecek/reactproje/` hâlâ duruyor — `apps/booking/` artık tek doğru kopya; yanlışlıkla eskisi düzenlenmesin diye silinmeli
- Ertelemede eski slot bloğu `sync_appointment_block` ile güncelleniyor ama randevu `rescheduled` durumuna geçtiğinde bloğun korunması doğrulanmalı

---

## 14. KALAN UÇLAR + VERİTABANINI GÖRSEL GÖRME (tamamlandı)

### 14.1 `POST /api/upload` — referans görsel
- Dosyalar **web kökünün dışında** (`storage/uploads/`), geri okunurken `GET /api/uploads/{key}` ile stream edilir → kullanıcı dosyası hiçbir zaman doğrudan diskten servis edilmez.
- **Magic-byte kontrolü:** tip dosyanın ilk baytlarından çözülür, tarayıcının `Content-Type` beyanına güvenilmez.
  İlk hâlinde sniff başarısız olursa beyan edilen tipe düşüyordu; `image/png` etiketli bir PHP dosyası bu yüzden kabul ediliyordu. Artık tanınmayan imza **sert ret**.
- Allow-list: jpg/png/gif/webp/heic. Boyut 10MB. Rate limit 12/10dk/IP.
- Anahtarlar rastgele UUID; `GET /api/uploads/{key}` yalnızca bu desene uyan adı kabul eder, çözülen yolun upload dizininden çıkmadığını ayrıca doğrular.

| Test | Sonuç |
|---|---|
| Geçerli PNG | 201 ✓ |
| `image/png` etiketli PHP | **415** ✓ |
| SVG (XSS taşıyıcısı) | **415** ✓ |
| 11 MB | **413** ✓ |
| `../../etc/passwd` | **404** ✓ |
| Uydurma dosya adı | **404** ✓ |

### 14.2 `GET /api/booking/appointments/{uuid}/ics`
RFC 5545 uyumlu: CRLF satır sonları, 75 oktette katlama (çok baytlı karakter bölünmez), `, ; \` escape'i, 2 saat önce `VALARM`.
Başlık/açıklama randevunun dilinden gelir. `DTSTART` UTC instant olduğu için müşterinin takvimi **kendi saat diliminde doğru saate** düşer.

Doğrulama: 15:00 Pacific → `DTSTART:20260929T220000Z`, `SUMMARY:Dövme Randevusu - Tacoma`.

### 14.3 Şemayı görsel görme

**a) pgAdmin — interaktif ERD** · http://localhost:8082
Şifre sorulmadan açılır (bağlantı önceden tanımlı). `Databases → cleopatra` üzerine **sağ tık → ERD For Database** → 46 tablo tek diyagramda, sürüklenebilir, PNG/SQL dışa aktarılabilir.
> Not: Docker Desktop bind-mount dosyalarını 0644'e normalize ettiği ve libpq grup-okunabilir `.pgpass` dosyasını reddettiği için parola dosyası container içinde, volume'de üretiliyor.

**b) `docs/SCHEMA.md` — domain domain Mermaid ERD**
`npm run db:erd` ile **canlı veritabanından** üretilir; şema değişince yeniden çalıştır, diyagram asla koddan sapmaz.
İçerik: 7 domain kutusuyla genel akış + her domain için ayrı ER diyagramı (kolon, tip, PK/FK) + domainler arası bağların tablosu.
46 tabloyu tek grafiğe basmak okunmaz olduğu için bilerek bölündü.

**c) Adminer** · http://localhost:8081 — satır kurcalamak ve hızlı SQL için (diyagram yok).

### 14.4 Servis listesi
| Servis | Adres | Not |
|---|---|---|
| PostgreSQL 16 | `localhost:5433` | `cleo` / `cleo` / `cleopatra` |
| Redis 7 | `localhost:6380` | |
| Adminer | http://localhost:8081 | hızlı SQL |
| **pgAdmin** | http://localhost:8082 | **görsel ERD** |
| RedisInsight | http://localhost:5540 | host `redis`, port `6379` |

`npm run db:up` beşini birden kaldırır.

---

## 15. TWILIO WEBHOOK'LARI (tamamlandı)

### 15.1 Çağrı yönlendirme — senin tarif ettiğin akış
```
arayan ──► şubenin Twilio DID'i ──► POST /api/webhooks/twilio/voice ──► şubenin gerçek telefonu
```
1. `To` (Twilio numarası) → `numbers` tablosundan şube bulunur
   (numbers'ta yoksa `locations.twilio->>'specificPhone'` üzerinden rakam bazlı eşleşme — eski kurulumlar için)
2. İmza **o şubenin** auth token'ı ile doğrulanır (şube alt hesabı olabilir)
3. `locations.branch_phone` TwiML `<Dial>` ile aranır, **callerId = arayanın numarası** (şube kimin aradığını görür, bizi değil)
4. Çağrı `calls` tablosuna yazılır, arayan telefonundan lead/müşteri ile eşleştirilir
5. `realtime_events`'e `call.ringing` düşer (canlı çağrı ekranının beslemesi)

**Doğrulandı:**
```xml
<Response><Dial timeout="25" answerOnBridge="true" callerId="+14155551234"
  action=".../voice/status" method="POST"><Number>+12535550100</Number></Dial></Response>
```
| Senaryo | Sonuç |
|---|---|
| Geçerli imza | TwiML Dial ✓ |
| Geçersiz imza | **403** ✓ |
| İmzasız | **403** ✓ |
| Bize ait olmayan numara | "not in service" + Hangup (hiçbir yere aramaz) ✓ |
| Şube telefonu tanımsız | Kibar mesaj + Hangup (boşluğa aramaz) ✓ |
| Arayan lead olarak kayıtlı | `calls.lead_id = LEAD-1000`, `customer_id` dolu ✓ |

### 15.2 `POST /webhooks/twilio/voice/status`
Yönlendirilen bacağın sonucu: süre, sonuç, kayıt URL'i.
`no-answer / busy / failed → Missed`, `completed → Answered`, `canceled → Attempted`.
**Cevapsız + lead eşleşmişse otomatik geri arama görevi** (vade +2sa). `(lead_id, source)` unique index'i tekrarlayan cevapsızlarda görev yığılmasını engeller.

Doğrulandı: `CA2222 → Missed, duration 0` + görev `"Missed inbound call — call back · Arayan Kisi · +14155551234"`.

### 15.3 `POST /webhooks/twilio/inbound` — gelen SMS/MMS
- Telefon başına tek thread; ilk mesajda açılır, lead ve müşteri ile eşleştirilir
- MMS görselleri `media_urls`'e
- `unread_count` artar, `realtime_events`'e `sms.received` düşer
- **STOP/İPTAL/DUR vb.** → `unsubscribes` tablosuna; trigger bunu **konuşma + lead + müşteri + bekleyen otomasyon SMS'lerine** tek işlemde yayar
- **START/BAŞLA** → opt-out geri alınır
- Twilio retry'ı: `webhook_deliveries` unique key sayesinde ikinci kez işlenmez

Doğrulandı: gelen mesaj → thread + LEAD eşleşmesi + unread=1 · retry → mesaj hâlâ 1 · STOP → dört yerde birden kapandı · START → geri açıldı.

### 15.4 `POST /webhooks/twilio/status` — teslimat makbuzları
`queued → sent → delivered / undelivered / failed` durumları mesaja ve kampanya sayaçlarına işlenir.
Her `(sid, status)` çifti tam bir kez uygulanır.

**İmza doğrulaması mesajın şubesinden çözülür** — ilk hâlinde yalnızca global token'a bakıyordu, şube kendi Twilio alt hesabındaysa her makbuz 403 alacaktı.

### 15.5 Yol boyunca düzeltilen iki şey
1. **`calls` tablosu Vonage'a özeldi** (`vonage_call_uuid`). `provider` + `external_call_id` + `(provider, external_call_id)` unique yapıldı → Twilio ve Vonage aynı tabloda, webhook retry'ları her iki sağlayıcıda da güvenli. `forwarded_to` eklendi (hangi numaraya yönlendirdik).
2. **SMS fiyatı tam sayı kuruşa yuvarlanıyordu.** ABD SMS'i $0.0079 → 1 kuruş, yani **her mesajda %27 sapma**. `price_micros` (milyonda bir birim) + `price_currency` yapıldı. 100k mesajda fark: **$1.000 yerine $790**.

### 15.6 Şube numara kurulumu
Her şube için `numbers` tablosuna üç kayıt:
```sql
insert into numbers (location_id, kind, label, number_e164, sms_capable) values
  (:id, 'twilio', 'Twilio DID',  '+1...', true),   -- gelen aramalar/SMS buraya
  (:id, 'vonage', 'Vonage DID',  '+1...', false),
  (:id, 'branch', 'Şube hattı',  '+1...', false);  -- yönlendirme hedefi
```
`locations.branch_phone` yönlendirme hedefidir; `locations.twilio` jsonb'si accountSid / authToken / messagingSid / specificPhone / smsAutomation taşır.

Twilio konsolunda numaraya bağlanacak URL'ler:
| Olay | URL |
|---|---|
| Voice · A call comes in | `POST /api/webhooks/twilio/voice` |
| Messaging · A message comes in | `POST /api/webhooks/twilio/inbound` |
| Messaging · Status callback | `POST /api/webhooks/twilio/status` |

> Lokal geliştirmede imza doğrulamasını atlamak için `TWILIO_SKIP_SIGNATURE=1`. **Üretimde asla.**

---

## 16. GİDEN SMS + KİMLİK DOĞRULAMA (tamamlandı)

### 16.1 Giden SMS — tek huni
`sendSms()` ajan mesajlarını, otomasyonu ve kampanyaları aynı yoldan geçirir.
Sırayla: **opt-out kontrolü → gönderici numarası → şablon çözümleme → segment hesabı → kayıt → taşıyıcı → denetim kaydı.**

**Taşıyıcı anahtarı:** `SMS_TRANSPORT`. Üretim dışında varsayılan **`log`** — mesajlar konsola yazılır, kimseye gerçek SMS gitmez. Gerçekten göndermek bilinçli bir karar olmalı.

**Zamanlama:** `lead_recovery_5m/2h/24h` (telefon bırakılır bırakılmaz), `appointment_reminder_24h/3h` (randevudan önce). Geçmişte kalan hatırlatıcı hiç kurulmaz.

**Worker:** `npm run worker`. `UPDATE ... FOR UPDATE SKIP LOCKED` ile atomik sahiplenme — iki worker aynı mesajı almaz. Opt-out nihai cevap sayılır (tekrar denenmez), geçici hata 10 dk sonraya ertelenir, 3. denemede `failed`.

**Doğrulanan zincir:**
```
telefon bırakıldı  → LEAD-1000 + 3 kurtarma SMS'i kuyruğa
worker             → "Ayse, your spot at Atlanta is still open…"
randevu tamamlandı → kalan kurtarmalar cancelled/booked
                   → Türkçe onay SMS'i + hatırlatıcılar 24sa/3sa öncesine
STOP geldi         → hatırlatıcılar cancelled/opted_out
```

Yol boyunca iki hata: kurtarma şablonunda şube adı boştu (*"Hi Ayse, it's ."*), worker opt-out'u geçici hata sanabiliyordu. İkisi de düzeltildi.

`POST /api/sms/send` elle gönderim için — `INTERNAL_API_TOKEN` ile kilitli, dakikada 5 mesaj, opt-out'ta 409.

### 16.2 Konsol kimlik doğrulaması — kritik açık kapatıldı

**Bulunan durum:** `store.tsx` oturumu varsayılan olarak `STAFF[0]`'a ayarlıyordu — **konsolu açan herkes otomatik olarak süper admin oluyordu.** Giriş ekranında rol kartına tıklayınca parola `demo` olarak doluyor, ekranın altında da yazıyordu. Parola kontrolü tamamen tarayıcıdaydı.

**Yapılanlar:**
| Alan | Öncesi | Şimdi |
|---|---|---|
| Varsayılan oturum | STAFF[0] (süper admin) | **yok** — `GET /api/auth/me` sorulur |
| Parola kontrolü | tarayıcıda `password !== "demo"` | sunucuda scrypt (N=16384) |
| Parolalar | hepsi `demo`, ekranda yazılı | hesap başına 20 karakter rastgele, `seed/credentials.txt` (chmod 600, gitignored) |
| Oturum | localStorage'da staff id | httpOnly + SameSite=Lax çerez, DB'de hash'i, 12 saat |
| İzin kontrolü | istemcideki matris | sunucu oturumundaki grant listesi; her mutasyonda yeniden kontrol |
| Hata mesajı | "hesap yok" / "parola yanlış" | tek mesaj — hesap varlığı sızdırılmaz |
| Brute force | yok | IP başına 20/5dk, hesap başına 8/5dk |
| Pasif hesap | girebiliyordu | 403, ayrıca mevcut oturumu anında geçersiz |

**Doğrulanan davranışlar:**
```
yanlış parola        → 401 "Email or password is incorrect"
olmayan hesap        → aynı mesaj, aynı süre (timing-safe)
eski "demo" parolası → 401
9. deneme            → 429
pasif hesap (Sara)   → 403 "This account is deactivated"
çerez                → HttpOnly ✓ · JS'ten okunamıyor ✓
logout               → /me artık 401
```

### 16.3 CRM API — kapsam zorlaması
`withAuth(permission)` sarmalayıcısı: izin + şube kapsamı sunucuda karara bağlanır.

| Uç | İzin |
|---|---|
| `GET /api/crm/bootstrap` | oturum (stüdyo/rol/izin/sayaçlar, kapsama göre daraltılmış) |
| `GET /api/crm/leads` | `leads.view` |
| `PATCH /api/crm/leads/{id}` | `leads.edit` |

**Kapsam testi (Dana = yalnızca Atlanta):**
```
Cleo (super_admin) lead listesi   → 2 (atlanta + tacoma)
Dana lead listesi                 → 1 (yalnız atlanta)
Dana ?location=<tacoma>           → 403 "outside your access"
Dana PATCH tacoma lead'i          → 403
Dana PATCH kendi lead'i           → 200, SLA saati kapandı, denetime yazıldı
Ravi (viewer) PATCH               → 403 "Permission required · leads.edit"
oturumsuz                         → 401
```
Kapsam dışı istek **boş liste değil 403** döner — sessizce boş dönmek yanlış yapılandırmayı gizler.

### 16.4 Kalan
`store.tsx` veri okumaları hâlâ mock (sidebar rozetleri, listeler). Kimlik doğrulama gerçek; sıradaki adım okumaları `/api/crm/*`'a çevirmek.

---

## 17. ADRES AYRIMI: HALKA AÇIK `/` · YÖNETİM `/admin`

**Önceki durum:** CRM konsolu `http://localhost:3000/` adresindeydi — yani sitenin ön kapısı yönetim paneliydi.

| Adres | Ne var |
|---|---|
| `/` | **Halka açık stüdyo seçimi** — booknow tasarımı, sunucuda render, ziyaretçinin diline göre |
| `/{slug}/book` (:5174) | Rezervasyon sihirbazı |
| `/admin` · `/admin/*` | **CRM konsolu** — giriş şart, `noindex, nofollow` |

- `src/router.ts` artık `ADMIN_BASE = "/admin"` ile öneklenmiş; konsol içi gezinme, geri tuşu ve derin linkler doğrulandı (`/admin/leads` → geri → `/admin`).
- Eski kök rotalar (`/leads`, `/settings`) artık **404**.
- Kök layout'tan konsol paleti kaldırıldı (`bg-ink-900`), `/admin/layout.tsx`'e taşındı — iki tasarım birbirine karışmıyor.

### Dil — sunucu tarafında pazarlık
`?lang` → çerez → `Accept-Language` → varsayılan. Yalnızca veritabanının gerçekten servis ettiği diller kabul edilir.
`<html lang>` pazarlık sonucuyla eşleşir (ekran okuyucular ve çeviri araçları için).

```
Accept-Language: tr → <html lang="tr"> · "Stüdyo Seçin"
Accept-Language: de → <html lang="de"> · "Studio Auswählen"
?lang=es            → "Elige un Estudio"
```
İlk boyama zaten doğru dilde — İngilizce gösterip sonra değiştirme yok.

### Konsoldaki hata seli hakkında
`Unchecked runtime.lastError: Could not establish connection` hatası **uygulamadan gelmiyor.**
Kaynağı `contentscript.js` — bir tarayıcı eklentisinin içerik betiği, kendi arka plan servisine ulaşamıyor.
Aynı sayfa eklentisiz bir tarayıcıda açıldığında konsol temiz; ağ trafiğinde de döngü yok (109 istek, oturuyor).
Tespit için: gizli pencerede aç (eklentiler kapalı) veya `chrome://extensions` üzerinden teker teker kapat.

Bu sırada gerçek bir sorun çıktı ama başka: `availability` ucu ilk çağrıda 500 veriyordu —
`__webpack_require__.C is not a function`, bayat `.next` derleme önbelleği. `.next` temizlendi.

---

## 18. TEK PORT (tamamlandı)

Rezervasyon motoru ayrı bir Vite uygulamasıydı (`:5174`). Artık Next uygulamasının içinde, her şey `:3000`'de.

| Adres | Ne |
|---|---|
| `/` | Stüdyo seçimi — sunucuda render, dil algılamalı |
| `/{slug}/book` · `/{slug}/book/{adim}` | Sihirbaz |
| `/{slug}/book/done/{uuid}` | Onay |
| `/b/{uuid}` | Randevu yönet / ertele / iptal |
| `/admin` · `/admin/*` | CRM konsolu (giriş şart, `noindex`) |
| `/api/*` | Public + webhook + konsol uçları |

### Taşıma sırasında yapılanlar
- Kaynak `apps/booking/src` → `src/booking/`; Vite'a özgü dosyalar (main/router/index.html/vite.config) düştü.
- **react-router-dom → next/navigation.** Parametreler artık sunucu segmentinden prop olarak iniyor; bilinmeyen stüdyo ve uydurma adım **sunucuda 404**, JavaScript çalışmadan önce.
- **`import.meta.env` → `process.env.NEXT_PUBLIC_*`**.
- Tasarım `.cleo-public` altına kapsüllendi. Konsol aynı Tailwind build'ini paylaşıyor ve sıcak-kâğıt paletiyle Manrope kullanıyor; kurallar `:root`/`body`'ye dokunsaydı iki tasarım birbirinin fontunu ve rengini ezerdi.

### SSR'ye geçerken çıkan hatalar
Vite'ta sunucu render'ı hiç yoktu, dolayısıyla `window`/`navigator` her zaman vardı. Next bu bileşenleri sunucuda ön-render ediyor:

| Hata | Düzeltme |
|---|---|
| `ReferenceError: navigator is not defined` (500) | `src/booking/lib/browser.ts` — render yolundaki tüm tarayıcı global'leri korumalı |
| Dil SSR'de `en`, tarayıcıda `tr` → hidrasyon uyuşmazlığı | Dil sunucuda pazarlık edilip `LocaleProvider`'a prop olarak geçiyor |
| `<html lang>` `?lang`'ı görmüyordu (Next layout'lara searchParams vermez) | `LocaleProvider` aktif dile göre `document.documentElement.lang`'ı senkronluyor |

### Taşıma sırasında bulunan üç gerçek hata
1. **Adım değişiminde query string düşüyordu.** `?lang=tr` bir sonraki adımda tarayıcı diline dönüyordu — ve daha kötüsü, `?utm_source` kaybolunca **reklam kuralı akış ortasında devre dışı kalıyor**, sihirbazın adım sırası ziyaretçinin altından değişiyordu. `bookingPath()` artık query'yi taşıyor.
2. **Dil sunucuya hiç ulaşmıyordu.** `localStorage` sunucuya görünmez; sayfalar orada render edildiği için her gezinme tarayıcı diline dönüyordu. `persistLocale` artık çerez de yazıyor.
3. **Oturum dili hep `en` kaydediliyordu.** `useTracking` locale göndermiyordu — Almanca arayüzde form dolduran ziyaretçiye kurtarma SMS'i **İngilizce** giderdi. Doğrulandı: artık `Hallo Hans, hier ist Atlanta…`

### Açık bırakılan bir davranış
`getStudioCountry()` telefon ülke kodunu **ziyaretçinin saat diliminden** seçiyor, şubenin ülkesinden değil. Türkiye'den Atlanta şubesine bakan biri `4045559876` yazdığında numara `+904045559876` olarak kaydediliyor — yani ulaşılamaz.

Bu sizin kasıtlı "önce kullanıcı" tasarımınız (Atlanta'da randevu alan Türk müşterinin numarası muhtemelen +90'dır), o yüzden sessizce değiştirmedim. Ama SMS ulaşılabilirliğini etkiliyor; kararınız.

### `apps/booking/`
Artık gereksiz. Yanlış dosyayı düzenlememek için silmedim, `README.md`'sine uyarı koydum. Tek port sürümünü test edip memnun kalınca silebilirsiniz.

---

## 19. TELEFON ÜLKE KODU DÜZELTİLDİ

**Sorun:** Atlanta şubesinin sayfasında telefon alanı 🇹🇷 +90 açılıyordu. `4045559876` yazılınca numara `+904045559876` olarak kaydediliyordu — ulaşılamaz, ve o numaraya hiçbir SMS gitmez.

**İki ayrı neden vardı:**

1. **Öncelik ters kuruluydu.** `getStudioCountry()` önce ziyaretçinin *saat dilimine* bakıyordu ("User-First Priority"), şubenin ülkesine değil. Türkiye'den bakan herkes, hangi şubeye bakarsa baksın, +90 görüyordu. Sıralama artık: **şube ülkesi → tarayıcı yerel bölgesi → US**.
   Saat dilimi tahmini büsbütün kaldırıldı; `America/Sao_Paulo` gibi değerleri US sayıyordu.

2. **Prop değil, modül global'i kullanılıyordu.** Ülke `useState(() => …)` başlatıcısında okunuyordu — yani **yalnızca ilk render'da**, config API'den gelmeden önce. Öncelik düzeltilse bile alan asla güncellenmezdi. Ülke artık `config.location.countryCode`'dan **prop olarak** iniyor; config gelince alan kendini düzeltiyor.

**Ziyaretçinin seçimi korunuyor:** bayrak menüsünden ülke seçilirse `chosenByUser` işaretleniyor ve şube varsayılanı bir daha araya girmiyor.

**Doğrulama:**
```
/atlanta/book/contact?lang=tr  → alan: 🇺🇸 +1, placeholder "(305) 555-5555"
"4045559876" yazıldı          → kayıt: +14045559876 ✓
oturum dili                    → tr ✓
```
Arayüz dili ile telefon ülkesi birbirinden bağımsız — Türkçe konuşan, ABD numaralı müşteri doğru çalışıyor.

---

## 20. KONSOLDAKİ MOCK KALDIRILDI

Panel gerçek veriyle çalışıyor. Kaldırılan her şey, gerçek kayıtlardan ayırt edilemeyen uydurma veri üretiyordu.

### Kaldırılanlar
| Ne yapıyordu | Yerine |
|---|---|
| `useState(LEADS)`, `useState(CALLS)`… — seed dizileri | Oturum açılınca `/api/crm/*`'dan yükleniyor |
| **Her 14 saniyede sahte çağrı üretip** çalma→cevaplama→bitiş döngüsünden geçirip **çağrı kaydına yazıyordu** | Kaldırıldı. Canlı ekran gerçek taşıyıcı olaylarıyla dolacak (socket sırada) |
| Açılışta 3 sahte "devam eden çağrı" | Boş |
| **"Ara" butonu sonucu yazı-tura ile belirliyordu** (%60 cevaplandı, rastgele süre) | `POST /api/crm/calls/log` — yalnızca **girişim** kaydediyor, sonucu taşıyıcı webhook'u yazıyor |
| Lead 360'ta çağrı sonrası **lead durumunu uydurma sonuca göre değiştiriyordu** | Kaldırıldı — ajan durumu kendisi seçiyor |
| Kampanya sayaçları 450ms'de bir kendi kendine artıyordu | Kaldırıldı. Gerçek sayaçlar Twilio status webhook'undan (dispatcher yazılınca) |
| Gönderimden 3 sn sonra **sahte müşteri yanıtı** | Kaldırıldı — gerçek yanıtlar inbound webhook'tan |
| `convertLead` tarayıcıda `BK-` kodu üretip sadece belleğe yazıyordu | `POST /api/crm/leads/{id}/convert` — çakışma kontrolü, hatırlatıcı zamanlama, denetim kaydı |
| Settings **sahte API anahtarları üretiyordu** (`TW-K7F2…`) ve 6 saniyede bir sahte webhook olayı | `GET /api/crm/settings` — gerçek entegrasyon durumu + gerçek `webhook_deliveries` |

### Güvenlik: bootstrap sızıntısı
`/api/crm/bootstrap` şube satırlarını olduğu gibi döndürüyordu — **Twilio auth token'ı ve SMTP parolası dahil**, konsolu açan her kullanıcının tarayıcısına. Artık `safeStudio()` ile maskeleniyor: `atla••••oken`. Konsol yalnızca bir kimlik bilgisinin **var olduğunu** görüyor, değerini değil.

Settings ekranında "göster" ve "kopyala" düğmeleri de kaldırıldı — gösterilecek bir şey yok.

### Yeni CRM uçları
`bootstrap` · `leads` · `leads/{id}` · `leads/{id}/convert` · `appointments` · `calls` · `calls/log` · `conversations` · `tasks` · `dashboard` · `settings`

Hepsi `withAuth(izin)` arkasında; şube kapsamı sunucuda uygulanıyor, kapsam dışı istek **boş liste değil 403**.

### Doğrulama
```
Lead hattı        → LEAD-1002 "Terk Eden Musteri" · Instagram · +14045551111
Randevuya dönen 2 lead → hatta GÖRÜNMÜYOR (doğru: converted_at dolu)
Durum değişikliği → DB'de kalıcı, SLA saati kapandı, denetim kaydı yazıldı
Settings          → yalnızca Turnstile "kurulu", diğer 6'sı "yapılandırılmadı"
Sahte anahtar     → yok
store'da setInterval → 0
```

### Kalan
`sendSms` ve kampanya oluşturma hâlâ yerel state'te — SMS gönderimi `/api/sms/send` üzerinden çalışıyor ama konsol henüz o uca bağlı değil. Sıradaki adımlarda (arka plan servisleri) birlikte ele alınacak.

---

## 21. REZERVASYON EKRANI: `page_form=1` VE SAAT DİLİMİ

### 21.1 Reklam parametresi
`page_form=1` asıl tetikleyici ve zaten çalışıyor. Tetikleyici listesi API'den geliyor:
```
utm_source · utm_medium · utm_campaign · utm_term · utm_content · page_form
```
Bunlardan biri varsa **CONTACT adımı 1. sıraya** çekiliyor; TIMING zaten dizinin sonunda (SUCCESS'ten hemen önce) kalıyor.

Gerçek reklam URL'iyle doğrulandı:
```
/tacoma/book?page_form=1&gad_source=1&gad_campaignid=…&gbraid=…&gclid=…
→ "Start Journey" sonrası ilk ekran: Your Contact Info ✓
→ adım sırası: contact → purpose → style → story → … → when (son) ✓
```

`free_pick=1` (veya `utm_source` içinde `free_pick`) CONTACT'tan hemen sonra **ADDRESS** adımını ekliyor — VIP transfer adresi.

### 21.2 Saat dilimi — bulunan ve düzeltilen hata
Müsaitlik ucu slot'u yalnızca **şube yerel saati** olarak döndürüyordu. İstanbul'daki müşteri Tacoma için `10:00` görüyor ve bunu kendi saati sanıyordu — oysa o an İstanbul'da **20:00**. Müşteri yanlış saati seçtiğini fark etmeden randevu alıyordu.

**Düzeltme:** her slot artık UTC instant'ı da taşıyor; istemci bunu ziyaretçinin **seçtiği saat dilimine** göre yazıyor, altında şube saatini küçük puntoyla bırakıyor.

```
20:00              ← ziyaretçinin saati (büyük)
10:00 GMT-7        ← şubenin saati (altta)
```
Gün sınırını aşan slotlarda `+1` işareti var (Tacoma Perşembe 23:30 = İstanbul Cuma).

Günler şubenin admin ayarındaki çalışma saatlerinden üretiliyor; ufuk `maxBookingDaysAhead` (14 gün), aynı gün için `sameDayLeadHours` (2 saat) kuralı geçerli.

### 21.3 Kayıt: üç saat de tutuluyor
```
bk_uuid        BK-276D0B12
sube_yerel     2026-09-25 10:00      (preferred_date + preferred_time)
sube_tz        America/Los_Angeles   (display_timezone)
utc_instant    2026-09-25 17:00+00   (starts_at)  ← tek doğruluk kaynağı
musteri_tz     Europe/Istanbul       (user_timezone)
musteri_yerel  2026-09-25 20:00      (starts_at → user_timezone)
```

### 21.4 Adminde üç okuma bir arada
Randevu detayında "Preferred Slot" kartının altına eklendi:
```
STUDIO   25 Sept, 10:00   America/Los_Angeles
CLIENT   25 Sept, 20:00   Europe/Istanbul
UTC      25 Sept, 17:00   UTC
```
Müşteri saat dilimi şubeninkiyle aynıysa CLIENT satırı gösterilmiyor — gereksiz tekrar olmuyor.

> Not: adresler artık `:3000`. `:5174` kapatıldı (tek port).

---

## 22. ARKA PLAN SERVİSLERİ (tamamlandı)

Worker artık tek iş değil, yedi iş çalıştırıyor. Çerçeve `src/server/jobs/`:
bir iş yalnızca **ne yapacağını** tarif ediyor; zamanlama, üst üste binme koruması ve
kayıt tutma runner'ın işi. Bir işin çökmesi diğerlerini durdurmuyor; her koşu
`rollup_checkpoints`'e yazılıyor.

```
npm run worker            # hepsi
npm run job               # işleri listele
npm run job rollups       # tek işi hemen çalıştır
```

| İş | Sıklık | Ne yapar |
|---|---|---|
| `scheduled-sms` | 15 sn | Kurtarma + hatırlatıcı kuyruğunu boşaltır |
| `sla-monitor` | 5 dk | Aranmamış lead → görev; eşiği aşınca yöneticiye bildirim |
| `campaign-dispatcher` | 1 dk | Kampanyaları şube başına ~1 msg/sn ile gönderir |
| `rollups` | 10 dk | Rapor tablolarını doldurur (son 3 günü yeniden hesaplar) |
| `winback` | 12 sa | 30 gün önce iptal edenlere geri kazanım SMS'i kuyruğa |
| `duplicate-detector` | 6 sa | Telefon/e-posta eşleşen lead gruplarını işaretler |
| `vonage-sync` | 5 dk | VBC çağrı kayıtlarını çeker, lead/ajanla eşler — **kimlik bilgisi yoksa atlanır** |
| `timely-sync` | 30 dk | Timely doluluğunu `availability_blocks`'a okur — **kimlik bilgisi yoksa atlanır** |

### Raporlama — neden bu şekilde
Toplamalar **şubenin yerel gününe** göre gruplanıyor, UTC'ye göre değil. Pacific bir
şubenin pazartesi akşamı UTC'de salıdır; UTC'ye göre gruplayan bir rapor akşamları iki
güne bölerdi ve kimse fark etmezdi.

Her koşu son 3 günü **yeniden hesaplıyor**, eklemiyor: geç gelen bir webhook ya da
düzeltilen bir kayıt dünün rakamlarına donmuş kalmıyor.

### Test sırasında bulunan üç hata
1. **Ajan karnesi şube başına bölünmüyordu.** İki şubede çalışan bir ajanın aynı SLA
   rakamı her satırda tekrarlanıyor, toplamları şişiriyordu. Alt sorguların hepsi artık
   şubeye göre filtreli. Ayrıca şubesi olmayan aktivite (giriş yapmak gibi) artık satır
   üretmiyor — o stüdyo işi değil.
2. **Win-back hiç aday bulamıyordu.** "Sonradan tekrar randevu aldı mı" kontrolü
   randevunun **kendisini** yakalıyordu: iptal edilen bir randevu her zaman iptalinden
   önce oluşturulur. `later.id <> appointments.id` eklendi.
3. SLA eskalasyonu doğru kişilere gidiyor — doğrulandı: Atlanta müdürü yalnızca Atlanta
   lead'ini aldı, Tacoma'yı almadı; tüm-şube yetkisi olanlar ikisini de aldı.

### Doğrulanan çıktılar
```
sla-monitor          2 ihlal → 2 görev · ikinci koşu → 0 (kopya açmıyor)
                     70 dk sonra → 5 bildirim, kapsama göre doğru kişilere
rollups              184 şube-günü · 24 huni satırı · 2 attribution · 2 ajan-günü
huni (tacoma)        welcome: 4 ulaştı / 3 terk · contact: 1 ulaştı / 1 terk
campaign-dispatcher  2 alıcı, dile göre ayrı metin (EN/TR), şube numarasından,
                     sayaçlar gerçek → status=sent, finished_at dolu
winback              30 gün önce iptal → Türkçe kurtarma SMS'i kuyruğa
duplicate-detector   telefon + e-posta eşleşmesinden 2 grup
```

### Vonage & Timely
İkisi de yazıldı ama kimlik bilgisi olmadan **çalışmıyor, sessizce atlanıyor** —
her aralıkta hata basmıyor. Bilgileri `.env`'e girince kendiliğinden devreye girerler.

Timely **yalnızca okuma**: doluluk oradan gelir, kendi randevularımızı trigger yazar,
ikisi de `availability_blocks`'ta buluşur. Geri yazmak iki sistemin aynı takvimi
sahiplenmesi olurdu — takvimin kendini bozması demek.

---

## 23. CANLI ZİYARETÇİ EKRANI + SOKET (tamamlandı)

### 23.1 Temel güvenlik kararı: public sayfaya soket YOK
Ziyaretçiden soket istemiyoruz. Rezervasyon sayfası zaten her adımda `PUT /sessions/{uuid}/step`
gönderiyor; buna 20 saniyelik hafif bir `POST /sessions/{uuid}/ping` eklendi (tek kolon yazar,
gövde döndürmez, sekme gizliyken durur).

Böylece **anonim kullanıcı için açık bağlantı yok** — kimliksiz soket, oran sınırlama derdi,
bağlantı havuzu tüketme riski hiçbiri oluşmuyor. Canlı tablo `booking_sessions`'tan okunuyor.

### 23.2 Soket güvenliği
| Önlem | Nasıl |
|---|---|
| Kimlik | Konsolun **aynı httpOnly oturum çerezi**. Query string'de token yok — query string log'lara, proxy'lere ve Referer başlığına sızar |
| Ayrı kimlik bilgisi yok | Çıkış yapmak ya da hesabı pasife almak soketi de anında düşürür |
| Yetki | Her `subscribe` için izin + şube kapsamı kontrolü |
| **Teslimde yeniden kontrol** | Mesaj gönderilirken izin ve kapsam tekrar bakılıyor — soket açıkken yetki değişebilir |
| Bilinmeyen kanal | Reddedilir. Kanal adı tablosu yoksa dinletmez; bir yazım hatası açık yayına dönüşmez |
| Abonelik sınırı | Soket başına 20 kanal |
| Origin | `REALTIME_ALLOWED_ORIGINS` ile CORS kısıtı |
| Mesaj boyutu | 100 KB tavan — istemci yalnızca küçük kontrol mesajı gönderir |
| Boşta bağlantı | 25 sn ping / 20 sn timeout |

**Doğrulanan saldırı senaryoları:**
```
çerezsiz bağlantı              → unauthorized
sahte çerez                    → unauthorized
uydurma kanal (secret:...)     → "unknown channel"
kapsam dışı şube (Dana → 99)   → "studio outside your access"
kapsam içi şube (Dana → 1)     → kabul
```

### 23.3 Canlı ziyaretçi ekranı — `/admin/live`
`reports.view` izni gerektiriyor, sidebar'da yalnızca izni olana görünüyor.

Gösterdikleri: **şu an kaç kişi**, kaçı iletişim bıraktı, **hangi şubede**, **hangi kaynaktan**
(utm_source + kampanya), **hangi adımda** (3/8 gibi), ne kadar süredir sitede, cihaz ve dil.

Kapsam tarayıcıda doğrulandı:
```
Cleo (tüm şubeler) → 6 ziyaretçi · Tacoma 4, Atlanta 2 · instagram 4, google 1, direct 1
Dana (yalnız Atlanta) → 2 ziyaretçi · Atlanta 2 · instagram 2
```

### 23.4 Yol boyunca çıkan iki hata
1. **Kapsamlı kullanıcıya hiç veri gitmiyordu.** Drizzle, dizi parametresini tek skalere
   düzleştiriyordu (`params: 75,1`), `= any(1)` de Postgres'in reddettiği bir tip hatası.
   Hata sessizce yutulduğu için tablo boş görünüyordu. Her id artık ayrı bağlı parametre.
2. **Soket "unauthorized" dönüyordu.** İstemci `localhost:4001`'e bağlanıyordu ama çerez
   `127.0.0.1` için yazılmıştı — çerezler host bazlıdır, gitmiyordu. İstemci artık adresi
   **sayfanın kendi host'undan** türetiyor; `NEXT_PUBLIC_REALTIME_URL` yalnızca gateway
   başka bir makinedeyse gerekiyor.

### 23.5 Sunucuda çalıştırma — `deploy/`
Üç ayrı süreç: `cleo-web` (Next), `cleo-worker` (job'lar), `cleo-realtime` (soket).
Job'ları web'den ayırmak bilinçli: uzun süren bir toplama isteklerin CPU'sunu yemez.

| Dosya | Ne için |
|---|---|
| `deploy/ecosystem.config.cjs` | PM2 — `pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup` |
| `deploy/cleo-*.service` | systemd alternatifi; `NoNewPrivileges`, `ProtectSystem=strict`, `Nice=5` |
| `deploy/nginx.conf` | Tek origin arkasında üç süreç; `/realtime` WebSocket upgrade'li, `/admin` IP allow-list'li |

**Neden tek origin:** soket `/realtime` altında aynı origin'den servis edilirse oturum çerezi
ona da ulaşır. Farklı host ya da port olursa çerez gitmez — yukarıdaki 2. hatanın ta kendisi.

Worker **tek instance** çalışır. Job'lar satırları `FOR UPDATE SKIP LOCKED` ile sahiplendiği
için ikinci instance güvenli olurdu, ama biri yeterli ve log'lar okunur kalıyor.
