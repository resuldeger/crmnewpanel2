# Sonraya bırakılanlar

Bilerek ertelenen işler. Her madde neden beklediğini ve devam etmek için
neyin gerektiğini söyler.

Son güncelleme: 2026-09-28

## Açık işler — tek bakışta

🔴 = biz devam edemiyoruz, sizde · ⏸ = veri/karar bekliyor · 🟡 = bizde, sırada

Rakamlar 28 Eylül'de veritabanından ölçüldü, önceki listeden kopyalanmadı.

| | Ne | Neden bekliyor |
|---|---|---|
| 🔴 | **Vonage kimlikleri yenilenecek** | Kabuk geçmişinde göründü (madde 0) |
| 🔴 | `VONAGE_SIGNATURE_SECRET` hâlâ `local_test_secret_abc123` | Doğruladım, değişmemiş. Üretimde webhook imzası doğrulanamaz |
| 🔴 | **Vonage CPaaS hesabı bloklu** | Tarayıcıdan arama bunsuz olmuyor (madde 11) |
| ⏸ | **CSV içe aktarma veritabanına yazmıyor** | Örnek DB bekliyor. Şu an **0 müşteri, 0 lead, 0 randevu** (madde 2) |
| ⏸ | **31/126 Timely feed'i 404** | Linkler elle mi yenilenecek, kazıyıcı mı (madde 6) |
| ⏸ | Timely entegrasyonu yanlış olabilir | Siz Excel indirip parse ediyorsunuz, biz iCal çekiyoruz |
| ⏸ | **8 şube yarım** | bradenton, fort-pierce, fort-sill, jblm, orlando, rochester, scottsdale, st-augustine — adres yok, saat yok, Twilio yok, randevuya kapalı |
| ⏸ | 2 şubenin adresi yok | charlotte, columbus-ga — randevuya açıklar, saatleri var, sadece adres eksik |
| ⏸ | 3 şubenin Vonage dahilisi yok | denver, spokane, west-palm-beach — Vonage'da o isimde dahili hiç yok |
| ⏸ | Canlı sunucudan ses kayıtları | `scripts/import-recordings.ts` hazır, dosyalar sizde |
| 🟡 | **Konsoldan arama kapalı** | Vonage ajanın olmadığı cihazı çaldırıyor (madde 12) |
| 🟡 | **Transkripsiyon servisi yok** | Kolon, index, CSV, oynatıcı hazır — yazan hiçbir şey yok |
| 🟡 | Giden çağrının telesekretere düşmesi ayırt edilemiyor | Transkripsiyona bağlı; Vonage "Answered" diyor |
| 🟡 | **1.592 gelen telesekreterin sesi elimizde değil** | Kapatıldı: "olduğu gibi bırak, sonra mail forward denenecek" (madde 13) |
| 🟡 | Hangup endpoint yolu doğrulanmadı | `/calls/{id}/actions` her şekilde gateway 404 veriyor |
| 🟡 | Migration'lar yalnızca yerel veritabanına uygulandı | Sunucuda `npm run db:migrate` koşacak |
| 🟡 | `todo-list.md` eski | İçindeki "eksik"lerin çoğu artık var (kampanya, duplicate merge, görev, audit) |

### 27–28 Eylül'de kapananlar

| Ne | Nasıl |
|---|---|
| İşçi servis olmalı | launchd (bu Mac) + systemd/pm2 sertleştirildi (madde 8) |
| `test-branch` şubesi | Zaten silinmişti, doğrulandı (madde 5b) |
| CCR izni `cleopatra.api`'ye | Gerek kalmadı, `ismaildilmec` ile devam |
| 6 şubenin Twilio DID'i | Artık yalnızca yarım kalan 8 şubede eksik |
| Vonage token'ı süreçler arası çakışıyordu | Redis'te paylaşılıyor (madde 9) |
| Reports token'ı dakikalar içinde reddediyordu | `vonageFetch` bir kez yenileyip tekrar deniyor (madde 14) |
| Entegrasyon durumu hiçbir yerde görünmüyordu | **Veri Kaynakları** ekranı (madde 10) |
| Geri arama zinciri bozuktu | Dört ayrı hata, hepsi düzeltildi (madde 12) |

## Bugünün durumu

```
çağrı        17.426     sesli  14.677  (%84)
şube             53     randevuya açık 45
dahili           85     50'si şubeye eşli
Timely          126 feed · 95 çalışıyor
müşteri           0     lead 0 · randevu 0   ← CSV bekliyor
transkript        0
```

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
| ~~6 şubenin Twilio DID'i~~ | ✅ 28 Eylül'de ölçüldü: 45/53 şubede var. Eksik 8 tanesi zaten yarım kalan şubeler (bradenton, fort-pierce, fort-sill, jblm, orlando, rochester, scottsdale, st-augustine) | Gelen aramanın şube hattına yönlendirilmesi |
| ~~12 şubenin Vonage dahilisi~~ | ✅ Provisioning'den geldi (2026-09-25). Kalan 3: **denver, spokane, west-palm-beach** — Vonage'da bu isimlerde dahili *hiç yok*. Kapandılar mı, başka adla mı kayıtlılar? | Arama ↔ şube eşlemesi |
| 2 şubenin adresi | charlotte, columbus-ga — randevuya açıklar, saatleri var, sadece adres eksik | Rezervasyon sayfasında gösterilecek |

Bunlar canlı veritabanında da boştu — oradan gelmiyor.

---

## 5b. `test-branch` şubesi  ✅ kaynaktan silindi (2026-09-29)

27'sinde silinmişti ama **geri geldi**: `seed/live-booking.json` içinde
duruyordu ve `npm run db:seed` onu tekrar yazdı. 29'unda canlı export'tan,
`scripts/seed.ts`'ten ve `scripts/timezones.ts`'ten kaldırıldı; artık seed
diriltmiyor (45 şube yazıyor, toplam 53).

Bir satırı silmek yetmiyor — üreten yeri de silmek gerekiyordu.

Birlikte gelen ikinci sorun da kalmadı: telefonu birden fazla şubede
tekrarlanan hiçbir numara yok, yani `studioForInboundNumber`'ın `limit(1)`'i
artık kime yazacağını bilmediği bir durum üretmiyor. (Şubelerin 49'unda
`branch_phone` dolu.)

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

## 8. Arka plan işçisi servis olarak çalışıyor  ✅ yapıldı (2026-09-27)

**Bu Mac'te:** `launchd`. `deploy/local/com.cleopatra.worker.plist` kuruldu ve
yüklendi — terminal kapansa da, makine yeniden başlasa da çalışıyor.
`deploy/local/README.md` içinde yükleme/durdurma komutları var.

**Sunucuda:** `deploy/cleo-worker.service` (systemd) ya da
`deploy/ecosystem.config.cjs` (pm2) zaten duruyordu; ikisine de eksik olan
iki şey eklendi:

- **`TimeoutStopSec=330`.** systemd'nin varsayılanı 90 saniye, ama
  `timely-sync` 126 feed'i 2–5 dakikada süpürüyor **ve** her şubenin eski
  bloklarını yenilerini yazmadan önce siliyor. Süpürmenin ortasında SIGKILL
  yemek, o şubenin ajandasını yarı boş bırakır — yani her slot satışa çıkar.
  Aynı gerekçeyle pm2'ye `kill_timeout`.
- **`StartLimitBurst`.** Kilitlenen bir deploy sonsuza kadar denemesin; her
  yeniden başlatma yeni bir Vonage girişi ve hesabı kilitleyen şey girişler.

**Önceki notumu düzeltiyorum:** "iki işçi her kampanyayı iki kez gönderir"
demiştim, **yanlış.** Gerçekten mesaj gönderen iki iş — `scheduled-sms` ve
`campaign-dispatcher` — satırlarını `for update skip locked` ile alıyor;
`sla-monitor` ve `winback` da `on conflict do nothing` kullanıyor. Yani iki
işçi çift göndermez. Tek kopya çalıştırmanın gerçek gerekçesi daha sıradan:
biri yeterli, log okunabilir kalıyor, ve `/admin/health` için tek kalp atışı
satırı yazılıyor — iki süreç o satırda birbirini ezer.

**`SMS_TRANSPORT` kararı hâlâ sizde.** `twilio` ile servis ayağa kalktığı
anda kuyrukta bekleyen her şey gidiyor ve 45 şubede otomasyon açık. Servisi
ilk kez başlatmadan önce kuyruğa bakın — komutlar unit dosyasının başında.
Ben burada başlatmadan önce sıfır olarak doğruladım.

**Gözlemlenebilirlik** (önceki notum burada da yanlıştı): her işin son
koşması `rollup_checkpoints`'te zaten tutuluyordu, sadece gösterilmiyordu.
Şimdi işçi 30 saniyede bir kendi kalp atışını da yazıyor ve **Veri
Kaynakları** ekranı bunu okuyor.

---

## 9. Vonage token'ı süreçler arasında paylaşılıyor  ✅ düzeltildi (2026-09-27)

VBC bir kullanıcı için **tek canlı token** tutuyor. Üç süreç aynı VBC
kullanıcısıyla giriş yapıyordu — web, realtime ağ geçidi, işçi — ve her
giriş diğer ikisinin token'ını sessizce iptal ediyordu.

Ağ geçidi 2 saniyede bir sorduğu için ilk o fark ediyordu: 401 → token'ı at
→ yeniden giriş → işçinin token'ı ölür → işçinin sonraki işi 401 verir →
yeniden giriş → ağ geçidininki ölür. Tek bir ağ geçidi log'unda **46 giriş,
45 tanesi 401** vardı; Vonage'ın 24 saat geçerli dediği bir token için.

Kaybedilen veri buradaydı: 401 alan `vonage-sync` "hiç çağrı gelmedi" diye
raporluyor ve 5 dakika bekliyordu. `vonage-directory` ve
`vonage-recordings` de saatlerce 401 aldı.

Ayrıca hesabı kilitleyen şeyin tam şekli: kilit sayacı süreç başına değil
**kullanıcı başına** işliyor.

Token artık Redis'te (`vonage:token`), bir kilitle tek süreç üretiyor,
diğerleri okuyor. 401 alan süreç token'ı karşılaştırarak siliyor — başka bir
süreç o arada yenisini yazdıysa onu çöpe atmıyor. Düzeltme sonrası iki
süreç birlikte: **1 giriş, 0 adet 401.**

---

## 10. Veri Kaynakları ekranı  ✅ eklendi (2026-09-27)

`/admin/health` — Vonage (Reports / Provisioning / Telephony / VIS webhook),
Vonage kayıtları, Twilio, Timely, altyapı ve işçi. Her kart
**yapılandırmayı değil kanıtı** gösteriyor: en son ne zaman veri geldi, son
başarılı koşma ne zamandı, sağlayıcı ne dedi.

Kasıtlı olarak **hiçbir sağlayıcıya istek atmıyor.** Her açılışta Vonage'ı
yoklayan bir durum sayfası, reddedilen bir kimliği döven bir sayfa olurdu —
ve her deneme kilidi uzatıyor. Sadece bu makinedeki iki servis (Redis, ağ
geçidi) yoklanıyor.

`reports.view` izniyle okunuyor, `settings.manage` değil: tahtanın durduğunu
fark eden insanlar müdürler ve `settings.manage` yalnızca sahip hesabında.

---

## 11. Tarayıcıdan arama — Vonage CPaaS hesabı bloklu  🔴 sizde

VBC'de tarayıcı içinde ses **yok.** Bu artık tahmin değil: UC Developer
Portal'ın API kataloğunda altı API var ve hiçbiri WebRTC değil —
`CallRecording`, `CallRecordingIndia`, `Provisioning`, `Reports`,
`Telephony v3`, `VonageIntegrationSuite`.

Tarayıcıda ses, Vonage'ın **Voice API**'si demek: ayrı ürün, ayrı hesap
(`dashboard.vonage.com`), ayrı kimlikler. VBC consumer key'i orada **401**
veriyor, denedim.

**Durum:** o taraftaki hesabınız bloklanmış. Yeni hesap açmayın — aynı
şirket/kart/IP ile tekrar işaretlenir ve bir bloğu yeni hesapla aşmak doğru
yol değil. VBC hesap yöneticinize ya da Vonage support'a bloğun sebebini
sorun; çoğu askıya alma belge gönderince kalkıyor.

**Kod hazır ve bekliyor** — `spike/web-dialer` dalında: `voiceApi.ts`
(RS256 JWT), `DialerBrowser.tsx`, NCCO answer webhook, olay webhook'u,
`scripts/dev/setup-vonage-voice.ts`. Hesap açılınca:

```
npm run tunnel
npm run vonage:voice:setup -- https://<ngrok>.ngrok-free.app
```

Bir numara da gerekiyor (~$1/ay); VBC numaraları o tarafa geçmiyor.

Answer webhook'u public tünelde duracağı için `VONAGE_DIALER_ALLOWLIST`
zorunlu: liste boşken hiçbir numara aranmıyor. İsteğe gelen numaraya
bağlanan bir NCCO düpedüz toll-fraud makinesidir.

---

## 12. Konsoldan arama kapalı  🟡 bizde

**Belirti:** müşterinin telefonu çalıyor, bizimki çalmıyor, müşteri açınca
karşısında kimse olmuyor. Gerçek telefonla defalarca tekrarlandı.

**Sebep:** dahili bir telefon değil, birkaç cihazın cevap verdiği bir
numara. 487'de üç handset kayıtlı ve `from: {type: "extension"}` "bu
dahilinin cihazlarından biri" demek — seçimi Vonage yapıyor. Ajanın önünde
olmayanı seçti. Çağrının Reports kaydı hangisini kullandığını söylüyor
(`source_sip_id`), böyle bulundu.

**Bu arada kodda yazdığım ve hiç test etmediğim bir cümle çürüdü:**
*"ajanın telefonu önce çalar, açınca müşteri aranır."* API'nin doğrulama
hatalarından çıkarsamıştım; kanıt üç aramadır tersini söylüyordu.

**Şu an:** arama butonu **kaldırıldı.** Yerine geri arama bir kişiye görev
olarak atanıyor; o kişi kendi telefonundan arıyor ve numara geri arama
kuyruğundan çıkıyor. Modal bunun neden kapalı olduğunu açıkça yazıyor.

**Açmak için ikisinden biri:**
1. VBC admin → Extensions → 487 → Devices → fazla cihaz slotlarını silin.
   Tek cihaz kalırsa Vonage'ın seçeneği kalmaz.
2. Doğru handset'i bulun (`spike/web-dialer`'daki dialer cihaz seçtiriyor),
   sonra `calls/log` yolunu o cihaza bağlayalım.

`logCallback` store'da duruyor, kullanılmıyor, neden durduğu yorumda yazılı.

### Aynı zincirde düzeltilen dört hata

- **Hat şubeye göre seçiliyordu**, butona basana göre değil. Kimsenin
  olmadığı çağrı merkezi koltuğunu çaldırıyordu. Artık önce ajanın kendi
  dahilisi (`extensions.staff_id`, `scripts/dev/link-extension.ts` ile
  atanıyor — konsolda henüz seçici yok).
- **Kuyruk senkron sonrası hiç tazelenmiyordu.** Biten çağrı konsola iki kez
  ulaşıyor: ağ geçidi anında, Reports 8–13 dakika sonra. Konsol birincisinde
  tazeliyordu, yani ortada çekilecek bir şey yokken. Artık senkron
  `calls.imported` yayınlıyor.
- **Giden çağrılar bizim dahilimize yazılıyordu** (`fromNumber`). Geri
  arasanız bile listeden düşmüyor, aynı dahilinin diğer telesekreterlerini
  gizliyordu.
- **Başarısız deneme "arandı" sayılıyordu** — hat hiç çalmadan müşteri
  listeden kayboluyordu.

---

## 13. Gelen telesekreter sesleri  🟡 ertelendi (karar: 2026-09-27)

**1.592 gelen telesekreterin hiçbirinde ses yok.** Bu ölçüldü, tahmin
değil:

```
inbound  Voicemail  1592 → 0 tanesinde ses  (%0.0)
inbound  Answered   2716 → 2686 tanesinde   (%98.9)
outbound Voicemail     3 → 2 tanesinde      (%66)
```

Company Call Recording **konuşmaları** kaydediyor. Gelen telesekreterde
hatta kimse yok, kaydedilecek konuşma yok. Giden telesekreterde ses var
çünkü orada biz varız.

VIS webhook'larından da gelmiyor — aldığımız olay tipleri sadece
`call.started`, `call.updated`, `call.ended`. Katalogda voicemail API'si
yok.

**Karar:** olduğu gibi bırakılıyor. Elimizde kim aradı, ne zaman, hangi
numaradan, hangi dahiliye ve geri arama kuyruğu var; eksik olan yalnızca
mesajın içeriği. **Sonra posta yönlendirmesi denenecek** — VBC zaten
voicemail-to-email gönderiyor, o adresi okuyan bir köprü en az riskli yol.

Diğer seçenek yönlendirmeyi değiştirmekti (şubelerin Call Forwarding'i
bizim kontrol ettiğimiz bir numaraya). 46 şubenin canlı yönlendirmesini
değiştirmek bir deneme için fazla riskli bulundu.

---

## 14. Reports token'ı erken reddediyor  ✅ düzeltildi (2026-09-27)

VBC token'ları söylediği zamanda bitmiyor ve **her API için aynı anda
bitmiyor.** 1435 dakika geçerli denen bir token:

```
Telephony v3     saatlerce kabul
Provisioning v1  saatlerce kabul
Reports v1       birkaç dakika sonra 401 "Problem with provided token"
```

Ölçüldü: aynı token aynı saniyede Telephony'de 200, Reports'ta 401; dakikalar
önce üretilmiş biri ikisinde de 200. Yenisini üretmek eskisini iptal
**etmiyor** — bu da ayrıca ölçüldü, çünkü etseydi düzeltme canlı tahtayı
beş dakikada bir düşürürdü.

Sessizce veri kaybettiriyordu: 401 alan `vonage-sync` "hiç çağrı gelmedi"
deyip beş dakika bekliyordu.

`vonageFetch` bir kez yeni token üretip isteği tekrarlıyor. Reports,
Provisioning, Telephony, kayıtlar ve click-to-call hepsi bundan geçiyor.

**Yan not — Reports gecikmesi:** biten bir çağrının Reports'ta görünmesi
ortanca **8 dk**, %90 **10 dk**, en kötü **13 dk**. Canlı tahta anında
görüyor (Telephony yoklaması), çağrı defteri bu kadar bekliyor. Bir çağrı
"kayıp" sanılmadan önce bu süre geçmeli.

---

## Aklınızda olsun

**`SMS_TRANSPORT=twilio` açık.** Test ederken gerçek SMS gidiyor. Kapatmak
için `.env.local` içinde `log` yapın.

**`TIMELY_SYNC_ENABLED=1` açık.** 30 dakikada bir 126 feed okunuyor, 95'i
yanıt veriyor.

**Konsoldan arama kapalı.** "Geri ara" butonu yerine geri aramayı bir kişiye
görev olarak atıyor — bkz. madde 12. Ekrandaki modal sebebini yazıyor.

**Konsolun varsayılan dili İngilizce** (27 Eylül). Kayıtlı bir tercih varsa
o kazanıyor; tarayıcının diline artık bakılmıyor.

**Arka plan işçisi bu makinede `launchd` ile çalışıyor**
(`com.cleopatra.worker`, 27 Eylül'de kuruldu). Terminal kapansa da sürüyor.
Durumu: `/admin/health` ya da `npm run health`. Durdurmak için
`launchctl unload ~/Library/LaunchAgents/com.cleopatra.worker.plist`.

**Vonage API kullanıcısı `ismaildilmec@vbc.prod`** ve öyle kalacak (27 Eylül
kararı). Company Call Recording izni bu hesapta var, `cleopatra.api`'ye izin
verme işi kapandı. Dikkat edilecek tek şey: bu gerçek bir kişinin hesabı, o
yüzden kişi ayrılırsa ya da parolasını değiştirirse çağrı kayıtları,
dahili listesi ve canlı tahta aynı anda durur — ve panelde kırmızı olarak
görünür.

**Vonage webhook tanılama günlüğü** artık yalnızca geliştirmede çalışıyor
(`VONAGE_DEBUG_LOG=0` ile susturulur) ve `Authorization` JWT'si ile diğer
kimlik başlıkları maskeleniyor. Üretimde hiç yazmıyor — müşteri telefon
numaraları düz dosyada birikmesin diye.

**`PUBLIC_BASE_URL=http://localhost:3000`.** Davet linkleri ve webhook
callback'leri bundan üretiliyor; canlıya çıkarken gerçek alan adı girilmeli.
Twilio, ulaşılamayan bir StatusCallback yüzünden mesajın tamamını reddediyor
— o yüzden localhost'ta callback hiç gönderilmiyor.
