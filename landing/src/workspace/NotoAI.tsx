import { useEffect, useRef } from "react";
import { Icon } from "./icons";
import type { NotoAI as NotoAIState } from "./useNotoAI";

interface Props {
  ai: NotoAIState;
  currentNoteTitle: string | null;
}

const QUICK = [
  { label: "Summarize note", icon: "list" as const },
  { label: "Find links", icon: "link" as const },
  { label: "Flashcards", icon: "cards" as const },
  { label: "Record lecture", icon: "mic" as const },
];

const WAVE = [16, 28, 40, 22, 32, 18, 36, 24, 30, 16, 34, 20, 26, 38, 20];

function fmt(elapsed: number): string {
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function NotoAI({ ai, currentNoteTitle }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [ai.messages, ai.phase]);

  if (!ai.open) return null;
  const recording = ai.phase === "recording";
  const processing = ai.phase === "processing";
  const composer = !recording && !processing;

  return (
    <div className="nw-ai" style={{ transform: `translate(${ai.pos.x}px, ${ai.pos.y}px)` }}>
      <div
        className="nw-ai-head"
        onPointerDown={ai.onDragStart}
        onPointerMove={ai.onDragMove}
        onPointerUp={ai.onDragEnd}
      >
        <div className="nw-ai-badge"><Icon name="spark" size={15} stroke={1.6} /></div>
        <div className="nw-ai-head-text">
          <div className="nw-ai-name">Noto AI</div>
          <div className="nw-ai-status">{ai.status}</div>
        </div>
        <button className="nw-icon-btn" onClick={ai.toggle} aria-label="Close Noto AI">
          <Icon name="close" size={13} stroke={1.9} />
        </button>
      </div>

      <div className="nw-ai-messages" ref={scrollRef}>
        {ai.messages.map((m, i) => {
          if (m.role === "ai") {
            return (
              <div key={i} className="nw-ai-msg nw-ai-from">
                <div className="nw-ai-msg-badge"><Icon name="spark" size={15} stroke={1.6} /></div>
                <div className="nw-ai-msg-body">
                  <div className="nw-ai-msg-text">{m.text}</div>
                  {m.concepts && m.concepts.length > 0 && (
                    <div className="nw-ai-concepts">
                      {m.concepts.map((c) => (
                        <button key={c} className="nw-ai-concept" onClick={() => ai.openTitle(c)}>
                          {c}
                        </button>
                      ))}
                    </div>
                  )}
                  {m.cards && m.cards.length > 0 && (
                    <div className="nw-ai-cards">
                      {m.cards.map((card, ci) => (
                        <div key={ci} className="nw-ai-card">
                          <div className="nw-ai-card-q">{card.q}</div>
                          <div className="nw-ai-card-a">{card.a}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          }
          if (m.role === "user") {
            return <div key={i} className="nw-ai-user">{m.text}</div>;
          }
          if (m.role === "voice") {
            return (
              <div key={i} className="nw-ai-msg nw-ai-voice">
                <div className="nw-ai-msg-badge is-mic"><Icon name="mic" size={13} stroke={1.8} /></div>
                <div className="nw-ai-voice-body">
                  <div className="nw-ai-voice-label">Transcript</div>
                  <div className="nw-ai-voice-text">{m.text}</div>
                </div>
              </div>
            );
          }
          return <div key={i} className="nw-ai-sys">{m.text}</div>;
        })}
        {ai.pending && (
          <div className="nw-ai-msg nw-ai-from">
            <div className="nw-ai-msg-badge"><Icon name="spark" size={15} stroke={1.6} /></div>
            <div className="nw-ai-typing" aria-label="Noto AI is thinking">
              <span /><span /><span />
            </div>
          </div>
        )}
      </div>

      {recording && (
        <div className="nw-ai-recording">
          <span className="nw-ai-rec-dot" />
          <div className="nw-ai-wave">
            {WAVE.map((h, i) => (
              <span key={i} style={{ height: h, animationDelay: `${i * 65}ms` }} />
            ))}
          </div>
          <span className="nw-ai-time">{fmt(ai.elapsed)}</span>
          <button className="nw-ai-stop" onClick={ai.stopRecord}>
            <Icon name="stop" size={13} stroke={1.8} />
            <span>Stop</span>
          </button>
        </div>
      )}

      {processing && (
        <div className="nw-ai-processing">
          <span className="nw-ai-spinner" />
          <span>Organizing your notes…</span>
        </div>
      )}

      {composer && (
        <div className="nw-ai-composer">
          {ai.askTarget ? (
            <div className="nw-ai-target">
              <div className="nw-ai-target-label">Add lecture notes to…</div>
              <div className="nw-ai-target-opts">
                <button className="nw-ai-target-opt" onClick={() => ai.startRecord("current")} disabled={!currentNoteTitle}>
                  <Icon name="file" size={14} stroke={1.7} />
                  <span>{currentNoteTitle ? `Current note · ${currentNoteTitle}` : "No current note"}</span>
                </button>
                <button className="nw-ai-target-opt" onClick={() => ai.startRecord("new")}>
                  <Icon name="plus" size={14} stroke={1.8} />
                  <span>New lecture note</span>
                </button>
              </div>
              <button className="nw-ai-target-cancel" onClick={ai.cancelRecordPrompt}>Cancel</button>
            </div>
          ) : (
            <>
              <div className="nw-ai-quick">
                {QUICK.map((q) => (
                  <button
                    key={q.label}
                    className="nw-ai-quick-btn"
                    onClick={() => ai.quick(q.label)}
                    disabled={ai.pending && q.label !== "Record lecture"}
                  >
                    <Icon name={q.icon} size={14} stroke={1.7} />
                    <span>{q.label}</span>
                  </button>
                ))}
              </div>
              <div className="nw-ai-input">
                <input
                  value={ai.input}
                  onChange={(e) => ai.setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      ai.send();
                    }
                  }}
                  placeholder={ai.pending ? "Thinking…" : "Ask anything, or record a lecture…"}
                  disabled={ai.pending}
                />
                <button className="nw-ai-mic" onClick={ai.requestRecord} title="Record lecture" aria-label="Record lecture">
                  <Icon name="mic" size={17} stroke={1.7} />
                </button>
                <button className="nw-ai-send" onClick={ai.send} aria-label="Send">
                  <Icon name="send" size={16} stroke={1.9} />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
