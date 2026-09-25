import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AdminApp } from "./AdminApp";
import { OverlayApp } from "./OverlayApp";
import "./index.css";

const path = window.location.pathname;
const root = createRoot(document.getElementById("root")!);

if (path === "/admin") {
  root.render(
    <StrictMode>
      <AdminApp />
    </StrictMode>
  );
} else if (path === "/overlay") {
  root.render(
    <StrictMode>
      <OverlayApp />
    </StrictMode>
  );
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
