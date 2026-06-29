import { useEffect, useRef, useState } from "react";
import { NotoApp } from "../noto/NotoApp";

export function AppPreview() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    function update() {
      if (!hostRef.current) return;
      const w = hostRef.current.clientWidth;
      // Embedded Noto app has fixed sidebar (300) + context (340) + min workspace.
      // Scale the whole 1200x720 frame to fill the available width (slightly
      // larger than its base size on wide viewports), down to 50% on narrow ones.
      const s = Math.min(1.18, Math.max(0.5, w / 1200));
      setScale(s);
    }
    update();
    const ro = new ResizeObserver(update);
    if (hostRef.current) ro.observe(hostRef.current);
    window.addEventListener("resize", update);
    return () => { ro.disconnect(); window.removeEventListener("resize", update); };
  }, []);

  return (
    <section className="l-preview-wrap" id="preview">
      <div className="l-shell">
        <div className="l-window" data-screen-label="App Preview">
          <div className="l-app-host" ref={hostRef} style={{ height: 720 * scale }}>
            <div className="l-app-scaler" style={{ transform: `scale(${scale})` }}>
              <NotoApp />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
