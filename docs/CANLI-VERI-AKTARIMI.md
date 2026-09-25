# Canlı Laravel veritabanından aktarılacaklar

Aşağıdaki sorguları **canlı** veritabanında çalıştırıp çıktıyı iletin.
Hepsi `SELECT` — hiçbir şey değiştirmez.

Tablo/kolon adları sizin şemanızda farklı olabilir; ilk sorgu onu bulur.

---

## 0. Önce şemayı görelim

```sql
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (
    COLUMN_NAME LIKE '%twilio%' OR COLUMN_NAME LIKE '%vonage%'
    OR COLUMN_NAME LIKE '%timely%' OR COLUMN_NAME LIKE '%gtm%'
    OR COLUMN_NAME LIKE '%messaging%' OR COLUMN_NAME LIKE '%sid%'
    OR COLUMN_NAME LIKE '%extension%'
  )
ORDER BY TABLE_NAME, COLUMN_NAME;
```

---

## 1. Twilio — şube başına kimlik bilgileri  ⭐ en öncelikli

Şu an 46 şubeden sadece 2'sinde sahte test verisi var.

```sql
SELECT
  id, slug, name,
  twilio_account_sid, twilio_auth_token,
  twilio_messaging_service_sid, twilio_phone_number,
  branch_phone, sms_automation
FROM locations
ORDER BY id;
```

Kolon adları tutmazsa sorgu 0'daki çıktıdan uyarlanır.

> `auth_token` gizli bilgidir. Dosyayı paylaşırken token sütununu
> boş bırakıp ayrıca iletmeniz yeterli — eşlemeyi SID üzerinden yaparım.

## 2. Vonage — dahili numaralar

Webhook gelen aramanın hangi ajana ait olduğunu `extensions` tablosundan
çözüyor. Şu an demo veri var.

```sql
SELECT id, extension, display_name, username, phone_number,
       email, user_type, location_id
FROM vonage_extensions      -- veya sizdeki adı
ORDER BY extension;
```

## 3. GTM — şube başına ülke/şehir

Türettim (`Atlanta, GA` / `United States`) ama canlıdaki değerler
kampanyalarla eşleşiyorsa onlar geçerli olmalı.

```sql
SELECT id, slug, gtm_country, gtm_city_state FROM locations ORDER BY id;
```

## 4. Timely — entegrasyonun gerçek şekli  ⚠️

Buna dair elimde hiçbir iz yok (bkz. aşağıdaki not).

```sql
-- Timely hesap/kimlik bilgileri nerede tutuluyor?
SELECT * FROM integrations WHERE provider LIKE '%timely%';
-- veya
SELECT id, slug, timely_account_id, timely_api_key FROM locations LIMIT 5;
```

Ayrıca: indirilen Excel dosyalarından bir örnek ve onu işleyen
Laravel komutu/job'ının adı.

## 5. Sayı kontrolü — aktarım sonrası karşılaştırmak için

```sql
SELECT
  (SELECT COUNT(*) FROM locations)    AS subeler,
  (SELECT COUNT(*) FROM appointments) AS randevular,
  (SELECT COUNT(*) FROM leads)        AS leadler,
  (SELECT COUNT(*) FROM users)        AS personel;
```
