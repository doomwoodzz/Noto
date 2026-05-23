const STEPS = [
  { n: "01", t: "Open your vault.", d: "Noto reads Markdown directly. Your files stay yours, in a folder you own." },
  { n: "02", t: "Press Record.", d: "Lecture AI listens, transcribes, and quietly drafts structured notes in the background." },
  { n: "03", t: "Link as you write.", d: "Wiki links auto-resolve. Backlinks appear. Your knowledge web grows by itself." },
  { n: "04", t: "Find anything fast.", d: "⌘K opens a command palette to jump notes, toggle the recorder, or open the graph." },
];

export function HowStrip() {
  return (
    <section className="l-howstrip" id="how">
      <div className="l-shell">
        <div className="l-how-row">
          {STEPS.map((s) => (
            <div key={s.n}>
              <div className="l-how-num">{s.n}</div>
              <h3 className="l-how-title">{s.t}</h3>
              <p className="l-how-desc">{s.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
