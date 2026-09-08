# CLEOPATRA INK — CRM CONSOLE · AI BAĞLAM DOSYASI

> Bu dosya, projeyi devralacak bir yapay zekânın **hiçbir dosyayı okumadan** sistemi eksiksiz
> anlaması için yazılmıştır. Her bölüm gerçek kod durumuyla birebir doğrulanmıştır.

---

## 1. PROJENİN KİMLİĞİ

**Cleopatra Ink CRM Console**, çok şubeli bir dövme/piercing stüdyo zincirinin operasyon
konsoludur. Tek cümleyle: *lead intake → telefonla arama (SLA'lı) → randevuya çevirme →
kapora → tamamlanma* hunisinin tamamını; SMS, çağrı merkezi, görev, kampanya ve rapor
modülleriyle birlikte yöneten, **tamamen istemci tarafında çalışan yaşayan bir simülasyon**.

- **Durum:** Frontend %100 çalışır (mock store). Backend tasarımı hazır (`backend/`), bağlantı yok.
- **Veri kalıcılığı:** Yalnızca oturum + dil tercihi localStorage'da; diğer her şey reload'da seed'e döner.
- **Gerçek veri:** `src/services/sampleCsv.ts` içinde production BookNow export'larından alınmış
  gerçek lead/randevu kayıtları (E.164 telefon, gclid/fbclid/ttclid, stüdyo eşleşmeleri) bulunur.

### Teknoloji & Tema

| Katman | Seçim |
|---|---|
| Stack | Vite 6 + React 18 + TypeScript + Tailwind CSS v4 (`@theme` tabanlı) |
| Tipografi | **Cinzel** (display/başlık) + **Manrope** (gövde) + **JetBrains Mono** (numaralar, `.num`) |
| Tema | Sıcak kâğıt açık tema: `ink-950` en AÇIK (#fbfaf6) → `ink-50` en KOYU (#191510). Bu ters ölçek bilinçlidir. |
| Aksan | Amber/altın `gold-500 #fba200` (ev rengi). Semantik: `jade #2fbf71` (başarı) / `amber #e8a33d` (uyarı) / `ember #e5484d` (tehlike). Lapis/iris kategorik veri içindir, durum anlatmaz. |
| Doku | `ambient-bg` (çift radial degrade) + `ambient-grain` (SVG noise) + `ambient-lines` (44px yatay çizgi) katmanları |
| Hareket | `animate-rise` (sayfa girişi), `animate-pop` (eklenen öğe), `animate-toast`, `animate-drawer`, `row-live` (satır hover + altın inset çizgi), `eq-bar` (canlı ses ekolayzırı), `kpi-num` clamp(26→34px) |

---

## 2. DOSYA HARİTASI

```
src/
├── main.tsx            → React kökü
├── App.tsx             → Provider zinciri, ErrorBoundary, Gate (oturum), ROUTE_PERM, Screen switch
├── router.ts           → History-API path router (hash YOK): routeToPath / pathToRoute
├── store.tsx           → TEK MERKEZİ STORE: tüm state, navigasyon, simülasyonlar, yetki, kapsam
├── data.ts             → Tipler + seed veri + RBAC (ROLES/PERMISSIONS/DEFAULT_MATRIX) + meta sözlükler
├── i18n.tsx            → t()/tf()/useI18n(); servis: /api/v1/locales/tr.json → cache → TR_SNAPSHOT
├── shell.tsx           → Sidebar (rail 64px↔232px), Topbar, OmniSearch, UserMenu, SyncStrips
├── ui.tsx              → İkon seti (elle çizim SVG), Pill, Btn(locked), Modal, Drawer, Dropdown(portal),
│                         Toggle, Pagination, SlaBadge, PlayerModal, Sparkline, LiveClock, useCountUp
├── services/
│   ├── csv.ts          → BookNow CSV parser + kolon eşleyici (parseBookNowCsv, StudioResolver)
│   └── sampleCsv.ts    → Gerçek export örnekleri (SAMPLE_LEADS_CSV, SAMPLE_APPOINTMENTS_CSV)
└── views/              → Login, Dashboard, Leads, LeadDetail, Appointments (+AppointmentDetail),
                          Sms, Campaigns, Calls, Tasks, Duplicates, Reports, Studios, StudioEdit,
                          Staff, Settings, Import
public/api/v1/locales/tr.json   → TR sözlüğü (aynı origin'den servis edilir)
backend/
├── schema.sql          → Supabase-uyumlu tam PostgreSQL DDL (v2, çalıştırılabilir seed'li)
└── README.md           → Mimari, ERD, webhook'lar, worker'lar, akışlar, frontend→tablo eşlemesi
```

**Kritik kural:** `store.tsx` veriye dokunan TEK yerdir. Supabase geçişinde yalnız bu dosya değişir.

---

## 3. VERİ MODELİ (src/data.ts)

### Çekirdek varlıklar

| Varlık | Önemli alanlar |
|---|---|
| `Lead` | `id` (UUID string), `name`, `email`, `formattedPhone` (E.164), `locationId`, `status` (new/contacted/qualified/done), `callStatus` (14 değerlik union), `lastCalledAt`, `createdAt`, `unsubscribedAt`, `isDuplicate`, `meta{purpose,style,size,storyType,story,bodyAreas[],referenceImages[],language,consent}`, `attr{platform,utmSource,utmMedium,utmCampaign,gclid,fbclid,ttclid,landingPage,matchMethod}` |
| `Appointment` | `id` (int), `uuid` (BK-…), `customerId` (→Lead), `locationId`, `purpose/style/size/storyType/story/bodyAreas`, `referenceImage`, `preferredDate+preferredTime`, `status` (pending/confirmed/deposit_paid/completed/cancelled/no_show/rescheduled/**spam**), `isFreePick`, `platform`, `campaign`, `cancelReason?`, `userTimezone?`, `voiceCalls?`, `streetAddress?` |
| `CallLog` | `direction` (inbound/outbound), `customerId?`, `appointmentId?`, `locationId`, `startTime`, `duration`, `result` (Answered/Missed/Voicemail/Attempted), `hasRecording`, `agent`, `ext` |
| `Conversation` / `SmsMessage` | `customerId?`, `unreadCount`, `unsubscribed`, `messages[{direction,body,at,status(sent/delivered/received)}]` |
| `Campaign` | `status` (draft/scheduled/sending/sent), `segment{locationId,statuses,platforms}`, `total/delivered/failed/replied` |
| `TaskItem` | `status` (open/done), `dueAt`, `assignee`, `leadId?`, `source` (manual/callback/voicemail) |
| `Studio` | `slug`, `city`, `country`, `timezone`, `bookingActive`, `accent` (marka rengi), `image?`, `config{bookingSlug, publicPhone, lat/lng, gtmCountry, gtmCityState, mapsUrl, ianaTimezone, displayOrder, bookingInterval, enableOnlineBooking, socials{ig,fb,tt,tw,yt}, twilio{accountSid,authToken,messagingSid,specificPhone,smsAutomation}, vonage{did,extension}, mail{…smtp}, businessHours{7 gün × {enabled,open,close}}}` |
| `StudioNumber` | `kind` (vonage/twilio/branch), `smsCapable` |
| `Artist` | `specialties[]`, `locationIds[]`, `instagram`, `active` |
| `Extension` | `extension` (dahili no), `locationId` (null = çağrı merkezi havuzu) |
| `Note` | polymorphic: `notableType` (lead/appointment) + `notableId` |

### RBAC

- **6 rol** (`ROLES`): `super_admin` (system, kilitli) · `hq_admin` · `branch_manager` · `studio_admin` · `callcenter_agent` · `viewer` — her birinin `color` ve `desc`'i var.
- **18 izin** (`PERMISSIONS`, `PermId` tipi — yanlış ID derlemede patlar): `leads.{view,edit,convert,export,merge}` · `appts.{view,edit}` · `sms.{view,send,campaign}` · `calls.{view,manage}` · `reports.view` · `studios.{view,edit}` · `staff.{view,manage}` · `settings.manage`
- **`DEFAULT_MATRIX`**: super_admin = hepsi; hq_admin = settings.manage hariç hepsi; branch_manager = lead+randevu+sms+kampanya+çağrı+rapor+şube görüntüleme+staff görüntüleme; studio_admin = kendi şubesi operasyonu + `studios.edit`; callcenter_agent = arama kuyruğu + SMS gönderme + görevler; viewer = salt görüntüleme.
- **`StaffMember`**: `roleId` + `locationIds: number[] | "all"` (şube kapsamı) + `active`.

### Seed kadrosu (statik giriş hesapları — şifre: `demo`)

| Hesap | Rol | Kapsam |
|---|---|---|
| Cleo Rivera | Super Admin | Tümü |
| Marcus Hale | HQ Admin | Tümü |
| Dana Whitfield | Branch Manager | [1] Atlanta |
| Elif Aydın | Branch Manager | [5,6] İstanbul+Ankara |
| Jonas Weber | Studio Admin | [8] Berlin |
| Maya Chen | Studio Admin | [2] Miami |
| Tara Singh, Owen Pierce | Callcenter Agent | Tümü |
| Ravi Patel | Viewer | [1,2,3] |
| Sara Al-Farsi | Viewer | [10] Dubai — **pasif** (giriş reddedilir) |

### Meta sözlükler (renk + etiket)

`CALL_STATUS_META` (14), `APPT_STATUS_META` (8), `PLATFORM_META` (google/facebook/tiktok/instagram/webform/direct), `RESULT_META` (Voicemail = **amber**, "takip gerekir" semantiği), `TEMPLATES` (4 SMS şablonu), `FUNNEL`, `DAILY` (14 günlük seri).

---

## 4. OTURUM & YETKİ MİMARİSİ

```
Login (rol kartı → e-posta+şifre dolar) → store.login(memberId)
  ├─ session = StaffMember (localStorage "cleo.session" ile kalıcı)
  ├─ can(perm)  = matrix[session.roleId].includes(perm)        → sessiz kontrol
  ├─ guard(perm) = can || toast("Permission required · …")      → aksiyon kapısı
  ├─ inScope(locId) = locationIds==="all" || includes(locId)   → şube filtresi
  ├─ locOk(locId)   = inScope && globalLocation uyumu          → tüm listelerde kullanılır
  └─ scopedStudios  → şube seçici dropdown yalnız bunları gösterir
```

**Enforcement katmanları (üçü birden):**
1. **Sidebar**: `NAV.filter(item => !item.perm || can(item.perm))` — izinsiz menü hiç çizilmez.
2. **Rota**: `App.tsx` içinde `ROUTE_PERM` haritası; izin yoksa `NoAccess` ekranı (deep-link korumalı).
3. **Aksiyon**: Destructive/işlem butonları `locked={!can(…)}` (kilit ikonu + aria) ve handler içinde `guard()`.

Logout menüsü: UserMenu (topbar sağ) + sidebar alt çıkış ikonu. Pasif hesap girişi Login'de hata verir.

---

## 5. ROTALAMA (hash YOK — temiz path)

`router.ts`: `pathToRoute` / `routeToPath`, History API (`pushState`), `popstate` ile geri/ileri,
navigasyonda scroll-top. Sandbox iframe gibi URL'e kapalı ortamlarda try/catch ile state-routing'e düşer.

| Path | Route | Min. izin |
|---|---|---|
| `/` | dashboard | — |
| `/leads` · `/lead/:id` · `/duplicates` | leads · lead · duplicates | `leads.view` |
| `/appointments` · `/appointment/:id` | appointments · appointment | `appts.view` |
| `/sms` · `/sms/:convId` | sms | `sms.view` |
| `/campaigns` | campaigns | `sms.campaign` |
| `/calls` · `/tasks` | calls · tasks | `calls.view` |
| `/reports` | reports | `reports.view` |
| `/studios` · `/studios/new` · `/studios/:id` | studios · studio · studio | `studios.view` |
| `/staff` · `/settings` · `/import` | staff · settings · import | `staff.view` · `settings.manage` · `leads.edit` |
| diğer her şey | notfound (gerçek 404 ekranı) | — |

---

## 6. SAYFA ENVANTERİ

### Login (`/` — oturum yokken her rota buraya düşer)
Sol: marka paneli (3 stüdyonun **canlı saatleri** + EQ barları, entegrasyon rozetleri). Sağ: 6 rol kartı
(tıkla → e-posta/şifre otomatik dolar, kapsam yazısı), hatalı girişte **shake animasyonu** + hata kartı.

### Dashboard
Gerçek **dönem karşılaştırmalı** KPI kartları (seçili pencerenin önceki eşdeğeriyle ▲▼ delta, `kpi-num`
tipografisi), 14 günlük Sparkline, "Top Channel", son leadler (SLA şeritli) + son çağrılar listesi.

### Leads Pipeline
Durum sekmeleri (14 callStatus, sayaçlı), arama (isim/e-posta/telefon/ID), sıralama (tarih/isim/çağrı),
sayfalama (10/sf), **SLA rozeti** (≤15dk yeşil · ≤60dk amber · >60dk yanıp sönen kırmızı), çağrı sayısı
butonu → **CallHistoryModal** (kayıt oynatıcı), not çekmecesi, **SmsCompose** çekmecesi (şablon kartları +
merge-field doldurma + segment sayacı + opt-out koruması), Convert to Booking, CSV export (`leads.export`),
DUP/OPT-OUT rozetleri, "Duplicate Merge" butonu. Tüm satır tıklanabilir; aksiyon hücreleri stopPropagation.

### Lead 360°
Başlık: avatar + durum dropdown (guard'lı) + platform/şube/dil pilleri. Kartlar: **Tattoo Brief**
(amaç/stil/boyut/bölgeler/hikâye), **Attribution** (gclid/fbclid/ttclid kopyalama butonlu),
**Call History** (ort. süre + dinleme), **Linked Appointment** (tıkla → randevu detayı),
**Activity Timeline** (çağrı+SMS+not birleşik), **Notes**. Aksiyonlar: Call (logCallback), Send SMS, Thread, Convert.

### Appointments
KPI şeridi (Pending/Confirmed/Deposit/Completed + no-show), durum filtre çipleri, sayfalama (10/sf),
çağrı sayısı + missed rozeti → tarihçe modalı, durum dropdown (`appts.edit` guard), notlar. Satır tıklanabilir.

### Appointment Detail
Aksiyon çubuğu: Confirm / Send SMS / Unreachable / Cancel (guard'lı). Tercih edilen slot kartı (müşteri
saat dilimiyle), iptal nedeni çipi (`cancelReason`), brief, çağrı geçmişi + dinleme, notlar, zaman çizelgesi.

### SMS Messenger (`/sms`)
İki panelli; sol liste **5 filtre** (All/Unread/**Needs reply**/Read/Opted-out, sayaçlı) + arama +
kademeli yükleme (15'er). Sağ: Twilio baloncukları (sent→delivered tik animasyonu), `scrollIntoView`
yerine kapsayıcı-içi scroll (sayfa kaymaz), opt-out'lu thread'de gönderim kilitli A2P uyarısı,
Enter ile gönderim, gönderince ~3sn sonra **simüle müşteri yanıtı**. Mobilde paneller yükseklik kısıtlı.

### SMS Campaigns
4 adımlı sihirbaz: **Audience** (şube+durum+platform segmenti, canlı alıcı sayacı, örnek isimler, opt-out
otomatik hariç) → **Message** (şablon + düzenlenebilir önizleme, segment × alıcı = toplam SMS) →
**Schedule** (şimdi/sonra) → **Review & Send**. Gönderimde kart üstünde animasyonlu teslimat
(İletildi/Başarısız/Yanıtlayan sayaçları 450ms'de akar), bitince toast. `sms.campaign` izniyle kilitli.

### Call Center Hub
**Live Floor**: doğan çağrılar (isim/numara/hat), çalarken EQ barları + saniye sayacı, "End" ile manuel
kapatma → çağrı günlüğüne düşer. **Event Stream**: answer/queue/end/voicemail/miss renk kodlu canlı akış.
**Needs a Callback**: missed+voicemail tekilleştirilmiş kuyruk → Call back (sonuç loglanır) + Create task.
**Call Log**: sonuç filtreleri (Answered/Missed/Voicemail/Attempted sayaçlı), sayfalama (12/sf),
kayıt oynatıcı (sentetik dalga formu + süre).

### Tasks
Açık görevler: vade çipleri (**Overdue** kırmızı/Due amber/30dk içinde yeşil, canlı sayacı), atanan agent,
"Tamamla" → geri arama loglanır. Tamamlananlar (soluk, 6/sf). Yeni görev çekmecesi (lead seçici + agent + vade).

### Duplicate Merge (`/duplicates`)
Telefon/e-posta/isim+şube anahtarıyla gruplanmış kartlar. Her grupta: **ana kayıt** radyo seçimi,
alan bazında "şundan al" seçicileri (isim/e-posta/telefon/çağrı durumu), `mergeLeads` → diğer kayıtlar
silinir, ana kayda denetim notu düşer. `leads.merge` izniyle kilitli. Temiz listede yeşil durum kartı.

### Reports & Funnel
Dönem deltali 5 KPI, **Speed-to-Lead SLA** kartı (<5dk/5–15/15–60/>1sa/hiç dağılımı + %15dk uyum skoru),
**gün×saat ısı haritası**, **Ops Pulse** (no-show oranı, randevu başına çağrı, ort. görüşme, SMS thread),
dönüşüm hunisi (drop-off rozetli), platform donut (SVG), kampanya tablosu + CSV export, stüdyo liderlik tablosu.

### Studios & Branches
Kartlar: fotoğraf (6 şubede üretilmiş görsel) veya monogram fallback, **şube marka aksanı**, canlı saat,
lead/randevu sayaçları, Vonage ext + Twilio SID rozetleri, booking toggle (`studios.edit` guard),
Edit → `/studios/:id`. Add Studio → `/studios/new`. Arama + ülke filtresi, displayOrder sıralaması.

### Edit Booking Location (route tabanlı detaylı form)
6 kart: **General** (görsel, booking slug + canlı `/{slug}/book` önizlemesi, adres blur'da **otomatik GPS**,
public phone, GTM, maps URL, timezone, display order, interval, online booking) · **Social Media** (5 URL) ·
**Twilio & SMS** (SID'ler, auth token maskeli, specific phone, SMS automation, Call Tracking kilitli) ·
**Vonage** (DID + extension + yönlendirme diyagramı) · **Mail & SMTP** (tam SMTP config + **Test SMTP
Connection** butonu) · **Business Hours** (7 gün × checkbox + saatler, IANA tz başlıkta). Altta numara
kaydı (vonage/twilio/branch ekle/sil). "Unsaved changes" rozeti + Save All Changes.

### Staff & Access Control
3 sekme: **Team** (rol rozetleri + filtre, üye ekle/düzenle çekmecesi — rol kartı seçici + şube kapsamı
seçici + **Hesap durumu** Aktif/Pasif; pasif satır soluk + kilit ikonu), **Artists** (sanatçı kartları +
Vonage extension dizini, canlı saatler), **Permissions** (rol kartları + **interaktif yetki matrisi**:
gruplu, Super Admin sütunu kilitli, tıklayınca grant/revoke + toast).

### Settings & API Keys
6 entegrasyon kartı (Vonage/Twilio/Timely/Meta/Google/TikTok — key maskeleme/gösterme, kopyalama,
Rotate), canlı **Webhook Activity** akışı (6sn'de yeni event), Console Preferences (tarih aralığı,
otomatik atama, SMS sesi, günlük digest), Danger Zone (kilitli yıkıcı işlemler).

### CSV Import (`/import`)
İki dropzone: Leads CSV + Appointments CSV (sürükle-bırak ya da tıkla-seç; **";" ayraç + RFC-4180 quote**
otomatik algılama). "4 Eylül örnek export'unu yükle" butonu gerçek production verisini basar. Dosya
çözümlenince: satır/kolon/uyarı sayaçları, **otomatik stüdyo üretimi** listesi, kolon eşleme tablosu,
5 satırlık önizleme. "Import everything" → 5 aşamalı progress (stüdyolar → leadler → randevular →
çağrı logları) → upsert (aynı ID güncellenir, yeniden eklenmez).

---

## 7. UÇTAN UCA ÇALIŞMA AKIŞLARI

1. **Lead intake → SLA → randevu**: Booking formu lead'i oluşturur (`callStatus: not_called`) → SLA
   rozeti geri sayar (15dk hedef) → agent arar (`logCallback` → Answered/Attempted loglanır) → durum
   `interested` → **Convert to Booking** (`convertLead` RPC karşılığı) → randevu `pending` + lead
   `appointment_made`+`done` → Confirm SMS → `confirmed` → `completed`.
2. **Gelen çağrı**: Vonage Events → Live Floor'da doğar (toast + queue event) → 3.8sn çalma → agent
   bağlanır (answer event) → 55sn'de ya da "End" ile kapanır → CallLog'a recording'li yazılır →
   sync rozeti tazelenir. Cevapsızsa **Needs a Callback** kuyruğuna düşer.
3. **SMS otomasyon**: Şablon seç → merge-field'lar dolar → Twilio kuyruğu (sent→delivered) → müşteri
   yanıtı thread'e düşer (unread +1) → opt-out gelirse thread kilitlenir (A2P 10DLC).
4. **Kampanya**: Segment tanımla → alıcılar sayılır (opt-out hariç) → gönder → 450ms'lik tick'lerle
   teslimat akar → bitince `sent` + toast.
5. **Merge**: Duplicate dedektörü gruplar → ana kayıt + alan kaynakları seçilir → diğerleri soft-silinir,
   aktivite ana kayıtta kalır, denetim notu yazılır.
6. **CSV import**: BookNow export'u düşer → parser kolonları eşler → bilinmeyen stüdyolar üretilir →
   lead/randevu upsert + voice-call logları sentezlenir → pipeline'da görünür.

---

## 8. CANLI SİMÜLASYON ZAMANLAMALARI (store.tsx)

| Döngü | Periyot | Davranış |
|---|---|---|
| Çağrı doğurma | 14sn | ≤5 canlı çağrı; toast + queue event |
| Çalma→bağlanma | 800ms kontrol | 3.8sn sonra ringing=false + answer event |
| Otomatik kapatma | 3sn kontrol | 55sn'de loga düşer (Answered) |
| Ambient event | 10sn | voicemail / missed (yeniden yönlendirildi) |
| Kampanya teslimatı | 450ms | adım 1–3 iletilir, %12 başarısız, yanıtlar birikir |
| Webhook feed (Settings) | 6sn | yeni event üste, 7 kayıt sınırı |
| SLA/Due sayaçları | 30sn | rozetler canlı güncellenir |

---

## 9. i18n MİMARİSİ

- Çağrılar: `t("English string")` (gettext tarzı, EN kimlik) + `tf("{n} leads", {n})` interpolasyon.
- Kaynak zinciri: **`GET /api/v1/locales/tr.json`** (aynı origin — `public/` altında, ~300 anahtar) →
  başarısızsa **localStorage cache** → o da yoksa gömülü **TR_SNAPSHOT**. Sidebar rozeti kaynağı gösterir
  ("Uzak servis / Önbellek / Çevrimdışı kopya" + anahtar sayısı).
- Dil tercihi localStorage `cleo-lang`; topbar EN/TR anahtarı; `document.lang` güncellenir.
- **Repo içinde JSON dil dosyası bağımlılığı yok** — `public/`teki dosya servis çıktısıdır, oradan yönetilir.
- Store içinde üretilen stringler (event stream, toast) de `t/tf` ile çevrilir.

---

## 10. BACKEND SÖZLEŞMESİ (backend/)

`schema.sql` (Supabase-uyumlu, çalıştırılabilir): `leads`, `appointments`, `calls`, `sms_conversations`,
`sms_messages`, `campaigns`+`campaign_recipients`, `tasks`, `notes`, `locations` (config JSONB'leri:
social/twilio/vonage/smtp/hours), `numbers`, `artists`+`artist_locations`, `extensions`, RBAC üçlüsü
(`roles`/`permissions`/`role_permissions` + `profiles` + `location_scopes`), `workspace_settings`,
`integrations` (şifreli secret), `vonage_events`, `webhook_deliveries` (idempotent), `translations`,
`audit_log`. Kısmi indeksler (SLA, aktif lead, telefon), `updated_at` trigger'ları, `can()`/`in_scope()`
güvenlik fonksiyonları, **`convert_lead()` ve `merge_leads()` RPC'leri**, tablo bazlı RLS politikaları,
`DEFAULT_MATRIX` ile eşleşen seed.

Tasarım kararları: para **integer cent**, telefon **E.164**, merge **soft-delete** (`merged_into`),
webhook'lar unique kolonlarla retry-güvenli, SPA Vonage/Twilio'ya **asla doğrudan dokunmaz** — her yan
etki Edge Function'dan geçer. `README.md`: 4 webhook alıcısı, 5 worker (kampanya, SLA monitörü, duplicate,
win-back, digest), 6 akış diyagramı, §2.1'de **frontend tipi → tablo** birebir eşleme tablosu.

---

## 11. BİLEŞEN KİTİ KURALLARI (ui.tsx)

- **Btn**: `variant` (gold/ghost/outline/danger), `locked` prop'u kilit ikonu + aria-label ekler.
- **Dropdown**: portal ile `document.body`'ye render edilir (tablo `overflow`'u kırpmaz), trigger
  koordinatından ölçülür, altta yer yoksa **yukarı açılır**, scroll/resize takip eder.
- **Pagination**: tüm listelerde ortak (aralık göstergesi + 5'li pencere + önceki/sonraki).
- **SlaBadge**: `createdAt+called` alır; ok/uyarı/ihlal durumunu canlı hesaplar.
- **Modal/Drawer**: sağdan/katlanarak girer; ikon butonlarında aria-label zorunlu.
- İkonlar: `I name="…"` — elle çizim 1.5px stroke SVG seti (logOut, shield, lock, merge dahil).

---

## 12. BİLİNEN KISITLAR & YOL HARİTASI

**Kısıtlar:** kalıcılık yok (mock), kayıt oynatıcı sessiz (sentetik görsel), geocoding/SMTP testi
tiyatro, bundle tek parça (~470KB lazy-load'suz), test yok, mobilde tablolar yatay scroll.

**Sıradaki (onaylı plan):** Sprint 1: toplu işlemler + ⌘K komut paleti + bildirim merkezi ·
Sprint 2: Wallboard modu + gerçek ses + koyu konsol teması · Sprint 3: rezervasyon takvimi +
gelir/kapora modeli (deposit/price/paid) + rapor derinliği (cohort, ROI, sanatçı utilizasyonu) ·
Sürekli: lazy-load, mobil kart görünümleri, Vitest, PWA, a11y geçişi.

**Para birimi kuralı:** gelir modeli geldiğinde her yerde **integer cent** kullanılacak (schema hazır).

---

*Son doğrulama: 53 modül, sıfır hata build. Oturum, yetki, kapsam, rotalama, i18n ve tüm modüller çalışır durumda.*
