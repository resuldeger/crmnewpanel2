import { useCallback, useEffect, useState } from "react";
import { useStore } from "../store";
import { Btn, I } from "../ui";
import { t, tf } from "../i18n";

/* ── The banner that says why something stopped ────────────────────────
 * When an integration halts, the symptom is silence: no calls appear, no
 * SMS goes out, the calendar stops filling. Nothing on screen says why,
 * and the cause sits in a worker log nobody is reading — which is how a
 * locked Vonage account went unexplained for eight hours.
 *
 * So it is said on every page, not tucked into settings, and clearing it
 * is a deliberate act by someone who has fixed the cause.
 * ────────────────────────────────────────────────────────────────── */

export interface IntegrationState {
  provider: string;
  label: string;
  halted: boolean;
  haltReason: string | null;
  haltDetail: string | null;
  haltedAt: string | null;
  failureCount: number;
  clearedByName: string | null;
}

/** Polls rarely: a halt is rare and the realtime event covers the moment it happens. */
const POLL_MS = 60_000;

export function useIntegrationHealth() {
  const [items, setItems] = useState<IntegrationState[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/crm/integrations", { credentials: "same-origin" });
      if (!res.ok) return;
      const d = (await res.json()) as { integrations: IntegrationState[] };
      setItems(d.integrations);
    } catch {
      /* The banner is a diagnostic; it must never itself become an error. */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const i = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(i);
  }, [refresh]);

  return { items, halted: items.filter((x) => x.halted), refresh };
}

export default function IntegrationHaltBanner() {
  const { can, toast } = useStore();
  const { halted, refresh } = useIntegrationHealth();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  if (halted.length === 0) return null;

  const clear = async (provider: string) => {
    setBusy(provider);
    try {
      const res = await fetch(`/api/crm/integrations/${provider}/clear`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        toast(b.message ?? t("Could not clear the halt"), "error");
        return;
      }
      toast(tf("{name} resumed", { name: provider }), "success");
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-[1480px] px-3 pt-4 md:px-6">
      {halted.map((x) => (
        <div key={x.provider} className="mb-3 overflow-hidden rounded-2xl border border-ember-500/50 bg-ember-500/8 shadow-panel">
          {/* Stacked on a phone. Side by side, the message was squeezed into a
              one-word column beside the buttons — the reason it is here at
              all is to be read. */}
          <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center md:px-5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-ember-500/50 bg-ember-500/12 text-ember-400">
              <I name="alert" size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-extrabold text-ink-100">
                {tf("{name} is stopped", { name: x.label })}
              </div>
              <div className="mt-0.5 text-[11.5px] font-semibold text-ink-300">
                {x.haltReason}
                {x.haltedAt && (
                  <span className="num text-ink-500"> · {new Date(x.haltedAt).toLocaleString()}</span>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {x.haltDetail && (
                <Btn size="sm" variant="ghost" onClick={() => setOpen(open === x.provider ? null : x.provider)}>
                  {open === x.provider ? t("Hide detail") : t("Detail")}
                </Btn>
              )}

            {/* Only someone who can change integration settings may assert
                the cause is fixed — and until they do, nothing retries. */}
            {can("settings.manage") ? (
              <Btn size="sm" variant="gold" disabled={busy === x.provider} onClick={() => void clear(x.provider)}>
                <I name="check" size={13} /> {busy === x.provider ? t("Resuming…") : t("Fixed — resume")}
              </Btn>
            ) : (
              <span className="text-[11px] font-bold text-ink-400">{t("An administrator must clear this.")}</span>
            )}
            </div>
          </div>

          {open === x.provider && x.haltDetail && (
            <pre className="num max-h-40 overflow-y-auto whitespace-pre-wrap break-all border-t border-ember-500/30 bg-ink-900/60 px-5 py-3 text-[11px] leading-relaxed text-ink-300">
              {x.haltDetail}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
