/* ── Step ⇄ URL ────────────────────────────────────────────────────────
 * The wizard used to keep the step in React state only: the address bar
 * never moved, so the browser Back button left the site entirely and a
 * refresh threw the visitor back to step one. Every step now has a URL.
 * ──────────────────────────────────────────────────────────────────── */
import { FormStep } from "../types";

export const STEP_SLUG: Record<FormStep, string> = {
  [FormStep.WELCOME]: "welcome",
  [FormStep.PURPOSE]: "purpose",
  [FormStep.STYLE]: "style",
  [FormStep.STORY]: "story",
  [FormStep.BODY_AREA]: "placement",
  [FormStep.SIZE]: "size",
  [FormStep.TIMING]: "when",
  [FormStep.CONTACT]: "contact",
  [FormStep.ADDRESS]: "pickup",
  [FormStep.SUCCESS]: "done",
};

const BY_SLUG = new Map<string, FormStep>(
  Object.entries(STEP_SLUG).map(([step, slug]) => [slug, Number(step) as FormStep]),
);

export function stepFromSlug(slug: string | undefined): FormStep | null {
  if (!slug) return null;
  return BY_SLUG.get(slug) ?? null;
}

export const bookingPath = (studioSlug: string, step: FormStep): string =>
  step === FormStep.WELCOME ? `/${studioSlug}/book` : `/${studioSlug}/book/${STEP_SLUG[step]}`;
