/**
 * Path-based routing (History API) — clean URLs, no hash.
 * `/admin/leads`, `/admin/lead/LEAD-1042`, `/admin/sms/7003` …
 *
 * The console lives under /admin, never at the domain root: the root is
 * the public booking experience, and an admin surface should not be the
 * first thing an ordinary visitor lands on.
 */
import type { Route } from "./store";

export const ADMIN_BASE = "/admin";

/** Strips the admin prefix so the matcher below stays prefix-agnostic. */
export function stripBase(pathname: string): string {
  if (pathname === ADMIN_BASE) return "/";
  return pathname.startsWith(`${ADMIN_BASE}/`) ? pathname.slice(ADMIN_BASE.length) : pathname;
}

const LEAF_VIEWS = ["live", "customers", "leads", "appointments", "sms", "campaigns", "calls", "tasks", "reports", "studios", "staff", "settings", "duplicates", "import"] as const;

export function routeToPath(r: Route): string {
  const sub = routeToSubPath(r);
  // "/admin" + "/" would produce a trailing slash the server redirects away.
  return sub === "/" ? ADMIN_BASE : ADMIN_BASE + sub;
}

function routeToSubPath(r: Route): string {
  switch (r.view) {
    case "dashboard": return "/";
    case "customer": return `/customers/${encodeURIComponent(r.id)}`;
    case "customer_subview": return `/customers/${encodeURIComponent(r.id)}/${r.sub}`;
    case "lead": return `/lead/${encodeURIComponent(r.id)}`;
    case "lead_subview": return `/lead/${encodeURIComponent(r.id)}/${r.sub}`;
    case "appointment": return `/appointment/${r.id}`;
    case "appointment_subview": return `/appointment/${r.id}/${r.sub}`;
    case "sms": return r.id !== undefined ? `/sms/${r.id}` : "/sms";
    case "studio": return r.id !== undefined ? `/studios/${r.id}` : "/studios/new";
    case "notfound": return "/404";
    default: return `/${r.view}`;
  }
}

export function pathToRoute(pathname: string): Route {
  const parts = stripBase(pathname).replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  const head = parts[0] ?? "";
  if (head === "") return { view: "dashboard" };
  if (head === "customers" && parts[1]) {
    const sub = parts[2];
    if (sub === "calls" || sub === "audit" || sub === "notes" || sub === "briefs") {
      return { view: "customer_subview", id: decodeURIComponent(parts[1]), sub };
    }
    return { view: "customer", id: decodeURIComponent(parts[1]) };
  }
  if (head === "lead" && parts[1]) {
    const sub = parts[2];
    if (sub === "calls" || sub === "audit" || sub === "notes") {
      return { view: "lead_subview", id: decodeURIComponent(parts[1]), sub };
    }
    return { view: "lead", id: decodeURIComponent(parts[1]) };
  }
  if (head === "appointment" && parts[1] && Number.isFinite(Number(parts[1]))) {
    const sub = parts[2];
    if (sub === "calls" || sub === "notes") {
      return { view: "appointment_subview", id: Number(parts[1]), sub };
    }
    return { view: "appointment", id: Number(parts[1]) };
  }
  if (head === "sms") return { view: "sms", id: parts[1] ? Number(parts[1]) : undefined };
  if (head === "studios") {
    if (!parts[1]) return { view: "studios" };
    if (parts[1] === "new") return { view: "studio" };
    if (Number.isFinite(Number(parts[1]))) return { view: "studio", id: Number(parts[1]) };
  }
  if ((LEAF_VIEWS as readonly string[]).includes(head)) return { view: head } as Route;
  return { view: "notfound" };
}
