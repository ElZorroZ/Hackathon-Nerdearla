import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AdminApp } from "./AdminApp";
import { OverlayApp } from "./OverlayApp";
import { StageApp } from "./StageApp";
import { MobileApp } from "./MobileApp";
import "./index.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

const path = window.location.pathname;
const root = createRoot(document.getElementById("root")!);

// Strip body background for overlay/stage (transparent/black for OBS)
if (path === "/overlay") {
  document.body.className = "";
  document.documentElement.className = "";
} else if (path === "/stage") {
  document.body.className = "";
  document.documentElement.className = "";
}

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
} else if (path === "/stage") {
  root.render(
    <StrictMode>
      <StageApp />
    </StrictMode>
  );
} else if (path === "/mobile") {
  root.render(
    <StrictMode>
      <MobileApp />
    </StrictMode>
  );
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
