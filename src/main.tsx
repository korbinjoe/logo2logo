import "./data/exploration-messages";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StateProvider } from "./state";
import { CommerceProvider } from "./commerce";
import { App } from "./App";
import "./react.css";
import "./exploration.css";
import "./hero-atmosphere.css";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StateProvider>
      <CommerceProvider>
        <App />
      </CommerceProvider>
    </StateProvider>
  </StrictMode>,
);
