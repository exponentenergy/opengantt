import React from "react";
import ReactDOM from "react-dom/client";
import { ToastViewport } from "@astryxdesign/core/Toast";
import App from "./App";
import { SharePage } from "./views/SharePage";
import "./index.css";

// Astryx theme scoping — the theme CSS is scoped to [data-astryx-theme].
document.documentElement.setAttribute("data-astryx-theme", "stone");

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
