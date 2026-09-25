# apps/booking — SUPERSEDED

This standalone Vite app has been folded into the Next application. The
booking engine now runs on the same port as everything else:

| Before | Now |
|---|---|
| `:5174/` | `:3000/` (public studio picker) |
| `:5174/{slug}/book` | `:3000/{slug}/book` |
| `:5174/b/{uuid}` | `:3000/b/{uuid}` |

The source lives in `src/booking/` (components, hooks, screens, shell) with
Next routes under `src/app/[slug]/book/` and `src/app/b/[uuid]/`.

Kept here only until the single-port version has been exercised in testing.
**Do not edit these files** — changes here go nowhere. Delete this directory
once you are satisfied.
