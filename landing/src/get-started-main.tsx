import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/onboarding.css";
import { Onboarding } from "./onboarding/Onboarding";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Onboarding />
  </StrictMode>,
);
