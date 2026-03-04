import React from "react";
import ReactDOM from "react-dom/client";
import { PrefillApp } from "@/prefill/PrefillApp";
import "@/index.css";
import "@/App.css";
import "@/prefill/prefill.css";

ReactDOM.createRoot(document.getElementById("prefill-root") as HTMLElement).render(
  <React.StrictMode>
    <PrefillApp />
  </React.StrictMode>,
);
