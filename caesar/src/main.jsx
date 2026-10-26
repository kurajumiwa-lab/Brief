import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
// Self-hosted, subset, variable — the brand's two typefaces should not cost a
// handshake to a third party on a 2G connection, and the app claims to work
// offline, which a Google Fonts <link> makes untrue.
import "@fontsource-variable/sora";
import "@fontsource-variable/inter";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </StrictMode>
);
