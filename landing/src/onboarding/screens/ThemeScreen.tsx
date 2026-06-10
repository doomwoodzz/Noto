import { useReveal } from "../useReveal";
import { ArrowRight, Sun, Moon } from "../icons";
import { MiniApp } from "../MiniApp";

type Theme = "light" | "dark";

const OPTIONS: { id: Theme; label: string; Icon: typeof Sun }[] = [
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
];

export function ThemeScreen({
  theme,
  setTheme,
  onNext,
  onBack,
}: {
  theme: Theme;
  setTheme: (t: Theme) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const reveal = useReveal();
  return (
    <div className={"ob-screen" + reveal}>
      <h1 className="ob-title">Choose your style</h1>
      <p className="ob-sub">Change your theme any time from the command menu or settings.</p>

      <div className="ob-themes">
        {OPTIONS.map((t) => (
          <button
            key={t.id}
            className={"ob-theme" + (theme === t.id ? " is-selected" : "")}
            onClick={() => setTheme(t.id)}
            aria-pressed={theme === t.id}
          >
            <div className="ob-theme-frame"><MiniApp light={t.id === "light"} /></div>
            <div className="ob-theme-foot">
              <span className="ob-theme-radio"><span /></span>
              <span className="ob-theme-name">{t.label}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="ob-panel" style={{ marginTop: 32 }}>
        <button className="ob-btn ob-btn-blue" onClick={onNext}>
          Continue
          <ArrowRight size={17} />
        </button>
        <button className="ob-btn ob-btn-quiet" onClick={onBack}>Back</button>
      </div>
    </div>
  );
}
