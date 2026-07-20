import React from "react";
import ReactDOM from "react-dom/client";
import { ToastViewport } from "@astryxdesign/core/Toast";
import App from "./App";
import { SharePage } from "./views/SharePage";
import "./index.css";
import { applyAppearance, loadAppearance } from "./lib/appearance";

// Apply saved appearance (theme / mode / accent) before first paint so there
// is no theme flash. Also runs on the public share page — viewer's own prefs.
applyAppearance(loadAppearance());

const root = document.getElementById("root");
if (root) {
  const isShare = Boolean(window.__OG_SHARE_SNAPSHOT__);
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ToastViewport position="bottomEnd" maxVisible={3}>
        {isShare ? <SharePage snapshot={window.__OG_SHARE_SNAPSHOT__!} /> : <App />}
      </ToastViewport>
    </React.StrictMode>
  );
}
