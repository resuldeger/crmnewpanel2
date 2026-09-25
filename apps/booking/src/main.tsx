import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import "./styles/theme.css";
import "./components/PhoneInput.css";
import { router } from "./router";
import ErrorBoundary from "./components/ErrorBoundary";
import { LocaleProvider } from "./lib/locale";
import { loadGtm, loadLiveChat } from "./lib/analytics";

loadGtm();
loadLiveChat();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("#root is missing from index.html");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <LocaleProvider>
        <RouterProvider router={router} />
      </LocaleProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
