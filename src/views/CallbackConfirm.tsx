import { useEffect, useState } from "react";
import { useStore } from "../store";
import { Btn, I, StaffPicker } from "../ui";
import { prettyPhone, studioById } from "../data";
import { t, tf, useI18n } from "../i18n";
import type { AssignableStaff } from "../services/crmApi";

/* ── Handing a callback to someone ─────────────────────────────────────
 * This dialog used to offer to dial. It does not any more, because dialling
 * does not work: Vonage rings the customer, and the leg meant for us reaches
 * a handset nobody is at — so the customer answers to silence. A button that
 * disturbs a stranger and connects them to nothing is worse than no button,
 * so it is gone until the handset routing is solved on spike/web-dialer.
 *
 * What is left is the thing that does work end to end: the callback becomes
 * a task with a name on it. That person sees it in their queue and rings
 * from their own phone, and the number leaves the callback list so nobody
 * calls twice.
 * ────────────────────────────────────────────────────────────────── */
export default function CallbackConfirm() {
  const { pendingCallback, resolveCallback, session } = useStore();
  useI18n();
  const [assignee, setAssignee] = useState<{ id: number; name: string } | null>(null);

  /* Reset between openings — the person chosen for the last callback is not
     a sensible default for the next one. */
  useEffect(() => {
    if (pendingCallback) setAssignee(null);
  }, [pendingCallback]);

  useEffect(() => {
    if (!pendingCallback) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") resolveCallback("cancel"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingCallback, resolveCallback]);

  if (!pendingCallback) return null;
  const p = pendingCallback;
  const studio = studioById(p.locationId);
  /* Unassigned work is nobody's work, so it defaults to the person raising
     it rather than to an empty queue. */
  const owner = assignee ?? (session ? { id: session.id, name: session.name } : null);

  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-ink-deep/70 px-4 backdrop-blur-sm animate-pop"
      onClick={() => resolveCallback("cancel")}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-[430px] overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-ink-700 px-5 py-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-gold-500/40 bg-gold-500/10 text-gold-400">
            <I name="checks" size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-[16px] font-bold tracking-wide text-ink-50">{t("Hand this callback to someone")}</h3>
            <div className="truncate text-[12.5px] font-semibold text-ink-300">{p.name}</div>
            <div className="num text-[11.5px] font-semibold text-ink-500">
              {prettyPhone(p.phone)}{studio ? ` · ${studio.slug}` : ""}
            </div>
          </div>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-ink-500">{t("Assign to")}</span>
            <StaffPicker
              current={owner?.id ?? null}
              locationId={p.locationId}
              label={owner?.name ?? t("Choose someone")}
              onPick={(person: AssignableStaff | null, close: () => void) => {
                setAssignee(person ? { id: person.id, name: person.name } : null);
                close();
              }}
            />
          </div>

          <p className="text-[12px] font-semibold leading-relaxed text-ink-400">
            {t("They will see it in their task queue and ring the customer from their own phone. The number leaves the callback list, so nobody calls twice.")}
          </p>

          {/* Said, not hidden. Somebody will look for the button that was
              here yesterday and deserves to know where it went. */}
          <div className="flex items-start gap-2 rounded-xl border border-ink-700 bg-ink-900/60 px-3 py-2.5">
            <I name="alert" size={14} className="mt-0.5 shrink-0 text-[#e8a33d]" />
            <p className="text-[11.5px] font-semibold leading-relaxed text-ink-400">
              {t("Dialling from the console is switched off: the customer's phone rings but ours does not, so they would answer to silence.")}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-700 px-5 py-4">
          <Btn variant="ghost" onClick={() => resolveCallback("cancel")}>{t("Cancel")}</Btn>
          <Btn variant="gold" onClick={() => resolveCallback("task", owner?.id ?? null)}>
            <I name="check" size={14} />
            {owner ? tf("Assign to {name}", { name: owner.name.split(" ")[0] }) : t("Create a task")}
          </Btn>
        </div>
      </div>
    </div>
  );
}
