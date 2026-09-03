A) Raporlar — eksik analizi
Alan
Durum
Not
Huni + drop-off, platform kırılımı, kampanya tablosu, şube liderlik tablosu, CSV
✅ Var
Temel sağlam
Dönem karşılaştırması (Δ)
✅ Bugün eklendi
5 KPI kartı önceki dönemle ▲▼ karşılaştırmalı
Speed-to-Lead SLA (talep → ilk arama süresi)
✅ Bugün eklendi
<5dk / 5–15 / 15–60 / >1sa / hiç aranmadı dağılımı + %15-dk uyum skoru
Gün × saat ısı haritası
✅ Bugün eklendi
Vardiya planlaması için talep yoğunluğu
Ops Pulse (no-show oranı, randevu başına çağrı, ort. görüşme, SMS thread)
✅ Bugün eklendi
Gelir & kapora
❌ Eksik
Appointment'ta deposit, priceEstimate, paid yok → "beklenen gelir", "tahsil edilen kapora", "no-show maliyeti" raporlanamıyor
Kampanya ROI
❌ Eksik
Kampanya maliyeti girilemiyor → CPL, randevu başına maliyet, ROAS yok
Cohort analizi
❌ Eksik
Haftalık lead kohortları → 1./2./4. hafta dönüşüm eğrileri
Sanatçı utilizasyonu
❌ Eksik
Sanatçı başına randevu/doluluk/gelir
Stüdyo bazlı huni karşılaştırma
❌ Eksik
Hangi şube hangi adımda lead kaybediyor
Otomatik haftalık digest
⚠️ Yarım
Settings'te toggle var, gerçek gönderim/şablon yok
Derin export
⚠️ Tek CSV
Lead/çağrı/randevu tam export + zamanlanmış export
B) CRM operasyon eksikleri
Yetki enforcement — Matris var ama UI aksiyonları izinlere göre kilitlenmiyor (sms.send yoksa Send butonu pasif olmalı). Öncelik: yüksek, efor: küçük.
Lead SLA zamanlayıcıları — not_called 15 dk → sarı, 1 sa → kırmızı + yönetici eskalasyonu; pipeline satırında canlı rozet.
Otomatik atama — Round-robin / en az yoğun agent / lead diline göre (veri meta.language zaten var, değerlendirilmiyor).
Duplicate merge akışı — isDuplicate bayrağı var, birleştirme ekranı yok (aktiviteleri birleştir).
Toplu SMS kampanyaları — Segment (şube/durum/platform) → şablon → zamanlama → teslimat raporu. Şu an yalnızca birebir.
Kapora & ödeme linki — Twilio ile kapora linki, paid işareti → otomatik confirmed.
Win-back otomasyonu — cancelled → 30 gün sonra otomatik geri kazanım SMS'i.
Callback görev modeli — Cevapsız çağrı → due date'li görev, assignee, tamamlandı işareti (şu an sadece liste).
Bildirim katmanı — Atama/mention/SLA ihlali için browser push + e-posta.
Denetim günlüğü — Kim neyi ne zaman değiştirdi (entity seviyesinde; webhook feed'i var ama entity audit yok).
WhatsApp kanalı — TR/EU şubeleri için SMS'in yanında.
Mobil deneyim — Tablolar 980–1020px min-width; sahada telefon kullanımı için kart görünümü.
Yoğunluk anahtarı — Linear tarzı comfortable/compact tablo modu.
C) Tasarım incelemesi
Güçlü olan (korunmalı): Cinzel + Manrope + JetBrains Mono üçlüsü konuya özgü ve tutarlı; koyu "NOC konsolu" kimliği; canlı öğeler (çağrı sayacı, EQ barları, count-up, sync rozetleri) sayfayı yaşatıyor; row-live mikro-etkileşimi iyi.
Bulgular:
Tipografik kontrast — KPI rakamları 22–27px bandında; 1480px konsolda 30–34px'e çıkıp font-display başlıklarla kademelenmeli (Raporlar'daki yeni KPI'ları 27px yaptım, Dashboard da aynı ölçeğe çekilebilir).
Semantik renk disiplini — jade/amber/ember dışında iris, lapis, pink, turkuaz aynı anda "durum" anlatıyor; semantiği 3 renge kilitleyip (başarı/uyarı/tehlike) kalanı kategorik veriye saklamak okunabilirliği artırır.
Radius tekdüzeliği — Her yüzey rounded-2xl; kart 14px / input 10px / çip 8px ölçeği daha "crafted" hissettirir.
Erişilebilirlik — focus-visible halkası, ::selection ve prefers-reduced-motion desteği bugün eklendi. aria-label'lar ikon butonlarında eksik (tek tek gezilecek).
Yükleme durumları — Her şey anlık; servis entegrasyonlarında .skeleton shimmer sınıfı bugün eklendi, kullanım yerleri (i18n fetch, rapor hesapları) sprint işi.
Satır tıklama standardı — Bazı tablolarda tüm satır, bazılarında sadece avatar tıklanabilir; "satır = aç, aksiyonlar stopPropagation" standardına geçilmeli.
Zemin katmanı — Grain + tek düze ink; üstte çok hafif altın vignette derinlik katar (küçük CSS dokunuşu).
Sidebar — 1024–1280px aralığında ikon rayına (56px) katlanmalı.
D) Yol haritası
Sprint
Kapsam
Efor
S1 (bu hafta)
✅ Raporlar 2.0 v0.1 (teslim edildi) · Yetki enforcement (buton kilitleme) · Lead SLA rozetleri · Dashboard KPI delta'ları
~2 gün
S2
Gelir/kapora veri modeli + gelir raporu · Toplu SMS kampanya modülü · Duplicate merge ekranı · Callback → görev
~4 gün
S3
Kampanya maliyeti/ROI · Cohort eğrileri · Sanatçı utilizasyonu · Bildirim katmanı · Denetim günlüğü
~4 gün
S4
WhatsApp kanalı · Win-back otomasyonu · Mobil kart görünümleri · Yoğunluk anahtarı · Sidebar katlanma
~3 gün
Paralel tasarım track
Tip ölçeği · semantik renk kilidi · radius ölçeği · aria geçişi · skeleton kullanım yerleri
her sprintte küçük dilimler
E) Bugünün teslimi
Raporlar 2.0 v0.1: dönem karşılaştırmalı 5 KPI, Speed-to-Lead SLA kartı, gün×saat ısı haritası, Ops Pulse şeridi — hepsi TR/EN çevirili ve mevcut pencere/şube filtreleriyle uyumlu
CSS cilası: focus-visible halkaları, seçim rengi, reduced-motion desteği, skeleton shimmer altyapısı
Onay verirsen S1'in kalanını (yetki enforcement + lead SLA rozetleri + dashboard delta'ları) hemen uygulayabilirim; ya da önceliği S2'deki gelir/kapora modeline kaydırabiliriz — hangisi işine daha çok yarıyorsa oradan devam ederiz.
Analiz tamam ve yol haritasının ilk adımı teslim edildi. Raporlar 2.0 v0.1 yayında: dönem karşılaştırmalı KPI kartları, Speed-to-Lead SLA görünümü, gün-saat bazlı talep ısı haritası ve operasyonel nabız şeridi eklendi. Ayrıca odak halkaları, seçim renkleri ve hareket azaltma desteği gibi erişilebilirlik iyileştirmeleri yapıldı. Kalan işler: gelir/kapora modeli, toplu SMS, görev modeli, bildirimler ve denetim kaydı. Sprint 1 kapsamındaki yetki kilitleme ve SLA rozetlerini istersen hemen uygulayabilirim.
Kod Araç Kaydı
