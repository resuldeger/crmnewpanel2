/* dateWindows: the seams are where a day goes missing. */
import { dateWindows } from "../../src/server/timely/dateWindows";

let failed = 0;
const check = (what: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};

check("one day", dateWindows("2026-01-01", "2026-01-01", 7),
  [{ start: "2026-01-01", end: "2026-01-01" }]);

check("exactly one window", dateWindows("2026-01-01", "2026-01-07", 7),
  [{ start: "2026-01-01", end: "2026-01-07" }]);

check("one day past a window", dateWindows("2026-01-01", "2026-01-08", 7),
  [{ start: "2026-01-01", end: "2026-01-07" }, { start: "2026-01-08", end: "2026-01-08" }]);

check("backwards range is empty", dateWindows("2026-01-08", "2026-01-01", 7), []);

/* The seams: every day between the ends must appear exactly once. */
const windows = dateWindows("2025-01-01", "2026-12-31", 7);
const seen = new Set<string>();
let duplicates = 0;
for (const w of windows) {
  for (let d = new Date(`${w.start}T00:00:00Z`); d <= new Date(`${w.end}T00:00:00Z`); d = new Date(d.getTime() + 86400000)) {
    const key = d.toISOString().slice(0, 10);
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
  }
}
const expectedDays = Math.round((Date.UTC(2026, 11, 31) - Date.UTC(2025, 0, 1)) / 86400000) + 1;
check(`two years: ${windows.length} windows cover every day once`,
  { days: seen.size, duplicates }, { days: expectedDays, duplicates: 0 });

/* A leap day is a day like any other and must not be skipped. */
check("leap day is covered", dateWindows("2028-02-27", "2028-03-01", 2),
  [{ start: "2028-02-27", end: "2028-02-28" }, { start: "2028-02-29", end: "2028-03-01" }]);

console.log(failed === 0 ? "\nall passed" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
