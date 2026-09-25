/* ── Applying the schema ───────────────────────────────────────────────
 * `drizzle-kit migrate` reads drizzle/meta/_journal.json, and that file
 * knows about twelve migrations while twenty-nine sit in drizzle/. The
 * other seventeen were written by hand and applied with psql, so they
 * never entered the journal.
 *
 * The result is a setup command that quietly does part of its job: a
 * fresh database migrated the documented way comes up seventeen
 * migrations behind, and the application then fails somewhere far from
 * the cause — a missing column on a query, not an error about the schema.
 *
 * So this replaces `db:migrate`. It applies every .sql in drizzle/ in
 * filename order, records what it applied, and never runs the same file
 * twice. The journal is left alone; drizzle-kit still generates into it.
 *
 *   npm run db:migrate              apply whatever is outstanding
 *   npm run db:migrate -- --dry-run say what would run, change nothing
 *   npm run db:migrate -- --baseline
 *                                   mark everything as applied WITHOUT
 *                                   running it — for a database that is
 *                                   already up to date because the files
 *                                   were applied by hand
 * ────────────────────────────────────────────────────────────────── */
import "./env";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const DIR = path.resolve("drizzle");

const TRACKING = `
  create table if not exists schema_migrations (
    name       text primary key,
    checksum   text not null,
    applied_at timestamptz not null default now()
  )
`;

const sha = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const baseline = process.argv.includes("--baseline");

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const files = (await readdir(DIR)).filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) throw new Error(`no .sql files in ${DIR}`);

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    await client.query(TRACKING);
    const { rows } = await client.query<{ name: string; checksum: string }>(
      "select name, checksum from schema_migrations",
    );
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));

    /* A file that changed after it ran is a rewritten history: the
       database has the old version and nothing will ever apply the new
       one. Worth saying out loud rather than skipping silently. */
    let drifted = 0;
    for (const file of files) {
      const known = applied.get(file);
      if (!known) continue;
      const current = sha(await readFile(path.join(DIR, file), "utf8"));
      if (current !== known) {
        console.warn(`  ! ${file} degisti (uygulanan: ${known}, diskteki: ${current})`);
        drifted += 1;
      }
    }

    const pending = files.filter((f) => !applied.has(f));

    if (baseline) {
      if (pending.length === 0) {
        console.log("baseline: uygulanacak yeni migration yok.");
        return;
      }
      for (const file of pending) {
        const body = await readFile(path.join(DIR, file), "utf8");
        await client.query("insert into schema_migrations (name, checksum) values ($1, $2)", [file, sha(body)]);
      }
      console.log(`baseline: ${pending.length} migration CALISTIRILMADAN uygulanmis olarak isaretlendi.`);
      return;
    }

    console.log(`${applied.size} uygulanmis, ${pending.length} bekliyor${dryRun ? "  (KURU CALISMA)" : ""}\n`);
    if (pending.length === 0) {
      if (drifted) console.log(`${drifted} dosya uygulandiktan sonra degismis — yukariya bakin.`);
      return;
    }

    for (const file of pending) {
      const body = await readFile(path.join(DIR, file), "utf8");
      if (dryRun) {
        console.log(`  · ${file}`);
        continue;
      }

      /* Each file in its own transaction, and the run stops at the first
         failure. Carrying on would leave the schema in a state no single
         migration describes, which is harder to recover from than a
         clear stop. */
      await client.query("begin");
      try {
        /* The whole file in one call, on the simple query protocol:
           splitting on ";" breaks every function body and trigger in
           here, and a prepared statement refuses more than one command. */
        await client.query(body);
        await client.query("insert into schema_migrations (name, checksum) values ($1, $2)", [file, sha(body)]);
        await client.query("commit");
        console.log(`  ✓ ${file}`);
      } catch (err) {
        await client.query("rollback").catch(() => undefined);
        console.error(`  ✗ ${file}\n    ${(err as Error).message}`);
        process.exitCode = 1;
        return;
      }
    }

    console.log(`\n${pending.length} migration uygulandi.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
