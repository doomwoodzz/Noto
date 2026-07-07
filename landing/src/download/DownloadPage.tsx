import { useState } from "react";
import { Nav } from "../landing/Nav";
import { Footer } from "../landing/Footer";
import { useTheme } from "../landing/useTheme";
import { InstallInstructions } from "./InstallInstructions";
import { Roadmap } from "./Roadmap";
import { CardModal } from "./CardModal";
import type { RoadmapCard } from "./roadmapData";

export function DownloadPage() {
  const [theme, setTheme] = useTheme();
  const [active, setActive] = useState<RoadmapCard | null>(null);
  return (
    <div className="l-page">
      <Nav theme={theme} setTheme={setTheme} />
      <InstallInstructions />
      <Roadmap onOpen={setActive} />
      <Footer />
      {active && <CardModal card={active} onClose={() => setActive(null)} />}
    </div>
  );
}
