/* ── Server-backed list state ──────────────────────────────────────────
 * Every console list asks the same question — which slice, in what order,
 * narrowed how — and every one of them used to answer it in the browser
 * over the hundred rows the store happened to hold. With 9,000 calls on
 * file the search box, the status tabs, the date filter and the CSV export
 * all described 1% of the table, and nothing on screen said so: an
 * operator searching for a customer who rang last month simply got "no
 * results" and believed it.
 *
 * So the question goes to the database. This holds the state of the
 * question and keeps one answer in flight at a time.
 * ────────────────────────────────────────────────────────────────── */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore, type DateRange } from "../store";
import type { ListQuery, Page } from "../services/crmApi";

/** The console's date filter, as the two instants the API takes.
 *
 *  "Today" means the operator's calendar day, which is why it is resolved
 *  here and not from a day count on the server: a desk in Istanbul asking
 *  at 09:00 is not asking for everything since 06:00 UTC yesterday. */
export function rangeToWindow(range: DateRange): { from?: string; to?: string } {
  if (range === "all") return {};
  if (range === "today") {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    return { from: midnight.toISOString() };
  }
  const days = range === "7" ? 7 : 30;
  return { from: new Date(Date.now() - days * 86_400_000).toISOString() };
}

export interface ServerTableOptions<T> {
  /** Usually a crmApi list method. */
  fetch: (query: ListQuery) => Promise<Page<T>>;
  pageSize?: number;
  defaultSort: string;
  defaultDir?: "asc" | "desc";
  /** Filters the view owns that are not part of the shared shape. */
  extra?: Omit<ListQuery, "page" | "pageSize" | "q" | "status" | "sort" | "dir" | "from" | "to" | "location">;
}

export interface ServerTable<T> {
  rows: T[];
  total: number;
  counts: Record<string, number>;
  loading: boolean;
  error: string | null;
  page: number;
  pageSize: number;
  setPage: (p: number) => void;
  q: string;
  setQ: (v: string) => void;
  status: string;
  setStatus: (v: string) => void;
  sort: string;
  dir: "asc" | "desc";
  toggleSort: (key: string) => void;
  /** The resolved question, for building an export URL from it. */
  query: ListQuery;
  reload: () => void;
}

/** Typing must not fire a request per keystroke. */
const SEARCH_DEBOUNCE_MS = 300;

export function useServerTable<T>({
  fetch,
  pageSize = 25,
  defaultSort,
  defaultDir = "desc",
  extra,
}: ServerTableOptions<T>): ServerTable<T> {
  const { globalLocation, dateRange } = useStore();

  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState(defaultSort);
  const [dir, setDir] = useState<"asc" | "desc">(defaultDir);

  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [q]);

  const window_ = useMemo(() => rangeToWindow(dateRange), [dateRange]);
  /* An object literal in the dependency list is a new object every render,
     so the query is compared by its content instead. */
  const extraKey = JSON.stringify(extra ?? {});

  /* Narrowing the question while looking at page 7 of the old answer would
     show an empty table — page 7 of the new one usually does not exist.
     So the page resets, and it resets DURING the render that saw the new
     filter rather than in an effect afterwards. An effect runs after the
     fetch has already been started for the stale page, which sent a
     request nobody would ever read and left the correct one racing it. */
  const filterKey = `${debouncedQ}|${status}|${sort}|${dir}|${globalLocation}|${dateRange}|${extraKey}`;
  const [seenFilters, setSeenFilters] = useState(filterKey);
  if (seenFilters !== filterKey) {
    setSeenFilters(filterKey);
    if (page !== 1) setPage(1);
  }
  const effectivePage = seenFilters === filterKey ? page : 1;

  const query = useMemo<ListQuery>(
    () => ({
      ...(JSON.parse(extraKey) as ListQuery),
      page: effectivePage,
      pageSize,
      q: debouncedQ,
      status,
      sort,
      dir,
      location: globalLocation,
      ...window_,
    }),
    [extraKey, effectivePage, pageSize, debouncedQ, status, sort, dir, globalLocation, window_],
  );

  /* Answers can come back out of order — a slow page 1 landing after a
     fast page 2 would put the wrong rows on screen. Only the newest
     request is allowed to write. */
  const latest = useRef(0);

  useEffect(() => {
    const ticket = ++latest.current;
    let cancelled = false;
    setLoading(true);

    fetch(query)
      .then((res) => {
        if (cancelled || ticket !== latest.current) return;
        setRows(res.rows);
        setTotal(res.total);
        setCounts(res.counts);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled || ticket !== latest.current) return;
        /* Keeping the previous rows under an error message would read as
           current data. An empty table with the reason is honest. */
        setRows([]);
        setTotal(0);
        setError(err instanceof Error ? err.message : "Could not load");
      })
      .finally(() => {
        if (!cancelled && ticket === latest.current) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `fetch` is a stable module method; re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, nonce]);

  const toggleSort = useCallback((key: string) => {
    setSort((current) => {
      if (current === key) {
        setDir((d) => (d === "asc" ? "desc" : "asc"));
        return current;
      }
      // A new column starts in the order that column is usually read in:
      // names from A, everything else newest or largest first.
      setDir(key === "name" ? "asc" : "desc");
      return key;
    });
  }, []);

  return {
    rows, total, counts, loading, error,
    page: effectivePage, pageSize, setPage,
    q, setQ,
    status, setStatus,
    sort, dir, toggleSort,
    query,
    reload: useCallback(() => setNonce((n) => n + 1), []),
  };
}
