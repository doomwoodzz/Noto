/** Tiny Noto-window illustration used inside the theme picker cards. */
export function MiniApp({ light }: { light: boolean }) {
  return (
    <div className={"mini" + (light ? " is-light" : "")}>
      <div className="mini-bar">
        <span className="mini-dot" style={{ background: "#FF5F57" }} />
        <span className="mini-dot" style={{ background: "#FEBC2E" }} />
        <span className="mini-dot" style={{ background: "#28C840" }} />
      </div>
      <div className="mini-body">
        <div className="mini-side">
          <div className="mini-logo" />
          <div className="mini-row w1 is-active" />
          <div className="mini-row w2" />
          <div className="mini-row w3" />
          <div className="mini-row w2" />
          <div className="mini-row w1" />
          <div className="mini-row w3" />
        </div>
        <div className="mini-main">
          <div className="mini-h" />
          <div className="mini-line l1" />
          <div className="mini-line l2" />
          <div className="mini-line l3" />
          <div className="mini-pill" />
          <div className="mini-line l4" />
          <div className="mini-line l1" />
        </div>
      </div>
    </div>
  );
}
