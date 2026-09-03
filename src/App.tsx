import { StoreProvider, useStore } from "./store";
import Shell, { ToastHost } from "./components/shell";
import Dashboard from "./views/Dashboard";
import Leads from "./views/Leads";
import LeadDetail from "./views/LeadDetail";
import Appointments, { AppointmentDetail } from "./views/Appointments";
import Sms from "./views/Sms";
import Calls from "./views/Calls";
import Reports from "./views/Reports";
import Studios from "./views/Studios";
import StudioEdit from "./views/StudioEdit";
import Staff from "./views/Staff";
import Settings from "./views/Settings";

function Router() {
  const { route } = useStore();
  switch (route.view) {
    case "dashboard": return <Dashboard />;
    case "leads": return <Leads />;
    case "lead": return <LeadDetail id={route.id} />;
    case "appointments": return <Appointments />;
    case "appointment": return <AppointmentDetail id={route.id} />;
    case "sms": return <Sms convId={route.id} />;
    case "calls": return <Calls />;
    case "reports": return <Reports />;
    case "studios": return <Studios />;
    case "studio": return <StudioEdit id={route.id} />;
    case "staff": return <Staff />;
    case "settings": return <Settings />;
  }
}

export default function App() {
  return (
    <StoreProvider>
      <Shell>
        <Router />
      </Shell>
      <ToastHost />
    </StoreProvider>
  );
}
