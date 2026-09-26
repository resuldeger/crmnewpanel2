import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { redis } from "@/server/redis";
import { JOBS } from "@/server/jobs";
import { activeTransport } from "@/server/twilio/transport";
import { healthReport, type IntegrationHealth } from "./health";

/* ── Whether the outside world is still talking to us ──────────────────
 * Every number in this console arrives from somewhere else: the call log
 * and the recordings from Vonage, the diaries from 126 Timely feeds, the
 * messages from Twilio. When one of those stops, the symptom is not an
 * error — it is a screen that looks fine and is quietly out of date. That
 * is exactly how a whole day of calls went missing: the worker was not
 * running, nothing said so, and the board simply showed yesterday.
 *
 * So this reports EVIDENCE rather than configuration. "Vonage is
 * configured" is worth almost nothing; "the last call arrived four minutes
 * ago and the recordings API refused us an hour ago" is the answer.
 *
 * It deliberately makes no request to Vonage, Twilio or Timely. A status
 * page that probes a provider on every page load is a page that hammers a
 * refused credential — and with Vonage each refusal extends the account
 * lockout, which is how one locked account stayed locked for eight hours.
 * Everything here is read from what the jobs already recorded. Only the two
 * services on this machine (Redis, the realtime gateway) are pinged, and
 * they are free.
 * ────────────────────────────────────────────────────────────────── */

export type Status = "ok" | "degraded" | "down" | "halted" | "off" | "unconfigured";

const RANK: Record<Status, number> = {
  ok: 0,
  off: 1,
  unconfigured: 2,
  degraded: 3,
  down: 4,
  halted: 5,
};

/** The worst of several — a source is only as healthy as its sickest part. */
function worst(list: Status[]): Status {
  return list.reduce<Status>((acc, s) => (RANK[s] > RANK[acc] ? s : acc), "ok");
}

/** The checks that decide a source's colour, which is not all of them. */
function counted(checks: Check[]): Status[] {
  return checks.filter((c) => !c.optional).map((c) => c.status);
}

export interface Check {
  id: string;
  label: string;
  status: Status;
  /** One line saying why, in the provider's own words where there are any. */
  detail: string | null;
  at: string | null;
  /**
   * Reported, but not counted against the source.
   *
   * Transcription is switched off and that is fine — nothing is broken and
   * nobody is waiting on it. Rolled into the total it turned a working
   * recordings integration amber, which is how a status page teaches people
   * to ignore its colours.
   */
  optional?: boolean;
}

export interface JobHealth {
  name: string;
  everySeconds: number;
  configured: boolean;
  running: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  /** Not merely late: past three intervals, so a slow run is not an alarm. */
  overdue: boolean;
  status: Status;
}

export interface Freshness {
  label: string;
  at: string | null;
  count: number | null;
  /** Where the number came from, so nobody has to guess what it counts. */
  of: number | null;
}

export interface SourceHealth {
  id: string;
  label: string;
  kind: "telephony" | "messaging" | "calendar" | "email" | "security" | "infra";
  status: Status;
  summary: string;
  /** null where the source needs no credential of ours (a public feed). */
  credential: "present" | "absent" | null;
  enabled: boolean;
  halt: {
    reason: string | null;
    detail: string | null;
    at: string | null;
    failureCount: number;
    clearedByName: string | null;
  } | null;
  jobs: JobHealth[];
  checks: Check[];
  freshness: Freshness[];
  /** What a person should do about it, when there is something to do. */
  action: string | null;
}

export interface SystemHealth {
  generatedAt: string;
  status: Status;
  worker: {
    alive: boolean;
    lastBeatAt: string | null;
    staleSeconds: number | null;
    pid: string | null;
    startedAt: string | null;
    uptimeSeconds: number | null;
    beatEverySeconds: number;
  };
  sources: SourceHealth[];
}

const iso = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const v = d instanceof Date ? d : new Date(d);
  return Number.isNaN(v.getTime()) ? null : v.toISOString();
};

/* ── The one query that says how stale everything is ───────────────────
 * One statement rather than a dozen round trips, because this is a status
 * page and it must not itself be the slow thing on the screen. */
interface Facts extends Record<string, unknown> {
  calls_total: number;
  calls_last_at: Date | null;
  calls_answered: number;
  calls_with_audio: number;
  calls_cached: number;
  calls_transcribed: number;
  recording_last_at: Date | null;
  sms_out: number;
  sms_in: number;
  sms_last_at: Date | null;
  sms_queued: number;
  sms_failed: number;
  scheduled_pending: number;
  campaigns_active: number;
  studios_total: number;
  studios_twilio: number;
  studios_sms_auto: number;
  feeds_total: number;
  feeds_failing: number;
  feeds_checked_at: Date | null;
  timely_blocks: number;
  webhooks_total: number;
  webhooks_last_at: Date | null;
  /** Unsigned in the LAST DAY. An unsigned delivery from a rehearsal months
   *  ago is history, not a live problem, and counting it forever left the
   *  panel permanently amber over a webhook test we ran ourselves. */
  webhooks_unsigned: number;
  extensions_total: number;
  extensions_mapped: number;
  events_total: number;
  events_last_at: Date | null;
}

async function facts(): Promise<Facts> {
  const { rows } = await db.execute<Facts>(sql`
    select
      (select count(*)::int from calls)                                            as calls_total,
      (select max(start_time) from calls)                                          as calls_last_at,
      (select count(*)::int from calls where result = 'Answered')                   as calls_answered,
      (select count(*)::int from calls where recording_url is not null)             as calls_with_audio,
      (select count(*)::int from calls where recording_path is not null)            as calls_cached,
      (select count(*)::int from calls where recording_transcript is not null)      as calls_transcribed,
      (select max(start_time) from calls where recording_url is not null)           as recording_last_at,
      (select count(*)::int from sms_messages where direction = 'outbound')         as sms_out,
      (select count(*)::int from sms_messages where direction = 'inbound')          as sms_in,
      (select max(created_at) from sms_messages)                                    as sms_last_at,
      (select count(*)::int from sms_messages where status in ('scheduled','queued','processing')) as sms_queued,
      (select count(*)::int from sms_messages where status = 'failed')              as sms_failed,
      (select count(*)::int from scheduled_messages
         where status = 'scheduled' and cancelled_at is null)                    as scheduled_pending,
      (select count(*)::int from campaigns where status in ('scheduled','sending')) as campaigns_active,
      (select count(*)::int from locations)                                         as studios_total,
      (select count(*)::int from locations where twilio ? 'authToken')              as studios_twilio,
      (select count(*)::int from locations
         where coalesce((twilio->>'smsAutomation')::boolean, false))                as studios_sms_auto,
      (select count(*)::int from artists where active and calendar_feed_url is not null) as feeds_total,
      (select count(*)::int from artists
         where active and calendar_feed_url is not null and feed_error is not null) as feeds_failing,
      (select max(feed_checked_at) from artists)                                    as feeds_checked_at,
      (select count(*)::int from availability_blocks where source = 'timely')       as timely_blocks,
      (select count(*)::int from webhook_deliveries)                                as webhooks_total,
      (select max(received_at) from webhook_deliveries)                             as webhooks_last_at,
      (select count(*)::int from webhook_deliveries
         where signature_valid = false and received_at > now() - interval '24 hours') as webhooks_unsigned,
      (select count(*)::int from extensions)                                        as extensions_total,
      (select count(*)::int from extensions where location_id is not null)          as extensions_mapped,
      (select count(*)::int from vonage_events)                                     as events_total,
      (select max(occurred_at) from vonage_events)                                  as events_last_at
  `);
  return rows[0];
}

interface Checkpoint extends Record<string, unknown> {
  name: string;
  last_processed_id: string | null;
  last_run_at: Date | null;
  last_success_at: Date | null;
  running: boolean;
  last_error: string | null;
}

/** How stale a job may be before it counts as stopped rather than slow. */
const OVERDUE_FACTOR = 3;

/** The runner's own row in rollup_checkpoints, and how often it writes it. */
const WORKER_ROW = "worker";
const HEARTBEAT_MS = 30_000;
/** Beats we tolerate missing before calling the worker dead. */
const MISSED_BEATS = 3;

function jobHealth(
  checkpoints: Map<string, Checkpoint>,
  now: number,
  /** How long the worker has been up, or null when it is not running. */
  uptimeMs: number | null,
): Map<string, JobHealth> {
  const out = new Map<string, JobHealth>();

  for (const job of JOBS) {
    const cp = checkpoints.get(job.name);
    /* `requires` is the job's own view of whether its credentials exist. It
       is the same predicate the runner uses to skip it at boot, so a job
       shown as "not configured" here is genuinely not running. */
    const configured = job.requires ? job.requires() : true;
    const lastRun = cp?.last_run_at ? new Date(cp.last_run_at).getTime() : null;
    /* Late is measured against how long the worker has had the chance to run
       it. The twelve-hourly jobs are `skipOnBoot`, so four minutes after a
       restart their last run is genuinely yesterday's — calling that "down"
       would put a red light on every fresh start and teach everyone to
       ignore the panel. */
    const hadTheChance = uptimeMs === null || uptimeMs > job.everyMs;
    const overdue =
      configured && hadTheChance && lastRun !== null && now - lastRun > job.everyMs * OVERDUE_FACTOR;

    let status: Status = "ok";
    if (!configured) status = "off";
    else if (lastRun === null) status = "unconfigured";
    else if (overdue) status = "down";
    else if (cp?.last_error) status = "degraded";

    out.set(job.name, {
      name: job.name,
      everySeconds: Math.round(job.everyMs / 1000),
      configured,
      running: cp?.running ?? false,
      lastRunAt: iso(cp?.last_run_at ?? null),
      lastSuccessAt: iso(cp?.last_success_at ?? null),
      lastError: cp?.last_error ?? null,
      overdue,
      status,
    });
  }

  return out;
}

/** Is anything on this machine listening on the realtime port? */
async function realtimeAlive(): Promise<{ ok: boolean; detail: string }> {
  const port = process.env.REALTIME_PORT ?? process.env.NEXT_PUBLIC_REALTIME_PORT ?? "4001";
  try {
    /* The gateway answers 404 to plain HTTP by design — it serves sockets
       only. Any answer at all proves it is up, so the status code is
       deliberately not checked. */
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1_500) });
    return { ok: true, detail: `listening on :${port}` };
  } catch (err) {
    return { ok: false, detail: `:${port} — ${(err as Error).message}` };
  }
}

async function redisAlive(): Promise<{ ok: boolean; detail: string }> {
  try {
    const started = Date.now();
    await redis.ping();
    return { ok: true, detail: `PING ${Date.now() - started}ms` };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

const ago = (at: Date | null): string => {
  if (!at) return "never";
  const mins = Math.round((Date.now() - new Date(at).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

export async function systemHealth(): Promise<SystemHealth> {
  const now = Date.now();

  const [integrationRows, checkpointRows, f, rt, rd] = await Promise.all([
    healthReport(),
    db
      .execute<Checkpoint>(
        sql`select name, last_run_at, last_success_at, last_processed_id, running, last_error from rollup_checkpoints`,
      )
      .then((r) => r.rows),
    facts(),
    realtimeAlive(),
    redisAlive(),
  ]);

  const ints = new Map<string, IntegrationHealth>(integrationRows.map((r) => [r.provider, r]));
  const checkpoints = new Map(checkpointRows.map((r) => [r.name, r]));

  /* ── Is the worker alive? ─────────────────────────────────────────
   * The runner writes a beat every 30 seconds under the name 'worker', and
   * puts its own start time in `last_success_at`. That is the only reading
   * here that does not depend on a job having something to do: a quiet
   * night and a dead process look identical in every other column. */
  const beat = checkpoints.get(WORKER_ROW);
  const beatAt = beat?.last_run_at ? new Date(beat.last_run_at).getTime() : null;
  const staleSeconds = beatAt === null ? null : Math.round((now - beatAt) / 1000);
  const workerAlive = beatAt !== null && now - beatAt < HEARTBEAT_MS * MISSED_BEATS;
  const bootAt = beat?.last_success_at ? new Date(beat.last_success_at).getTime() : null;
  const uptimeMs = workerAlive && bootAt !== null ? now - bootAt : null;

  const jobs = jobHealth(checkpoints, now, uptimeMs);
  const uptime =
    uptimeMs === null
      ? "unknown"
      : uptimeMs < 3_600_000
        ? `${Math.round(uptimeMs / 60_000)}m`
        : `${Math.round(uptimeMs / 3_600_000)}h`;

  const job = (name: string): JobHealth[] => {
    const j = jobs.get(name);
    return j ? [j] : [];
  };

  const haltOf = (provider: string): SourceHealth["halt"] => {
    const row = ints.get(provider);
    if (!row?.halted) return null;
    return {
      reason: row.haltReason,
      detail: row.haltDetail,
      at: iso(row.haltedAt),
      failureCount: row.failureCount,
      clearedByName: row.clearedByName,
    };
  };

  /* A failure that has not yet halted the integration still matters — it is
     the difference between "working" and "working for now". */
  const pending = (provider: string): Check[] => {
    const row = ints.get(provider);
    if (!row || row.halted || row.failureCount === 0) return [];
    return [
      {
        id: `${provider}.failing`,
        label: "Recent failures",
        status: "degraded",
        detail: `${row.failureCount} consecutive · ${row.haltReason ?? "see the job error"}`,
        at: iso(row.lastFailedAt),
      },
    ];
  };

  const vonageCred = Boolean(process.env.VONAGE_CONSUMER_KEY && process.env.VONAGE_PASSWORD);

  const sources: SourceHealth[] = [];

  /* ── Vonage · the call log ─────────────────────────────────────── */
  {
    const sync = jobs.get("vonage-sync");
    const directory = jobs.get("vonage-directory");
    const checks: Check[] = [
      {
        id: "vonage.reports",
        label: "Reports API — finished calls",
        status: sync?.status ?? "unconfigured",
        detail: sync?.lastError ?? `${f.calls_total} call(s) imported`,
        at: sync?.lastSuccessAt ?? null,
      },
      {
        id: "vonage.provisioning",
        label: "Provisioning API — extensions & branches",
        status: directory?.status ?? "unconfigured",
        detail:
          directory?.lastError ??
          `${f.extensions_mapped}/${f.extensions_total} extension(s) matched to a studio`,
        at: directory?.lastSuccessAt ?? null,
      },
      {
        id: "vonage.telephony",
        label: "Telephony API — live board & click-to-call",
        status: process.env.VONAGE_TELEPHONY_ENABLED === "0" ? "off" : rt.ok ? "ok" : "down",
        detail:
          process.env.VONAGE_TELEPHONY_ENABLED === "0"
            ? "switched off by VONAGE_TELEPHONY_ENABLED=0"
            : `polled by the realtime gateway — ${rt.detail}`,
        at: null,
      },
      {
        id: "vonage.webhook",
        label: "VIS webhook — call events as they happen",
        status: f.events_total > 0 ? "ok" : "off",
        detail:
          f.events_total > 0
            ? `${f.events_total} event(s), last ${ago(f.events_last_at)}`
            : "not registered — the live board falls back to polling",
        at: iso(f.events_last_at),
      },
      ...pending("vonage"),
    ];

    const status = haltOf("vonage")
      ? "halted"
      : !vonageCred
        ? "unconfigured"
        : worst(counted(checks));

    sources.push({
      id: "vonage",
      label: "Vonage VBC",
      kind: "telephony",
      status,
      summary: `${f.calls_total} call(s) · last ${ago(f.calls_last_at)}`,
      credential: vonageCred ? "present" : "absent",
      enabled: ints.get("vonage")?.enabled ?? false,
      halt: haltOf("vonage"),
      jobs: [...job("vonage-sync"), ...job("vonage-directory")],
      checks,
      freshness: [
        { label: "Calls imported", at: iso(f.calls_last_at), count: f.calls_total, of: null },
        { label: "Extensions mapped", at: directory?.lastSuccessAt ?? null, count: f.extensions_mapped, of: f.extensions_total },
        { label: "Live call events", at: iso(f.events_last_at), count: f.events_total, of: null },
      ],
      action:
        directory?.status === "degraded" || directory?.status === "down"
          ? "The directory refresh is failing — extensions and branch lines will go stale."
          : null,
    });
  }

  /* ── Vonage · recordings, which fail for their own reason ──────── */
  {
    const rec = jobs.get("vonage-recordings");
    const halt = haltOf("vonage-recordings");
    const checks: Check[] = [
      {
        id: "recordings.api",
        label: "Company Call Recording API",
        status: rec?.status ?? "unconfigured",
        detail: rec?.lastError ?? ints.get("vonage-recordings")?.haltReason ?? "answering",
        at: rec?.lastSuccessAt ?? null,
      },
      {
        id: "recordings.coverage",
        label: "Answered calls with audio",
        status: f.calls_answered > 0 && f.calls_with_audio / f.calls_answered < 0.8 ? "degraded" : "ok",
        detail: `${f.calls_with_audio}/${f.calls_answered}`,
        at: iso(f.recording_last_at),
      },
      {
        id: "recordings.transcript",
        label: "Transcription",
        status: "off",
        optional: true,
        detail:
          f.calls_transcribed > 0
            ? `${f.calls_transcribed} transcribed`
            : "no service connected — the column and the player are ready",
        at: null,
      },
      ...pending("vonage-recordings"),
    ];

    sources.push({
      id: "vonage-recordings",
      label: "Vonage Call Recordings",
      kind: "telephony",
      status: halt ? "halted" : worst(counted(checks)),
      summary: `${f.calls_with_audio}/${f.calls_answered} answered call(s) have audio`,
      credential: vonageCred ? "present" : "absent",
      enabled: ints.get("vonage-recordings")?.enabled ?? false,
      halt,
      jobs: job("vonage-recordings"),
      checks,
      freshness: [
        { label: "Audio attached", at: iso(f.recording_last_at), count: f.calls_with_audio, of: f.calls_answered },
        { label: "Cached on our disk", at: null, count: f.calls_cached, of: f.calls_with_audio },
      ],
      action:
        rec?.lastError?.includes("401") || rec?.lastError?.includes("403")
          ? "The API user needs the Company Call Recording permission in VBC admin."
          : null,
    });
  }

  /* ── Twilio · messaging ───────────────────────────────────────── */
  {
    const transport = activeTransport();
    const envCred = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
    const checks: Check[] = [
      {
        id: "twilio.transport",
        label: "Transport",
        status: transport === "twilio" ? "ok" : "off",
        detail:
          transport === "twilio"
            ? "SMS_TRANSPORT=twilio — messages are really sent and really billed"
            : "SMS_TRANSPORT=log — nothing leaves this machine",
        at: null,
      },
      {
        id: "twilio.studios",
        label: "Studios with credentials",
        status: f.studios_twilio === 0 ? "unconfigured" : "ok",
        /* Per studio, not per account: each branch sends from its own number
           so the customer sees the branch they called. */
        detail: `${f.studios_twilio}/${f.studios_total} studio(s) · ${f.studios_sms_auto} with automation on`,
        at: null,
      },
      {
        id: "twilio.inbound",
        label: "Inbound & status webhooks",
        status: f.webhooks_total === 0 ? "off" : f.webhooks_unsigned > 0 ? "degraded" : "ok",
        detail:
          f.webhooks_total === 0
            ? "nothing received yet — PUBLIC_BASE_URL must be reachable from the internet"
            : `${f.webhooks_total} delivery(s)${f.webhooks_unsigned > 0 ? `, ${f.webhooks_unsigned} unsigned in the last day` : ""}`,
        at: iso(f.webhooks_last_at),
      },
      {
        id: "twilio.queue",
        label: "Send queue",
        status: f.sms_failed > 0 ? "degraded" : "ok",
        detail: `${f.scheduled_pending} scheduled · ${f.sms_queued} in flight · ${f.sms_failed} failed`,
        at: null,
      },
      ...pending("twilio"),
    ];

    sources.push({
      id: "twilio",
      label: "Twilio",
      kind: "messaging",
      status: haltOf("twilio") ? "halted" : worst(counted(checks)),
      summary: `${f.sms_out} sent · ${f.sms_in} received · last ${ago(f.sms_last_at)}`,
      credential: f.studios_twilio > 0 || envCred ? "present" : "absent",
      enabled: ints.get("twilio")?.enabled ?? false,
      halt: haltOf("twilio"),
      jobs: [...job("scheduled-sms"), ...job("campaign-dispatcher")],
      checks,
      freshness: [
        { label: "Messages", at: iso(f.sms_last_at), count: f.sms_out + f.sms_in, of: null },
        { label: "Webhook deliveries", at: iso(f.webhooks_last_at), count: f.webhooks_total, of: null },
      ],
      action:
        transport === "twilio" && f.studios_sms_auto > 0
          ? `${f.studios_sms_auto} studio(s) send real messages — every test on those costs money.`
          : null,
    });
  }

  /* ── Timely · 126 iCalendar feeds ─────────────────────────────── */
  {
    const ts = jobs.get("timely-sync");
    const failing = f.feeds_failing;
    const checks: Check[] = [
      {
        id: "timely.job",
        label: "Feed sweep",
        status: ts?.status ?? "unconfigured",
        detail: ts?.lastError ?? `${f.feeds_total} feed(s) read every ${Math.round((ts?.everySeconds ?? 1800) / 60)}m`,
        at: ts?.lastSuccessAt ?? null,
      },
      {
        id: "timely.feeds",
        label: "Feeds answering",
        /* A dead feed is not a broken integration: the artist has left, or
           Timely retired the token. It is still a studio whose diary we are
           not reading, so it is never "ok" while it lasts. */
        status: failing === 0 ? "ok" : failing > f.feeds_total / 2 ? "down" : "degraded",
        detail: `${f.feeds_total - failing}/${f.feeds_total} answering · ${failing} failing`,
        at: iso(f.feeds_checked_at),
      },
      ...pending("timely"),
    ];

    sources.push({
      id: "timely",
      label: "Timely (calendar feeds)",
      kind: "calendar",
      status: haltOf("timely") ? "halted" : worst(counted(checks)),
      summary: `${f.timely_blocks} busy block(s) · last swept ${ago(f.feeds_checked_at)}`,
      /* No credential of ours: the token is in each feed's URL, which is why
         a retired artist's feed simply 404s rather than failing to log in. */
      credential: null,
      enabled: ints.get("timely")?.enabled ?? false,
      halt: haltOf("timely"),
      jobs: job("timely-sync"),
      checks,
      freshness: [
        { label: "Busy blocks", at: iso(f.feeds_checked_at), count: f.timely_blocks, of: null },
        { label: "Feeds answering", at: iso(f.feeds_checked_at), count: f.feeds_total - failing, of: f.feeds_total },
      ],
      action:
        failing > 0
          ? `${failing} feed(s) return an error every sweep — each one is an artist whose diary we cannot see.`
          : null,
    });
  }

  /* ── Things that only matter because everything else runs on them ── */
  {
    const internal = ["sla-monitor", "rollups", "winback", "duplicate-detector", "retention"]
      .flatMap(job);
    const checks: Check[] = [
      {
        id: "infra.worker",
        label: "Background worker",
        status: workerAlive ? "ok" : "down",
        detail: workerAlive
          ? `checked in ${staleSeconds}s ago · up ${uptime}`
          : staleSeconds !== null
            ? `no heartbeat for ${staleSeconds}s — it beats every ${HEARTBEAT_MS / 1000}s`
            : "the worker has never run on this database",
        at: iso(beat?.last_run_at ?? null),
      },
      {
        id: "infra.redis",
        label: "Redis",
        status: rd.ok ? "ok" : "down",
        detail: rd.detail,
        at: null,
      },
      {
        id: "infra.realtime",
        label: "Realtime gateway",
        status: rt.ok ? "ok" : "down",
        detail: rt.detail,
        at: null,
      },
      ...internal
        .filter((j) => j.status !== "ok")
        .map<Check>((j) => ({
          id: `infra.${j.name}`,
          label: j.name,
          status: j.status,
          detail: j.lastError ?? (j.overdue ? `last ran ${ago(new Date(j.lastRunAt!))}` : null),
          at: j.lastSuccessAt,
        })),
    ];

    sources.push({
      id: "platform",
      label: "Platform",
      kind: "infra",
      status: worst(counted(checks)),
      summary: workerAlive ? "the worker is running" : "the worker is not running",
      credential: null,
      enabled: true,
      halt: null,
      jobs: internal,
      checks,
      freshness: [],
      action: workerAlive
        ? null
        : "Nothing is importing calls, sending scheduled messages or raising SLA tasks. Start the worker.",
    });
  }

  /* ── The ones that exist as rows and nothing more ─────────────── */
  for (const [id, label, kind, note] of [
    ["smtp", "Email (SMTP)", "email", "no server configured — invitations and the daily digest cannot be sent"],
    ["turnstile", "Cloudflare Turnstile", "security", "bot protection on the public booking form"],
  ] as const) {
    const row = ints.get(id);
    const configured = id === "turnstile" ? Boolean(row?.enabled) : false;
    sources.push({
      id,
      label,
      kind,
      status: haltOf(id) ? "halted" : configured ? "ok" : "unconfigured",
      summary: note,
      credential: configured ? "present" : "absent",
      enabled: row?.enabled ?? false,
      halt: haltOf(id),
      jobs: [],
      checks: [],
      freshness: [],
      action: null,
    });
  }

  return {
    generatedAt: new Date(now).toISOString(),
    /* The platform is weighted like any other source on purpose: a dead
       worker is not a footnote next to a healthy Vonage — it is the reason
       Vonage looks healthy and is not being asked anything. */
    status: worst(sources.map((s) => s.status)),
    worker: {
      alive: workerAlive,
      lastBeatAt: iso(beat?.last_run_at ?? null),
      staleSeconds,
      /* The process id and its start time, so "it restarted" and "it never
         stopped" are answerable without reading a log. */
      pid: typeof beat?.last_processed_id === "string" ? beat.last_processed_id : null,
      startedAt: iso(beat?.last_success_at ?? null),
      uptimeSeconds: uptimeMs === null ? null : Math.round(uptimeMs / 1000),
      beatEverySeconds: HEARTBEAT_MS / 1000,
    },
    sources,
  };
}
