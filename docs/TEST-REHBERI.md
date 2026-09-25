# Test Rehberi

## Sistemi kaldırma

```bash
npm run db:up    # postgres · redis · adminer · pgadmin · redisinsight
npm run dev      # her şey                  → :3000
npm run worker   # otomasyon kuyruğu        → her 15 sn
```

**Tek port.** Rezervasyon motoru, halka açık sayfalar ve yönetim paneli
aynı sunucuda:

| Adres | Ne |
|---|---|
| `/` | Stüdyo seçimi (dil algılamalı) |
| `/{slug}/book` | Rezervasyon sihirbazı |
| `/{slug}/book/{adim}` | `purpose · style · story · placement · size · when · contact · pickup` |
| `/{slug}/book/done/{uuid}` | Onay |
| `/b/{uuid}` | Randevu yönet / ertele / iptal |
| `/admin` | CRM konsolu (giriş şart) |

---

## İnsanlara verilecek URL'ler

### Atlanta (Eastern · America/New_York)
| Amaç | URL |
|---|---|
| Normal / organik giriş | `http://localhost:3000/atlanta/book` |
| **Reklamdan gelmiş gibi** (önce iletişim sorar) | `http://localhost:3000/atlanta/book?utm_source=instagram&utm_medium=stories&utm_campaign=eylul_atlanta` |
| Google Ads simülasyonu | `http://localhost:3000/atlanta/book?utm_source=google&utm_medium=cpc&gclid=TEST_ATL_001` |
| Türkçe | `http://localhost:3000/atlanta/book?lang=tr` |
| Almanca | `http://localhost:3000/atlanta/book?lang=de` |
| VIP transfer adımı açık | `http://localhost:3000/atlanta/book?free_pick=1` |

### Tacoma (Pacific · America/Los_Angeles)
| Amaç | URL |
|---|---|
| Normal giriş | `http://localhost:3000/tacoma/book` |
| Reklamdan gelmiş gibi | `http://localhost:3000/tacoma/book?utm_source=facebook&utm_medium=cpc&fbclid=TEST_TAC_001` |
| İspanyolca | `http://localhost:3000/tacoma/book?lang=es` |

> **Neden bu iki şube:** Atlanta Eastern, Tacoma Pacific. Aynı saati seçip ikisinin
> `starts_at` değerine bakarsan saat dilimi hesabının gerçekten çalıştığını görürsün.

### Diğer sayfalar
| Sayfa | URL |
|---|---|
| **Halka açık ana sayfa** (stüdyo seçimi, dil algılamalı) | `http://localhost:3000/` |
| Randevu yönetimi | `http://localhost:3000/b/{BK-KODU}` — rezervasyon sonrası verilir |
| 404 | `http://localhost:3000/olmayan-sayfa` |

### Yönetim arayüzleri (yalnızca senin makinen, giriş şart)
| Araç | URL | Giriş |
|---|---|---|
| **CRM konsolu** | **http://localhost:3000/admin** | `seed/credentials.txt` |
| pgAdmin — görsel ERD | http://localhost:8082 | `.env` içindeki `PGADMIN_EMAIL` / `PGADMIN_PASSWORD` |
| Adminer — hızlı SQL | http://localhost:8081 | sunucu `postgres`, kullanıcı `cleo`, parola `.env` içinde |
| RedisInsight | http://localhost:5540 | host `redis`, port `6379` |

> Tüm portlar `127.0.0.1`'e bağlı — yerel ağdan erişilemez.
> Başka bir cihazdan test ettirecekseniz aşağıya bakın.

---

## Test senaryoları

### 1. Yarıda kalan istek → lead → kurtarma SMS'i
1. `…/atlanta/book?utm_source=instagram` aç
2. **Start Journey** → ilk ekran **İletişim** olmalı (reklam trafiği kuralı)
3. Ad / e-posta / telefon gir, SMS onayını işaretle
4. **Sekmeyi kapat** (tamamlama)
5. Kontrol:
```bash
npm run db:psql
```
```sql
select id, name, source, call_status, converted_at is null as hatta from leads;
select kind, status, scheduled_at from scheduled_messages order by scheduled_at;
```
6. 5 dakika beklemeden görmek için vakti öne al, worker'ın loguna bak:
```sql
update scheduled_messages set scheduled_at = now() - interval '1 min' where kind='lead_recovery_5m';
```

### 2. Tamamlanan randevu → lead hattan çıkar
1. Aynı oturumda devam edip randevuyu bitir
2. Kontrol:
```sql
select id, call_status, lifecycle_status, converted_at is not null as donustu from leads;
select count(*) as hatta_kalan from lead_pipeline;          -- 0 olmalı
select kind, status, cancel_reason from scheduled_messages; -- kurtarma = cancelled/booked
```
3. Onay SMS'i worker/`npm run dev` konsolunda görünür (gerçek SMS gönderilmez)

### 3. Saat dilimi
Atlanta ve Tacoma'da **aynı tarih ve saati** seç, sonra:
```sql
select a.bk_uuid, l.slug, a.preferred_time, a.display_timezone, a.starts_at
  from appointments a join locations l on l.id = a.location_id;
```
Aynı yerel saat, farklı UTC instant olmalı (3 saat fark).

### 4. Çift rezervasyon
İki sekmede aynı slotu seç, ikisini de gönder → ikincisi **409**.

### 5. Dil
Sağ üstteki bayrak → Türkçe / Español / Deutsch. Sayfa yenilendiğinde tercih korunur.
Desteklenmeyen dil: `?lang=fr` → İngilizce döner ama yanıt `fallbackUsed: true` der.

### 6. Rotalama
Adımlar arasında ilerle, **tarayıcı geri tuşuna** bas — bir önceki adıma dönmeli, siteden çıkmamalı.
Herhangi bir adımda **yenile** — aynı adımda kalmalı.

### 7. Çağrı yönlendirme (Twilio simülasyonu)
```bash
python3 - <<'EOF'
import base64, hashlib, hmac, urllib.parse
token = "atlanta_test_token"
url = "http://127.0.0.1:3000/api/webhooks/twilio/voice"
params = {"To": "+14045550199", "From": "+14155551234", "CallSid": "CATEST001"}
payload = url + "".join(k + params[k] for k in sorted(params))
print("SIG:", base64.b64encode(hmac.new(token.encode(), payload.encode(), hashlib.sha1).digest()).decode())
print("BODY:", urllib.parse.urlencode(params))
EOF
```
Çıkan değerlerle:
```bash
curl -s -X POST http://127.0.0.1:3000/api/webhooks/twilio/voice \
  -H "X-Twilio-Signature: <SIG>" -d "<BODY>"
```
→ TwiML `<Dial>` ile `+14045550100` (Atlanta şube hattı) dönmeli.
İmzayı boz → **403**.

### 8. Elle SMS gönderme
```bash
TOKEN=$(grep INTERNAL_API_TOKEN .env.local | cut -d= -f2)
curl -s -X POST http://127.0.0.1:3000/api/sms/send \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"to":"+14045559999","location_id":1,"body":"Merhaba, Atlanta subesinden yaziyoruz.","sender_name":"Tara S."}'
```
Token'sız → **401**. Opt-out edilmiş numaraya → **409**.

---

## Başka bir cihazdan test ettirmek

Varsayılan olarak her şey yalnızca senin makinende. Aynı ağdaki bir telefondan
denetmek istersen:

```bash
# 1. Tek sunucuyu ağa aç
npm run dev -- -H 0.0.0.0

# 2. Makinenin IP'sini öğren
ipconfig getifaddr en0
```
Sonra telefondan: `http://<IP>:3000/atlanta/book`

> Yönetim arayüzlerini (pgAdmin / Adminer / Redis) **açma**. Onlar loopback'te kalmalı.
> İnternete açman gerekirse `cloudflared tunnel --url http://localhost:3000` gibi bir
> tünel kullan; portu doğrudan yönlendirme.

---

## Gerçek SMS gönderme (dikkat)

`.env.local` içinde `SMS_TRANSPORT=log` — hiçbir şey gönderilmez, mesajlar konsola yazılır.
Gerçekten göndermek için `SMS_TRANSPORT=twilio` yapıp şubenin gerçek Twilio bilgilerini
girmen gerekir. **Test sırasında bunu yapma**: kurtarma zinciri 3 mesaj gönderir.

---

## Telefondan test (tünel)

Geliştirme sunucusu (`npm run dev`) tünel üzerinden **çok yavaştır** — Next dev modu
sıkıştırılmamış JavaScript, HMR ve source map gönderir. Ölçüm:

| | dev | production |
|---|---|---|
| Transfer | 1835 KB | **185 KB** |
| Yükleme | 7.5 sn | **2.3 sn** |

Telefondan bakacaksan **production build** kullan:

```bash
npm run start:prod   # next build && next start
```
```bash
npm run tunnel       # ngrok http 3000
```

> `next start` sıcak yeniden yükleme yapmaz. Kod değiştirdikten sonra tekrar
> `npm run start:prod` çalıştır. Geliştirirken `npm run dev` yeterli — dev modu
> yalnızca tünel üzerinden yavaş, `localhost`'ta hızlı (60 ms).

### Tünelde yönetim paneli kapalı
Tünel tüm origin'i internete açar. `src/middleware.ts` `/admin`, `/api/crm/*` ve
`/api/auth/*` yollarını yalnızca `ADMIN_ALLOWED_HOSTS` listesindeki (varsayılan: loopback)
host'lara açık tutar; tünelden **404** döner. Public rezervasyon akışı etkilenmez.

Tünel adresini yönetim için de kullanman gerekirse `.env` içine ekle:
```
ADMIN_ALLOWED_HOSTS=abc123.ngrok-free.app
```

## Webhook adresleri

Sağlayıcı panellerine girilecek URL'ler (`PUBLIC_BASE_URL` ile):

| Sağlayıcı | Olay | URL |
|---|---|---|
| Twilio | Gelen arama | `POST /api/webhooks/twilio/voice` |
| Twilio | Arama durumu | `POST /api/webhooks/twilio/voice/status` |
| Twilio | Gelen SMS | `POST /api/webhooks/twilio/inbound` |
| Twilio | SMS teslim durumu | `POST /api/webhooks/twilio/status` |
| Vonage | Gelen arama (Answer URL) | `GET/POST /api/webhooks/vonage/answer` |
| Vonage | Arama yaşam döngüsü (Event URL) | `POST /api/webhooks/vonage/event` |
| Vonage | Kayıt hazır | `POST /api/webhooks/vonage/recording` |

Hepsi imza doğruluyor. Twilio HMAC-SHA1 (`X-Twilio-Signature`), Vonage
HS256 JWT (`Authorization: Bearer`) + `payload_hash` gövde bağı.
İmzasız veya bozuk istek 403 alır ve `webhook_deliveries`'e
`signature_valid=false` olarak yazılır — sessizce düşmez.
