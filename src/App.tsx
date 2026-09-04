import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { StoreProvider, useStore } from "./store";
import { I18nProvider, initI18n, t } from "./i18n";
import Shell, { ToastHost } from "./shell";
import { Btn, I } from "./ui";
import Dashboard from "./views/Dashboard";
import Leads from "./views/Leads";
import LeadDetail from "./views/LeadDetail";
import Appointments, { AppointmentDetail } from "./views/Appointments";
import Sms from "./views/Sms";
import Campaigns from "./views/Campaigns";
import Calls from "./views/Calls";
import Tasks from "./views/Tasks";
import Duplicates from "./views/Duplicates";
import Reports from "./views/Reports";
import Studios from "./views/Studios";
import StudioEdit from "./views/StudioEdit";
import Staff from "./views/Staff";
import Settings from "./views/Settings";
import Import from "./views/Import";

/* ── error boundary: one broken screen must never blank the console ── */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Console crash:", error, info.componentStack); }
  render() {
    if (this.state.error) {
      return (
        <div className="grid min-h-[60vh] place-items-center p-8">
          <div className="max-w-md rounded-2xl border border-ember-500/40 bg-ink-875 p-8 text-center shadow-panel animate-pop">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-ember-500/40 bg-ember-500/10 text-ember-400">
              <I name="alert" size={20} />
            </span>
            <h2 className="font-display mt-4 text-[18px] font-bold tracking-wide text-ink-50">{t("Something went wrong on this screen")}</h2>
            <p className="num mt-2 break-all text-[11.5px] font-semibold text-ink-400">{this.state.error.message}</p>
            <div className="mt-5 flex justify-center gap-2">
              <Btn variant="outline" onClick={() => this.setState({ error: null })}>{t("Try again")}</Btn>
              <Btn variant="gold" onClick={() => { window.location.assign("/"); }}>{t("Dashboard")}</Btn>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function NotFound() {
  const { navigate, route } = useStore();
  return (
    <div className="grid min-h-[60vh] place-items-center p-8 animate-rise">
      <div className="text-center">
        <div className="num text-[64px] font-bold leading-none text-gold-500/80">404</div>
        <p className="mt-2 text-[14px] font-extrabold text-ink-200">{t("This route does not exist")}</p>
        <p className="num mt-1 text-[11.5px] font-semibold text-ink-500">{route.view === "notfound" ? window.location.pathname : ""}</p>
        <div className="mt-5 flex justify-center">
          <Btn variant="gold" onClick={() => navigate({ view: "dashboard" })}><I name="dashboard" size={14} /> {t("Dashboard")}</Btn>
        </div>
      </div>
    </div>
  );
}

function Screen() {
  const { route, navigate } = useStore();
  switch (route.view) {
    case "dashboard": return <Dashboard />;
    case "leads": return <Leads />;
    case "lead": return <LeadDetail id={route.id} />;
    case "appointments": return <Appointments />;
    case "appointment": return <AppointmentDetail id={route.id} onBack={() => navigate({ view: "appointments" })} />;
    case "sms": return <Sms convId={route.id} />;
    case "campaigns": return <Campaigns />;
    case "calls": return <Calls />;
    case "tasks": return <Tasks />;
    case "duplicates": return <Duplicates />;
    case "reports": return <Reports />;
    case "studios": return <Studios />;
    case "studio": return <StudioEdit id={route.id} />;
    case "staff": return <Staff />;
    case "settings": return <Settings />;
    case "import": return <Import />;
    case "notfound": return <NotFound />;
  }
}

export default function App() {
  useEffect(() => { initI18n(); }, []);
  return (
    <I18nProvider>
      <StoreProvider>
        <ErrorBoundary>
          <Shell><Screen /></Shell>
        </ErrorBoundary>
        <ToastHost />
      </StoreProvider>
    </I18nProvider>
  );
}
