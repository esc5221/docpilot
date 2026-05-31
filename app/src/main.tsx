import React from "react";
import ReactDOM from "react-dom/client";
import "pretendard/dist/web/variable/pretendardvariable.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./design/tokens.css";
import "./styles.css";
import App from "./App";
import { installDiagnostics } from "./diagnostics";

installDiagnostics();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
