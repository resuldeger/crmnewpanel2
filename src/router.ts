/**
 * Path-based routing (History API) — clean URLs, no hash.
 * `/leads`, `/lead/LEAD-1042`, `/sms/7003`, `/studios/new`, `/studios/3` …
 * The console is served from the domain root (Vite `base: "/"`), so paths
 * are absolute — no base-path guessing. Deep links need the usual SPA
 * fallback (`try_files $uri /index.html`) on the production host.
 */
import type { Route } from "./store";

const LEAF_VIEWS = ["customers", "leads", "appointments", "sms", "campaigns", "calls", "tasks", "reports", "studios", "staff", "settings", "duplicates", "import"] as const;

export function routeToPath(r: Route): string {
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
  const parts = pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
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
