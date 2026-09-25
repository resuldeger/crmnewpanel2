# Sonraya bırakılanlar

Bilerek ertelenen işler. Her madde neden beklediğini ve devam etmek için
neyin gerektiğini söyler.

Son güncelleme: 2026-09-24

---

## 0. ⚠️ Vonage kimlik bilgilerini DEĞİŞTİRİN  🔴 sizde, acil

`src/server/vonage/visWebhook.ts` içinde canlı VBC kimlikleri koda gömülüydü:
consumer key, consumer secret, kullanıcı adı ve **hesap parolası**.
`.env.example` dosyasında da aynı bilgiler duruyordu ve o dosya commit'e
hazırdı.

Koddan ve `.env.example`'dan temizlendi; git geçmişine **girmemiş**
(`git log -S` ile doğrulandı). Ama değerler artık kabuk geçmişinde ve bu
oturumda görünmüş durumda.

**Yapılacak:** Vonage panelinden dördünü de yenileyin, yeni değerleri
yalnızca `.env.local` dosyasına yazın:
`VONAGE_CONSUMER_KEY`, `VONAGE_CONSUMER_SECRET`, `VONAGE_PASSWORD`,
`VONAGE_SIGNATURE_SECRET`.

Ayrıca `registerVisWebhook` sabit bir `"cleopatra_secure_vis_secret"` imza
anahtarıyla kayıt yapıyordu — herkesin okuyabildiği bir sırla doğrulanan
imza, doğrulama sayılmaz. Artık `VONAGE_SIGNATURE_SECRET` yoksa kayıt
yapmayı reddediyor.

---

## 1. Vonage — dahili / numara yapısı  ✅ çözüldü (2026-09-25)

Provisioning API source-of-truth oldu:
`/t/vbc.prod/provisioning/v1/api/accounts/{id}/extensions` → `_embedded.extensions`.

**84 dahili** bulundu (bizde 34 vardı), 50'si tabloya eklendi. 12 tanesi
çağrı merkezi koltuğu, 42'si şubeye eşleşti.

Eşleşme DID → isim → bitişik-isim sırasıyla deneniyor. DID tek başına 33
şubeyi boşta bırakıyordu çünkü `locations.branch_phone` çoğunda boş.

**Eksik 8 şube eklendi** (2026-09-25): Bradenton, Fort Pierce, Orlando,
St. Augustine, Fort Sill, Scottsdale, JBLM, Rochester. Saat dilimleri
DID alan kodundan doğrulandı — Scottsdale `America/Phoenix` (yaz saati yok),
Fort Sill `America/Chicago`, JBLM `America/Los_Angeles`, kalanı Eastern.

Hepsi **`booking_active = false`**: adres ve çalışma saatleri elimizde yok.
Saati olmayan bir şube randevuya açılsa her günün her slotunu boş gösterirdi.
Bilgileri girilince açılmalı. `scripts/add-missing-studios.ts`

Eşleşmeyen kalan tek grup kişisel dahililer (Hakan Goncu, Ozan Sen) — doğru
davranış.

`vonage-directory` işi saatte bir tazeliyor. `staffId` asla ezilmiyor —
onu konsolda insan atıyor, Vonage'ın fikri yok.

---

## 2. CSV içe aktarma  ⏸ örnek veri bekliyor

**Durum:** `importCsvData` dosyayı okuyup ekranda gösteriyor ama **veritabanına
yazmıyor** — yenileyince gidiyor.

**Söylediğiniz:** örnek DB'yi verince tek seferde yapılacak.

**Gerekenler:** örnek CSV / DB dökümü.

**Not:** İçe aktarma şube eşleştiricisi artık yalnızca gerçek şubelere
bakıyor; önce demo şubelerle besleniyordu ve fixture şehri adı geçen satır
var olmayan bir şubeye yazılıyordu.

---

## 3. Canlı aramayı sonlandırma  ✅ yapıldı (2026-09-25)

Yalnızca **super_admin**, yalnızca onay modalıyla.
`POST /api/crm/calls/live/{callId}/hangup`

Yetki testi: oturumsuz 401, `hq_admin` (calls.manage yetkisi olmasına
rağmen) 403.

**Doğrulanmamış tek şey:** Vonage'ın `actions` ucuna gönderilen gövde
(`{"action":"hangup"}`). `GET /actions` 404 dönüyor, şekli öğrenmenin tek
yolu gerçekten POST atmak — yani canlı bir müşteri görüşmesini kesmek.
Yapmadım. Reddedilirse Vonage'ın kendi mesajı operatöre aynen gösteriliyor,
başarı gibi yutulmuyor. İlk gerçek kullanım aynı zamanda test olacak.

### Eski not

**Durum:** Yalancı "End" düğmesi kaldırılmıştı. Sadece o tarayıcının state'inden
siliyordu; pano artık Telephony poller'ından beslendiği için satır iki
saniye sonra geri geliyordu — yani düğme açıkça yalan söylüyordu.

**Mümkün:** Her çağrı `actions_uri` taşıyor
(`/v3/cc/accounts/{id}/calls/{callId}/actions`), yani gerçekten kapatılabilir.

**Neden yapmadım:** Bu, konuşmakta olan bir müşterinin telefonunu kapatmak
demek. İstemediğiniz bir düğmeye bağlamadım. İsterseniz eklerim.

---

## 4. Raporlar sunucuya taşındı  ✅ bitti (2026-09-24)

`/api/crm/reports` eklendi; `Reports.tsx` artık tarayıcıda toplama yapmıyor.

Taşıma sırasında çıkan üç şey:
- **Isı haritası yanlıştı.** Saat kovaları `new Date().getHours()` ile,
  yani *bakan kişinin* saat diliminde hesaplanıyordu. Aynı Seattle lead'i
  İstanbul'dan bakınca başka hücreye düşüyordu. Artık her şube kendi yerel
  saatinde gruplanıyor.
- **"Answer Rate" farkı sabit 71'e karşı** hesaplanıyordu — nereden geldiği
  belli olmayan bir sayı. Artık gerçek önceki döneme karşı.
- **"Avg First Response" ölçüm değildi**, `24 - leadSayısı / 3` formülüydü.
  Artık ilk arama gecikmesinin medyanı (ortalama değil: üç gün sonra dönülen
  tek bir lead ortalamayı anlamsızlaştırıyor).

Ayrıca `days=abc` her iki uçta da 500 veriyordu (`Math.max(1, NaN)` = NaN →
Invalid Date). Ortak `parseDays` ile düzeltildi.

---

## 5. Dış bağlantılar  ⏸ sizde

| Ne | Nereden | Ne için |
|---|---|---|
| Vonage **Signature secret** | Vonage panel → Account Settings → Signed webhooks | Webhook imzası; yoksa üretimde istek reddedilir |
| Sabit **stage alan adı** | `stage.booknow.cleopatraink.com` | Webhook denemesi; ngrok URL'i her yeniden başlatmada değişiyor |
| 6 şubenin Twilio DID'i | charlotte, columbus-ga, denver, destin, lynnwood, san-francisco | Gelen aramanın şube hattına yönlendirilmesi. SMS zaten Messaging Service ile gidiyor, DID gerekmiyor |
| ~~12 şubenin Vonage dahilisi~~ | ✅ Provisioning'den geldi (2026-09-25). Kalan 3: **denver, spokane, west-palm-beach** — Vonage'da bu isimlerde dahili *hiç yok*. Kapandılar mı, başka adla mı kayıtlılar? | Arama ↔ şube eşlemesi |
| 4 şubenin telefonu | charlotte, denver, san-francisco, spokane | Yönlendirme hedefi |

Üçü de canlı veritabanında da boştu — oradan gelmiyor.

---

## 5b. `test-branch` şubesi  🔴 iki sorun, karar sizde

`locations` #46, slug `test-branch`. İçinde hiç lead/randevu/çağrı yok.

**1. Randevuya açık.** `booking_active = true`, yani `/test-branch/book`
adresini bulan bir ziyaretçi sahte bir şubeye gerçek randevu alabilir.

**2. Telefonu Atlanta ile aynı:** ikisi de `+14703440356`.
`studioForInboundNumber` `limit(1)` kullanıyor, yani Atlanta'ya gelen bir
çağrının hangi şubeye yazılacağı belirsiz.

**Önerim:** `booking_active = false` yapıp telefonu boşaltmak. Silmek de
olur ama karar sizin — dokunmadım.

---

## 6. Timely — ölü feed'ler  ⏸ karar bekliyor

**Durum:** 127 sanatçı takviminden **31'i HTTP 404** veriyor. Link yenilenmiş
ya da personel ayrılmış.

**Etkisi:** 19 aktif şube Timely verisi olmadan çalışıyor — o şubelerde her
slot boş görünüyor. Kapasite 2 olduğu için en fazla 1 web randevusu alınır,
yani felaket değil, ama Timely doluluğu görünmüyor.

**Seçenekler:**
1. Linkleri Timely panelinden elle almak (`/Settings/StaffEdit/{id}`)
2. Sadece link yenilemek için küçük bir kazıyıcı yazmak

Laravel'deki `syncStaffDetails()` bunu kazıyarak yapıyordu; kazıma katmanını
almadım çünkü en kırılgan yer orası (kendi kodunuzda Cloudflare 403 retry'ları
ve "scraping başarısızsa varsayılan saat" fallback'leri var).

---

## 7. Ölü demo sabitleri  ✅ bitti

`src/data.ts`'ten silindi (−362 satır).

---

## Realtime çağrı takibi  ✅ çalışıyor (2026-09-25)

**Telephony v3** hesap genelinde aktif çağrıları veriyor:
`GET /t/vbc.prod/telephony/v3/cc/accounts/{id}/calls`

Gateway (`npm run realtime`) içinde **tek merkezi poller**, 2 saniyede bir.
Browser başına polling yok. Diff üretip `calls:live` kanalına basıyor;
veritabanına yazmıyor, çünkü kalıcı kayıt zaten Reports'tan geliyor.

Ölçülen: 3 dakikada 6 CALL_STARTED, 10 CALL_UPDATED, 4 CALL_ENDED, 0 hata.
Yaşam döngüsü `initializing → ringing → on-call → disconnected → ended`.

**Reconciliation çözüldü:** Telephony `call_id` ile Reports `id` **aynı**.
Doğruladım — poller'ın gördüğü iki çağrı Reports'ta aynı ID ile bulundu.
`uniq_call_external` indeksi sayesinde kendiliğinden birleşiyorlar.

**Neden webhook değil:** VIS webhook'u `self` scope'unda, yani kimin
kimliğiyle kaydedilirse onun çağrılarını gönderiyor. Ölçtüm: 5 dakikada 25
çağrı gerçekleşti, sıfır webhook düştü. Kayıt `totalAttempts: 0` ile
duruyordu, yani hiç denenmemiş bile. **Silindi** (2026-09-25).
`scripts/vonage-webhook.ts` gerekirse duruyor.

Env: `VONAGE_TELEPHONY_ENABLED`, `VONAGE_POLL_MS` (2000),
`VONAGE_DIRECTORY_TTL_MS` (15 dk), `VONAGE_API_HOST`, `VONAGE_AUTH_HOST`.

**Tüm zaman ayrıştırma tek yerde:** `src/server/vonage/time.ts`. Vonage üç
ayrı şekilde zaman veriyor ve ikisi `new Date()`'i yanıltıyor — Reports
zonesuz UTC (yerel sanılır), Telephony mikrosaniye string (56.000 yılına
düşer), webhook'lar ISO 8601. Tek ayrıştırıcı üçünü de tanıyor, on vaka
için test edildi.

**Tüm uçlar tek yerde:** `src/server/vonage/endpoints.ts`. Üç farklı host
üç modüle dağılmıştı.

**Performans:** `vonageSync` kayıt başına 3 sorgu atıyordu; 1000 satırlık
sayfada 3000 gidiş-dönüş. Toplu sorguya çevrildi — 9.828 çağrı 49 saniyede
içeri alındı. Poller da 2 saniyede bir gereksiz `integrations` yazması
yapıyordu; 60 saniyelik ölçümde artık 0.

**Bilinmeyen:** Vonage bu uç için rate limit yayınlamıyor. 2 saniye =
30 istek/dk. 429 ve 5xx'te exponential backoff + jitter var, üst sınır
5 dakika.

**Yol boyunca çıkan bir kusur:** `vonageAccessToken()` her çağrıda yeni
token alıyordu, önbellek yoktu. Poller 2 saniyede bir sorduğu için bu
**dakikada 30 giriş denemesi** demekti — hesabı kilitleyen davranışın
aynısı, üstelik token 24 saat geçerliyken. Poller logunda görünen tek
401'in sebebi de buydu. Token artık bitimine 5 dakika kalana kadar
tutuluyor, eşzamanlı istekler tek grant'i paylaşıyor, 401'de önbellek
temizleniyor.

---

## Vonage webhook — açılınca ne yapılacak

Hat hazır ve prova edildi. Vonage erişimi açıldığında:

1. `npm run tunnel` → ngrok URL'ini al.
2. Webhook'u kaydet (`registerVisWebhook`). `VONAGE_SIGNATURE_SECRET`
   ayarlı değilse kayıt yapmayı reddeder — bu kasıtlı.
3. Gerçek bir arama yap. Konsolda şu satır çıkacak:
   `vonage/call: signature verified via <şema>`

**Açık soru şu:** VIS'in HMAC'i *neyin üzerinde* hesapladığı. İmza
payload'ın içinde (`metadata.signature`) taşındığı için, imzalanan gövde
gönderilen gövdeden farklı olmak zorunda. Üç olasılık var: ham gövde,
imza alanı boşaltılmış gövde, imza alanı çıkarılmış gövde. Üçünü birden
deniyoruz ve hangisinin tuttuğunu yazıyoruz — tek gerçek webhook cevabı
kesinleştirir. Elinizde Vonage'ın imza dokümanı varsa tahmin etmeye gerek
kalmaz.

Eşleşme olmazsa (geliştirmede) her adayın ne üreteceği loglanır, yani
gelen imzayla karşılaştırıp şemayı oradan okuyabiliriz.

Vonage olmadan hattı sınamak için:

```
npm run test:vonage
TEST_VONAGE_LINE=+14703440356 npm run test:vonage   # şube çözümlemesiyle
npm run test:vonage -- https://<ngrok>.ngrok-free.app
```

Prova satırları her çalıştırmada temizlenir, gerçek çağrı kaydına
karışmaz.

---

## Aklınızda olsun

**`SMS_TRANSPORT=twilio` açık.** Test ederken gerçek SMS gidiyor. Kapatmak
için `.env.local` içinde `log` yapın.

**`TIMELY_SYNC_ENABLED=1` açık.** 30 dakikada bir 102 canlı takvim çekiliyor.

**Vonage webhook tanılama günlüğü** artık yalnızca geliştirmede çalışıyor
(`VONAGE_DEBUG_LOG=0` ile susturulur) ve `Authorization` JWT'si ile diğer
kimlik başlıkları maskeleniyor. Üretimde hiç yazmıyor — müşteri telefon
numaraları düz dosyada birikmesin diye.

**`PUBLIC_BASE_URL=http://localhost:3000`.** Davet linkleri ve webhook
callback'leri bundan üretiliyor; canlıya çıkarken gerçek alan adı girilmeli.
Twilio, ulaşılamayan bir StatusCallback yüzünden mesajın tamamını reddediyor
— o yüzden localhost'ta callback hiç gönderilmiyor.
