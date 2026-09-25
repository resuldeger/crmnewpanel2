/* ── CSV export ────────────────────────────────────────────────────────
 * Export used to run in the browser over whatever the console happened to
 * be holding — the first hundred rows — so a file named "all leads" was a
 * page of them, with no sign that the rest had been left out. It is the
 * one feature where quietly wrong data leaves the building.
 *
 * The export is therefore the SAME query as the list, minus the paging,
 * run here. It is streamed in chunks rather than assembled: a studio's
 * whole call history is tens of thousands of rows, and building that as
 * one string holds all of it in memory at once, per concurrent export.
 * ────────────────────────────────────────────────────────────────── */

/** Rows read per round trip while streaming. */
const CHUNK = 500;

/** A hard stop, so one request cannot walk an unbounded table. */
const MAX_ROWS = 50_000;

/**
 * Excel reads a bare quote-escaped field fine, but a leading =, +, - or @
 * is a formula to it. Prefixing a quote keeps the value visible and inert.
 */
function cell(value: unknown): string {
  const raw =
    value === null || value === undefined
      ? ""
      : value instanceof Date
        ? value.toISOString()
        : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

const line = (values: unknown[]): string => values.map(cell).join(",") + "\r\n";

export interface CsvExport<T> {
  filename: string;
  header: string[];
  /** One page of rows, in the list's own order. */
  fetchChunk: (limit: number, offset: number) => Promise<T[]>;
  row: (item: T) => unknown[];
}

export function csvResponse<T>({ filename, header, fetchChunk, row }: CsvExport<T>): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      // A BOM, or Excel opens UTF-8 names as mojibake.
      controller.enqueue(encoder.encode("﻿" + line(header)));

      let offset = 0;
      for (;;) {
        const rows = await fetchChunk(CHUNK, offset);
        if (rows.length === 0) break;

        let out = "";
        for (const item of rows) out += line(row(item));
        controller.enqueue(encoder.encode(out));

        offset += rows.length;
        if (rows.length < CHUNK || offset >= MAX_ROWS) break;
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** `YYYY-MM-DD` for the filename, so two exports never collide silently. */
export const stamp = (): string => new Date().toISOString().slice(0, 10);
