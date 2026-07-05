import { useCallback, useEffect, useRef, useState } from "react";
import { useReveal } from "../useReveal";
import {
  ArrowRight,
  ArrowDown,
  CornerDownLeft,
  Command,
  SquarePen,
  Waypoints,
  Mic,
  Search,
  LinkIcon,
} from "../icons";

type Phase = "idle" | "press" | "open" | "nav" | "fire";
type PressedKey = "cmdk" | "down" | "enter" | null;

const COMMANDS = [
  { title: "New Note", Icon: SquarePen },
  { title: "Open Knowledge Web", Icon: Waypoints },
  { title: "Toggle AI Recorder", Icon: Mic },
  { title: "Search Notes", Icon: Search },
  { title: "Insert Backlink", Icon: LinkIcon },
];

export function CommandTutorial({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const reveal = useReveal();
  const [phase, setPhase] = useState<Phase>("idle");
  const [active, setActive] = useState(0);
  const [pressedKey, setPressedKey] = useState<PressedKey>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const runRef = useRef<() => void>(() => {});

  const run = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const add = (fn: () => void, t: number) => timers.current.push(setTimeout(fn, t));

    setPhase("idle"); setActive(0); setPressedKey(null);

    add(() => { setPhase("press"); setPressedKey("cmdk"); }, 700);
    add(() => { setPhase("open"); setPressedKey(null); setActive(0); }, 1250);
    add(() => { setPhase("nav"); setPressedKey("down"); setActive(1); }, 2150);
    add(() => setPressedKey(null), 2400);
    add(() => { setPressedKey("down"); setActive(2); }, 3050);
    add(() => setPressedKey(null), 3300);
    add(() => { setPressedKey("down"); setActive(3); }, 3950);
    add(() => setPressedKey(null), 4200);
    add(() => setPressedKey("enter"), 5050);
    add(() => setPhase("fire"), 5250);
    add(() => setPressedKey(null), 5550);
    add(() => { setPhase("idle"); setActive(0); }, 6300);
    add(() => runRef.current(), 7100);
  }, []);

  useEffect(() => {
    // Kick off the looping animation on mount. The recursive restart at 7100ms
    // goes through runRef so `run` itself needn't depend on `run` (stable []).
    runRef.current = run;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    run();
    return () => timers.current.forEach(clearTimeout);
  }, [run]);

  const open = phase === "open" || phase === "nav" || phase === "fire";

  let hintText = "Press to open the command menu";
  let hintKeys = (
    <>
      <span className={"kbd-mini" + (pressedKey === "cmdk" ? " is-pressed" : "")}><Command size={12} /></span>
      <span className={"kbd-mini" + (pressedKey === "cmdk" ? " is-pressed" : "")}>K</span>
    </>
  );
  if (phase === "nav" || (open && phase !== "fire")) {
    hintText = "Navigate";
    hintKeys = (
      <>
        <span className={"kbd-mini" + (pressedKey === "down" ? " is-pressed" : "")}><ArrowDown size={12} /></span>
        <span className="ct-keyhint-text" style={{ margin: "0 2px" }}>then</span>
        <span className={"kbd-mini" + (pressedKey === "enter" ? " is-pressed" : "")}><CornerDownLeft size={12} /></span>
      </>
    );
  }
  if (phase === "fire") {
    hintText = "Run it";
    hintKeys = <span className="kbd-mini is-pressed"><CornerDownLeft size={12} /></span>;
  }

  return (
    <div className={"ob-screen" + reveal}>
      <h1 className="ob-title">Meet the command menu</h1>
      <p className="ob-sub">Every action in Noto is a keystroke away. Open the menu, type, and run any command in seconds.</p>

      <div className="ob-keys">
        <span className="ob-keys-label">Open it with</span>
        <span className={"keycap" + (pressedKey === "cmdk" ? " is-down is-accent" : "")}><Command size={20} /></span>
        <span className="keycap-plus">+</span>
        <span className={"keycap" + (pressedKey === "cmdk" ? " is-down is-accent" : "")}>K</span>
      </div>

      <div className="ct-stage">
        <div className="ct-win">
          <div className="ct-chrome">
            <span className="ct-tl" style={{ background: "#FF5F57" }} />
            <span className="ct-tl" style={{ background: "#FEBC2E" }} />
            <span className="ct-tl" style={{ background: "#28C840" }} />
            <span className="ct-chrome-title">School Vault — Photosynthesis.md</span>
          </div>
          <div className="ct-body">
            <div className="ct-side">
              <div className="ct-slogo" />
              <div className="ct-srow b" />
              <div className="ct-srow a" />
              <div className="ct-srow c" />
              <div className="ct-srow b" />
              <div className="ct-srow a" />
              <div className="ct-srow c" />
            </div>
            <div className="ct-main">
              <div className="ct-mtitle" />
              <div className="ct-mline a" />
              <div className="ct-mline b" />
              <div className="ct-mline c" />
              <div className="ct-mline d" />
              <div className="ct-mline a" />
              <div className="ct-mline c" />
            </div>
          </div>
        </div>

        <div className={"ct-dim" + (open ? " is-on" : "")} />

        <div className={"ct-palette" + (open ? " is-open" : "")}>
          <div className="ct-psearch">
            <Command size={15} />
            <span className="ct-ptext is-placeholder">Search commands</span>
            <span className="ct-pcursor" />
          </div>
          <div className="ct-plist">
            {COMMANDS.map((cmd, i) => {
              const isActive = open && i === active;
              const isFired = phase === "fire" && i === active;
              return (
                <div
                  key={cmd.title}
                  className={"ct-pitem" + (isFired ? " is-fired" : isActive ? " is-active" : "")}
                >
                  <cmd.Icon size={15} />
                  <span>{cmd.title}</span>
                  {isActive && !isFired && <span className="ct-pkbd">↵</span>}
                  {isFired && <span className="ct-pkbd">running…</span>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="ct-keyhint">
          <span className="ct-keyhint-text">{hintText}</span>
          {hintKeys}
        </div>
      </div>

      <div className="ob-panel" style={{ marginTop: 30 }}>
        <button className="ob-btn ob-btn-blue" onClick={onNext}>
          Continue
          <ArrowRight size={17} />
        </button>
        <button className="ob-btn ob-btn-quiet" onClick={onBack}>Back</button>
      </div>
    </div>
  );
}
