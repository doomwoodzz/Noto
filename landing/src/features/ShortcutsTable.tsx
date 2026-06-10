import { Download } from "lucide-react";

interface Shortcut {
  keys: string[];
  label: string;
}

const GROUPS: { title: string; items: Shortcut[] }[] = [
  {
    title: "Navigate",
    items: [
      { keys: ["⌘", "K"], label: "Open command palette" },
      { keys: ["⌘", "F"], label: "Search notes" },
      { keys: ["⌘", "G"], label: "Open Knowledge Web" },
      { keys: ["⌘", "N"], label: "New note" },
    ],
  },
  {
    title: "Write",
    items: [
      { keys: ["⌘", "B"], label: "Bold" },
      { keys: ["⌘", "I"], label: "Italic" },
      { keys: ["⌘", "U"], label: "Underline" },
      { keys: ["⌘", "L"], label: "Insert backlink" },
    ],
  },
  {
    title: "Listen",
    items: [
      { keys: ["⌃", "⌘", "M"], label: "Toggle Lecture AI recorder" },
      { keys: ["Tab"], label: "Indent list item" },
      { keys: ["↵"], label: "Continue list on new line" },
    ],
  },
];

export function ShortcutsTable() {
  return (
    <section className="f-shortcuts" id="shortcuts">
      <div className="l-shell">
        <div className="l-section-head">
          <div className="l-section-label f-shortcuts-label">
            <span className="l-section-label-bar" /> Keyboard-first
          </div>
          <h2 className="l-section-title f-shortcuts-title">Everything is a keystroke.</h2>
          <p className="l-section-sub f-shortcuts-sub">
            Noto is built to be driven from the keyboard. Here are the shortcuts that do
            the heavy lifting — the same ones bound in the app.
          </p>
        </div>

        <div className="f-sc-grid">
          {GROUPS.map((g) => (
            <div key={g.title} className="f-sc-col">
              <div className="f-sc-col-title">{g.title}</div>
              {g.items.map((s) => (
                <div key={s.label} className="f-sc-row">
                  <span className="f-sc-label">{s.label}</span>
                  <span className="f-sc-keys">
                    {s.keys.map((k, i) => (
                      <kbd key={i} className="f-sc-kbd">{k}</kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="f-sc-cta">
          <a href="#download" className="l-btn f-btn-light l-btn-lg">
            <Download size={15} strokeWidth={1.7} />
            Download Noto and try them
          </a>
        </div>
      </div>
    </section>
  );
}
