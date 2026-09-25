# Cleopatra v3 — Sistem Akışları

> Her akış çalışan koda karşılık gelir ve test edilmiştir.
> Şema diyagramları için: [SCHEMA.md](./SCHEMA.md)

---

## 0. Genel resim

```mermaid
flowchart LR
  subgraph musteri["Müşteri tarafı"]
    ziyaretci["Ziyaretçi<br/>(reklam / organik)"]
    telefon["Telefonla arayan"]
    sms_in["SMS yazan"]
  end

  subgraph booking["Rezervasyon motoru :5174"]
    picker["Stüdyo seçimi"]
    sihirbaz["Sihirbaz<br/>(adım adım)"]
    yonet["Randevu yönetimi<br/>/b/:uuid"]
  end

  subgraph api["API :3000"]
    public["Public uçlar"]
    webhook["Twilio webhook'ları"]
    konsol["Konsol uçları<br/>(token korumalı)"]
  end

  subgraph veri["PostgreSQL"]
    oturum["booking_sessions"]
    lead["leads"]
    randevu["appointments"]
    kuyruk["scheduled_messages"]
    cagri["calls"]
    thread["sms_conversations"]
  end

  worker["Worker<br/>(her dakika)"]
  twilio["Twilio"]

  ziyaretci --> picker --> sihirbaz --> public
  yonet --> public
  public --> oturum & lead & randevu & kuyruk
  telefon --> twilio --> webhook
  sms_in --> twilio
  webhook --> cagri & thread & lead
  worker --> kuyruk
  worker --> twilio
  konsol --> thread
```

---

## 1. Lead yaşam döngüsü — projenin kalbi

**Kural:** Lead satırı asla silinmez. Çağrı hattının tek ölçütü `converted_at IS NULL`.

```mermaid
stateDiagram-v2
  [*] --> Oturum: form açıldı
  note right of Oturum
    booking_sessions satırı.
    LEAD DEĞİL — kimse aramaz.
  end note

  Oturum --> Oturum: adım ilerler<br/>(step_data güncellenir)
  Oturum --> Terk: isim/mail/telefon bıraktı<br/>ama bitirmedi

  Terk --> Hatta: capture_lead()<br/>source=abandoned_form<br/>call_status=not_called
  note right of Hatta
    SLA saati başlar.
    Kurtarma SMS'leri kuyruğa girer.
  end note

  Hatta --> Hatta: ajan arar<br/>call_status güncellenir
  Hatta --> Donusmus: randevu oluştu
  Oturum --> Donusmus: tek oturumda bitirdi<br/>source=completed_form

  Donusmus --> [*]
  note left of Donusmus
    converted_at = now()
    call_status = appointment_made
    lifecycle = done
    → HATTAN ÇIKAR
    → kurtarma SMS'leri iptal
    → slot bloklanır
  end note
```

| Durum | Lead açılır mı? | Hatta görünür mü? |
|---|---|---|
| Form açtı, hiçbir şey bırakmadı | **Hayır** | — |
| Mail bıraktı, telefon yok | Evet, `call_status=no_pn` | Evet (aranamaz işaretli) |
| Telefon bıraktı, terk etti | Evet, `abandoned_form` | **Evet** |
| Terk etti, sonra döndü tamamladı | Aynı lead | Hayır — çıktı |
| Tek oturumda tamamladı | Evet, `completed_form` | **Hayır** — hiç girmedi |

---

## 2. Reklamdan gelen → önce iletişim

```mermaid
sequenceDiagram
  autonumber
  participant Z as Ziyaretçi
  participant S as Sihirbaz
  participant A as API
  participant DB as PostgreSQL
  participant W as Worker

  Z->>S: /atlanta/book?utm_source=instagram
  S->>A: POST /booking/sessions
  Note over A: utm + 13 click-id + cihaz<br/>+ contact_first işareti
  A->>DB: booking_sessions
  A-->>S: session_uuid

  S->>A: GET /booking/config/atlanta?lang=tr
  A-->>S: contactStepOverride<br/>→ CONTACT adımı 1. sıraya

  Note over Z,S: Stil/tarih sorulmadan ÖNCE<br/>ad · mail · telefon

  Z->>S: bilgileri girer
  S->>A: PUT /sessions/{uuid}/step
  A->>DB: capture_lead() → LEAD-1000
  A->>DB: scheduleLeadRecovery()

  alt Ziyaretçi terk eder
    W->>DB: 5dk sonra kuyruğu tarar
    W->>Z: kurtarma SMS'i #1
    W->>Z: 2sa sonra #2
    W->>Z: 24sa sonra #3
  else Ziyaretçi tamamlar
    Z->>S: randevuyu bitirir
    S->>A: POST /booking/appointments
    A->>DB: trigger → lead dönüştü
    A->>DB: bekleyen kurtarma SMS'leri iptal
    A->>Z: onay SMS'i
  end
```

---

## 3. Gelen çağrı → şube telefonuna yönlendirme

```mermaid
sequenceDiagram
  autonumber
  participant M as Arayan
  participant T as Twilio
  participant A as /webhooks/twilio/voice
  participant DB as PostgreSQL
  participant S as Şube telefonu

  M->>T: şubenin Twilio numarasını arar
  T->>A: POST (To, From, CallSid) + imza

  A->>DB: To → numbers → şube
  Note over A: İmza O ŞUBENİN token'ı ile doğrulanır
  alt imza geçersiz
    A-->>T: 403
  else numara bize ait değil
    A-->>T: "not in service" + Hangup
  else şube telefonu tanımsız
    A-->>T: kibar mesaj + Hangup
  else
    A->>DB: calls satırı (Attempted)
    A->>DB: arayanı lead/müşteri ile eşleştir
    A->>DB: realtime_events → call.ringing
    A-->>T: TwiML Dial<br/>callerId = arayanın numarası
    T->>S: şube hattını çaldırır
  end

  T->>A: POST /voice/status (sonuç, süre)
  alt cevaplandı
    A->>DB: result=Answered + süre
  else cevapsız
    A->>DB: result=Missed
    A->>DB: tasks → "geri ara" (vade +2sa)
  end
```

---

## 4. Gelen SMS & opt-out

```mermaid
sequenceDiagram
  autonumber
  participant M as Müşteri
  participant T as Twilio
  participant A as /webhooks/twilio/inbound
  participant DB as PostgreSQL

  M->>T: SMS
  T->>A: POST + imza
  A->>DB: webhook_deliveries (unique)
  Note over A: Aynı webhook ikinci kez gelirse<br/>burada durur — retry güvenli

  alt STOP / İPTAL / DUR
    A->>DB: unsubscribes
    Note over DB: TRIGGER tek işlemde yayar:<br/>konuşma + lead + müşteri<br/>+ bekleyen otomasyon SMS'leri
  else START / BAŞLA
    A->>DB: opt-out geri alınır
  else normal mesaj
    A->>DB: thread bul/aç → lead & müşteri eşle
    A->>DB: sms_messages (inbound)
    A->>DB: unread_count++
    A->>DB: realtime_events → sms.received
  end
```

---

## 5. Giden SMS — tek huni

```mermaid
flowchart TD
  A1["Ajan panelden yazar"] --> G
  A2["Otomasyon<br/>(kurtarma / hatırlatıcı)"] --> G
  A3["Kampanya"] --> G

  G["sendSms()"] --> C1{"Opt-out var mı?"}
  C1 -->|evet| R1["reddedilir<br/>reason=opted_out"]
  C1 -->|hayır| C2{"Şubenin gönderici<br/>numarası var mı?"}
  C2 -->|yok| R2["reddedilir<br/>reason=no_sender"]
  C2 -->|var| T["Şablon çözümle<br/>şube override → dil → varsayılan"]
  T --> SEG["Segment hesapla<br/>GSM-7: 160 · UCS-2: 70"]
  SEG --> MSG["sms_messages<br/>status=queued"]
  MSG --> TR{"SMS_TRANSPORT"}
  TR -->|log| LOG["konsola yazar<br/>hiçbir şey gönderilmez"]
  TR -->|twilio| TW["Twilio REST API"]
  TW --> CB["status callback<br/>→ sent / delivered / failed"]
  LOG --> AUD
  CB --> AUD["activity_log<br/>kim · kime · ne"]
```

> `SMS_TRANSPORT` üretim dışında **varsayılan `log`**. Gerçek SMS göndermek bilinçli bir karar olmalı.

---

## 6. Otomasyon kuyruğu ve worker

```mermaid
sequenceDiagram
  autonumber
  participant Q as scheduled_messages
  participant W as Worker (her dakika)
  participant S as sendSms()

  W->>Q: UPDATE ... SKIP LOCKED<br/>status='processing'
  Note over W,Q: Atomik sahiplenme —<br/>iki worker aynı mesajı almaz

  loop her mesaj
    W->>S: gönder
    alt başarılı
      S-->>W: ok
      W->>Q: status='sent'
    else opt-out
      S-->>W: opted_out
      W->>Q: status='cancelled'
      Note over W: Tekrar DENENMEZ — nihai cevap
    else geçici hata
      S-->>W: provider_error
      W->>Q: 10dk sonraya ertele
      Note over W: 3. denemede status='failed'
    end
  end
```

| Zamanlama | Ne zaman | İptal koşulu |
|---|---|---|
| `lead_recovery_5m` | telefon bırakıldıktan +5dk | randevu alındı / opt-out |
| `lead_recovery_2h` | +2 saat | aynı |
| `lead_recovery_24h` | +24 saat | aynı |
| `appointment_reminder_24h` | randevudan 24sa önce | iptal / opt-out |
| `appointment_reminder_3h` | randevudan 3sa önce | aynı |

> Geçmişte kalan hatırlatıcı hiç kurulmaz: yarın sabahki bir randevu için 24sa hatırlatıcısı zaten kaçmıştır, kurulursa anında patlardı.

---

## 7. Müsaitlik hesabı — saat dilimi kritik

```mermaid
flowchart TD
  REQ["GET /availability/{slug}?month=2026-09"] --> TZ["Şubenin IANA saat dilimi<br/>(Tacoma = America/Los_Angeles)"]
  TZ --> H["Haftalık çalışma saatleri<br/>(yerel duvar saati)"]
  H --> SLOT["Slot üret<br/>booking_interval_min aralıkla"]
  SLOT --> SUB["Çıkar: availability_blocks<br/>(Timely + kendi randevularımız + kapanışlar)"]
  SUB --> RULE1["Aynı gün: +sameDayLeadHours"]
  RULE1 --> RULE2["Ufuk: +maxBookingDaysAhead"]
  RULE2 --> OUT["Slotlar ŞUBENİN saatinde döner"]

  BOOK["POST /appointments"] --> CONV["yerel saat → UTC instant<br/>zonedToUtc()"]
  CONV --> CLASH{"availability_blocks<br/>çakışma var mı?"}
  CLASH -->|var| E409["409 — slot az önce doldu"]
  CLASH -->|yok| SAVE["starts_at = UTC<br/>display_timezone = şube tz"]
  SAVE --> TRIG["TRIGGER → slotu blokla"]
```

> **Neden önemli:** canlı sistemde 46 şubenin tamamı `America/New_York` kayıtlıydı. 21'i yanlıştı — Pacific şubelerde müşteriye gösterilen saat 3 saat kayıktı. Düzeltme `scripts/timezones.ts`'te.

---

## 8. Çok dillilik — 4 katmanlı çözümleme

```mermaid
flowchart LR
  REQ["?lang=tr"] --> CHK{"tr aktif mi?"}
  CHK -->|hayır| FB["locale=en<br/>fallbackUsed=true<br/>Content-Language: en"]
  CHK -->|evet| L1["1. global + en"]
  L1 --> L2["2. global + tr"]
  L2 --> L3["3. şube + en"]
  L3 --> L4["4. şube + tr ← KAZANIR"]
  L4 --> CACHE["Redis 5dk"]
  CACHE --> OUT["20 namespace<br/>568 çeviri"]
```

> Eskiden desteklenmeyen dil sessizce İngilizce dönüyordu, istemci bunu bilemiyordu. Artık `fallbackUsed` ve `Content-Language` açıkça söylüyor.

---

## 9. Randevu yönetimi (müşteri tarafı)

```mermaid
stateDiagram-v2
  [*] --> pending: rezervasyon yapıldı
  pending --> confirmed: stüdyo onayladı
  confirmed --> deposit_paid: kapora alındı
  deposit_paid --> completed: geldi, yapıldı
  confirmed --> completed

  pending --> rescheduled: müşteri kendi linkinden erteledi
  confirmed --> rescheduled
  rescheduled --> completed

  pending --> cancelled: iptal
  confirmed --> cancelled
  rescheduled --> cancelled
  confirmed --> no_show: gelmedi

  cancelled --> [*]
  completed --> [*]
  no_show --> [*]

  note right of rescheduled
    Slot bloğu YENİ saate taşınır.
    Bu durum blok tutan statüler
    listesinde olmadığı için eski
    saat halka açık takvime geri
    düşüyordu — düzeltildi.
  end note
```

---

## 10. Denetlenebilirlik

Her yan etki bir kişiye (veya otomasyona) bağlanır:

```mermaid
flowchart LR
  ACT["Bir işlem"] --> LOG["activity_log"]
  LOG --> F1["actor_kind: user / worker / webhook"]
  LOG --> F2["actor_staff_id + isim + rol"]
  LOG --> F3["target_type + target_id"]
  LOG --> F4["alan bazlı diff"]
  LOG --> F5["IP · user agent · süre"]
  LOG --> IMM["TRIGGER: UPDATE ve DELETE reddedilir"]

  LOG --> ROLL["Gecelik toplama"]
  ROLL --> R1["staff_daily_stats<br/>ajan karnesi"]
  ROLL --> R2["location_daily_stats"]
  ROLL --> R3["funnel_daily_stats"]
  ROLL --> R4["attribution_daily_stats"]
```
