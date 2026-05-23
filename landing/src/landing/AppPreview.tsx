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
      // Scale the whole 1200x720 frame to fit narrower viewports.
      const s = Math.min(1, Math.max(0.5, w / 1200));
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
      <div className="l-preview-bg" />
      <div className="l-shell">
        <div className="l-window" data-screen-label="App Preview">
          <div className="l-window-chrome">
            <div className="l-window-tl">
              <span className="l-window-tl-close" />
              <span className="l-window-tl-min" />
              <span className="l-window-tl-max" />
            </div>
            <div className="l-window-title">Noto — School Vault</div>
            <div className="l-window-right">
              <span>Try: </span>
              <span className="l-window-kbd">⌘K</span>
              <span className="l-window-kbd">⌃⌘M</span>
            </div>
          </div>
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
