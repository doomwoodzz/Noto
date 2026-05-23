const CONCEPTS = [
  "chlorophyll absorbs light",
  "glucose stores chemical energy",
  "Calvin cycle produces sugar",
];
const LINKED = ["[[Chloroplast]]", "[[Glucose]]", "[[Carbon Dioxide]]"];

export function VisMemory() {
  return (
    <div className="lr-memory">
      <div className="lr-mem-group">
        <div className="lr-mem-label">Concepts</div>
        {CONCEPTS.map((c, i) => <div key={i} className="lr-mem-card">{c}</div>)}
      </div>
      <div className="lr-mem-group">
        <div className="lr-mem-label">Linked Notes</div>
        {LINKED.map((c, i) => <div key={i} className="lr-mem-card">{c}</div>)}
      </div>
    </div>
  );
}
