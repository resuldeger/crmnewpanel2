import { useEffect } from "react";
import { useStore } from "../store";
import { Btn, I } from "../ui";
import { prettyPhone, studioById } from "../data";
import { t, tf, useI18n } from "../i18n";

/* ── Before the customer's phone rings ─────────────────────────────────
 * "Call back" sits on six screens, and on two of them it is a small icon
 * in a table row next to one that opens a profile. A slip there rang a real
 * customer, and for a while rang them from a line nobody was sitting at, so
 * they answered to silence.
 *
 * The dialog says who is about to be rung and from which line, and offers
 * the other thing an agent usually wants: not "ring them now" but "put this
 * on the list". Raising a task also takes the number out of the callback
 * queue, so the two are the same decision seen from either end.
 * ────────────────────────────────────────────────────────────────── */
export default function CallbackConfirm() {
  const { pendingCallback, resolveCallback } = useStore();
  useI18n();

  /* Escape cancels. A modal over a customer's telephone should be as easy
     to back out of as it was to open. */
  useEffect(() => {
    if (!pendingCallback) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") resolveCallback("cancel"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingCallback, resolveCallback]);

  if (!pendingCallback) return null;
  const p = pendingCallback;
  const studio = studioById(p.locationId);

  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-ink-deep/70 px-4 backdrop-blur-sm animate-pop"
      onClick={() => resolveCallback("cancel")}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-[420px] overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-ink-700 px-5 py-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-gold-500/40 bg-gold-500/10 text-gold-400">
            <I name="phone" size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-[16px] font-bold tracking-wide text-ink-50">{t("Call this person back?")}</h3>
            <div className="truncate text-[12.5px] font-semibold text-ink-300">{p.name}</div>
            <div className="num text-[11.5px] font-semibold text-ink-500">
              {prettyPhone(p.phone)}{studio ? ` · ${studio.slug}` : ""}
            </div>
          </div>
        </div>

        <div className="space-y-2.5 px-5 py-4">
          <p className="text-[12px] font-semibold leading-relaxed text-ink-400">
            {/* Said plainly. Whoever is reading this is one click from a
                stranger's telephone ringing. */}
            {t("Your own line rings first. When you answer it, this number is dialled — it is a real call and it is billed.")}
          </p>
          <p className="text-[12px] font-semibold leading-relaxed text-ink-400">
            {t("Not now? Raise a task instead and it moves to somebody's list, out of the callback queue.")}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-700 px-5 py-4">
          <Btn variant="ghost" onClick={() => resolveCallback("cancel")}>{t("Cancel")}</Btn>
          <Btn variant="outline" onClick={() => resolveCallback("task")}>
            <I name="checks" size={14} /> {t("Create a task")}
          </Btn>
          <Btn variant="gold" onClick={() => resolveCallback("call")}>
            <I name="phone" size={14} /> {tf("Call {name}", { name: p.name.split(" ")[0] })}
          </Btn>
        </div>
      </div>
    </div>
  );
}
