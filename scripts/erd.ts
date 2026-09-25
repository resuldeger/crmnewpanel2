/**
 * Generates a Mermaid ER diagram from the LIVE database, so the picture can
 * never drift from the schema. One overview plus one diagram per domain —
 * 45 tables in a single graph is unreadable.
 *
 *   npx tsx scripts/erd.ts
 */
import "./env";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/db/client";

const DOMAINS: { key: string; title: string; blurb: string; tables: string[] }[] = [
  {
    key: "rbac", title: "1 · Yetki (RBAC)",
    blurb: "Kim giriş yapabilir, hangi izinlere ve hangi şubelere erişir.",
    tables: ["roles", "permissions", "role_permissions", "staff", "location_scopes", "auth_sessions"],
  },
  {
    key: "studios", title: "2 · Şubeler & ekip",
    blurb: "Stüdyolar, telefon numaraları (Twilio / Vonage / şube), sanatçılar, dahili numaralar.",
    tables: ["locations", "numbers", "artists", "artist_locations", "extensions", "location_closures"],
  },
  {
    key: "booking", title: "3 · Rezervasyon motoru",
    blurb: "Ziyaretçi oturumları (yarıda kalan istekler), çok dilli sözlük, adım seçenekleri, müsaitlik.",
    tables: ["booking_sessions", "booking_step_options", "translations", "locales", "availability_blocks", "uploads"],
  },
  {
    key: "crm", title: "4 · CRM çekirdek",
    blurb: "Müşteri kimliği, lead hattı, randevular, çağrılar, notlar, görevler.",
    tables: ["customers", "leads", "appointments", "calls", "vonage_events", "notes", "tasks"],
  },
  {
    key: "messaging", title: "5 · Mesajlaşma",
    blurb: "SMS konuşmaları, otomasyon kuyruğu (lead recovery / hatırlatıcı), kampanyalar, opt-out.",
    tables: ["sms_conversations", "sms_messages", "scheduled_messages", "campaigns", "campaign_recipients", "message_templates", "unsubscribes"],
  },
  {
    key: "reporting", title: "6 · Denetim & raporlama",
    blurb: "Kim ne yaptı (değiştirilemez kayıt) ve önceden toplanmış rapor tabloları.",
    tables: ["activity_log", "staff_presence", "staff_daily_stats", "location_daily_stats", "funnel_daily_stats", "attribution_daily_stats", "demand_heatmap", "rollup_checkpoints"],
  },
  {
    key: "system", title: "7 · Sistem",
    blurb: "Entegrasyon anahtarları, webhook kutusu, realtime yayını, bildirimler, rate limit.",
    tables: ["integrations", "webhook_deliveries", "realtime_events", "notifications", "rate_limits", "workspace_settings"],
  },
];

interface Column extends Record<string, unknown> { table: string; name: string; type: string; nullable: boolean; isPk: boolean }
interface Fk extends Record<string, unknown> { fromTable: string; fromCol: string; toTable: string; toCol: string }

/** Mermaid dislikes most punctuation inside a type token. */
const safeType = (t: string) =>
  t.replace(/ /g, "_").replace(/[^\w]/g, "").slice(0, 28) || "text";

async function main() {
  const columns = (await db.execute<Column>(sql`
    select c.table_name          as table,
           c.column_name         as name,
           c.data_type           as type,
           c.is_nullable = 'YES' as nullable,
           coalesce(pk.is_pk, false) as "isPk"
      from information_schema.columns c
      left join (
        select kcu.table_name, kcu.column_name, true as is_pk
          from information_schema.table_constraints tc
          join information_schema.key_column_usage kcu
            on kcu.constraint_name = tc.constraint_name
         where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = 'public'
      ) pk on pk.table_name = c.table_name and pk.column_name = c.column_name
     where c.table_schema = 'public'
     order by c.table_name, c.ordinal_position
  `)).rows;

  const fks = (await db.execute<Fk>(sql`
    select kcu.table_name       as "fromTable",
           kcu.column_name      as "fromCol",
           ccu.table_name       as "toTable",
           ccu.column_name      as "toCol"
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
     where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
     order by 1, 2
  `)).rows;

  const rowCounts = new Map<string, number>();
  for (const d of DOMAINS) {
    for (const t of d.tables) {
      const r = await db.execute<Record<string, unknown> & { n: string }>(sql.raw(`select count(*)::text as n from "${t}"`));
      rowCounts.set(t, Number(r.rows[0]?.n ?? 0));
    }
  }

  const relKinds = (await db.execute<Record<string, unknown> & { name: string; kind: string }>(sql`
    select table_name as name, table_type as kind
      from information_schema.tables where table_schema = 'public'
  `)).rows;
  const tableCount = relKinds.filter((r) => r.kind === "BASE TABLE").length;
  const viewCount = relKinds.length - tableCount;

  const byTable = new Map<string, Column[]>();
  for (const c of columns) {
    if (!byTable.has(c.table)) byTable.set(c.table, []);
    byTable.get(c.table)!.push(c);
  }

  const domainOf = new Map<string, string>();
  for (const d of DOMAINS) for (const t of d.tables) domainOf.set(t, d.title);

  const out: string[] = [
    "# Cleopatra v3 — Veritabanı Şeması",
    "",
    "> Bu dosya **canlı veritabanından** üretilir: `npx tsx scripts/erd.ts`.",
    "> Şema değişince yeniden çalıştır; diyagram asla koddan sapmaz.",
    "",
    `Üretim: ${new Date().toISOString()} · ${tableCount} tablo · ${viewCount} view · ${fks.length} yabancı anahtar`,
    "",
    "---",
    "",
    "## Genel görünüm",
    "",
    "Domainler arası bağlar. Her domainin detayı aşağıda.",
    "",
    "```mermaid",
    "flowchart LR",
  ];

  // Overview: domain boxes with the cross-domain edges between them.
  for (const d of DOMAINS) {
    out.push(`  subgraph ${d.key}["${d.title}"]`);
    out.push(`    direction TB`);
    for (const t of d.tables) out.push(`    ${t}["${t}<br/>${rowCounts.get(t) ?? 0} satır"]`);
    out.push("  end");
  }
  const seen = new Set<string>();
  for (const fk of fks) {
    const a = domainOf.get(fk.fromTable);
    const b = domainOf.get(fk.toTable);
    if (!a || !b || a === b) continue;
    const id = `${fk.fromTable}->${fk.toTable}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(`  ${fk.fromTable} --> ${fk.toTable}`);
  }
  out.push("```", "");

  // Per-domain ER diagrams.
  for (const d of DOMAINS) {
    out.push("---", "", `## ${d.title}`, "", d.blurb, "", "```mermaid", "erDiagram");

    for (const t of d.tables) {
      const cols = byTable.get(t) ?? [];
      out.push(`  ${t} {`);
      for (const c of cols) {
        const tags = [c.isPk ? "PK" : "", fks.some((f) => f.fromTable === t && f.fromCol === c.name) ? "FK" : ""]
          .filter(Boolean).join(",");
        out.push(`    ${safeType(c.type)} ${c.name}${tags ? ` "${tags}"` : ""}`);
      }
      out.push("  }");
    }

    const inside = new Set(d.tables);
    const drawn = new Set<string>();
    for (const fk of fks) {
      if (!inside.has(fk.fromTable) || !inside.has(fk.toTable)) continue;
      const id = `${fk.toTable}|${fk.fromTable}`;
      if (drawn.has(id)) continue;
      drawn.add(id);
      const optional = byTable.get(fk.fromTable)?.find((c) => c.name === fk.fromCol)?.nullable;
      out.push(`  ${fk.toTable} ${optional ? "||--o{" : "||--|{"} ${fk.fromTable} : "${fk.fromCol}"`);
    }
    out.push("```", "");

    // Cross-domain links, listed rather than drawn, to keep the picture calm.
    const external = fks.filter(
      (f) => inside.has(f.fromTable) && !inside.has(f.toTable) && domainOf.has(f.toTable),
    );
    if (external.length) {
      out.push("**Bu domainden dışarı çıkan bağlar**", "");
      out.push("| Tablo | Kolon | → Hedef |", "|---|---|---|");
      for (const f of external) out.push(`| \`${f.fromTable}\` | \`${f.fromCol}\` | \`${f.toTable}.${f.toCol}\` |`);
      out.push("");
    }
  }

  mkdirSync(resolve("docs"), { recursive: true });
  const file = resolve("docs/SCHEMA.md");
  writeFileSync(file, out.join("\n"));
  console.log(`✓ ${file}\n  ${tableCount} tables · ${viewCount} view(s) · ${fks.length} foreign keys · ${DOMAINS.length} domains`);
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
