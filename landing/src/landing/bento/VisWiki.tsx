const BACKLINKS = ["Cell Structure", "Enzymes", "Biology Lecture — May 13", "Chloroplast"];
const OUTGOING = ["Chloroplast", "Glucose", "Carbon Dioxide", "Cell Structure"];

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--color-muted)",
  fontWeight: 600,
  marginBottom: 8,
};

export function VisWiki() {
  return (
    <div className="lr-wiki">
      <div style={{ width: "100%", marginBottom: 8 }}>
        <div style={LABEL_STYLE}>Backlinks · {BACKLINKS.length}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {BACKLINKS.map((b, i) => <span key={i} className="lr-wiki-pill">[[{b}]]</span>)}
        </div>
      </div>
      <div style={{ width: "100%" }}>
        <div style={LABEL_STYLE}>Outgoing · {OUTGOING.length}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {OUTGOING.map((b, i) => <span key={i} className="lr-wiki-pill is-out">[[{b}]]</span>)}
        </div>
      </div>
    </div>
  );
}
