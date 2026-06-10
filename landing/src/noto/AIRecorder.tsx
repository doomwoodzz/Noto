import { useEffect, useState } from "react";
import { Mic, Square, Sparkles, ArrowRight } from "lucide-react";
import { useTypewriter } from "./useTypewriter";
import { AI_THINKING_LINES, answerFor } from "./aiDemo";
import type { RecorderPhase } from "./types";

interface AIRecorderProps {
  phase: RecorderPhase;
  elapsed: number;
  concepts: string[];
  targetNoteTitle: string;
  questions: string[];
  onStart: () => void;
  onStop: () => void;
  onOpenNote: () => void;
  onViewLinks: () => void;
  onRecordMore: () => void;
}

export function AIRecorder({
  phase, elapsed, concepts, targetNoteTitle, questions,
  onStart, onStop, onOpenNote, onViewLinks, onRecordMore,
}: AIRecorderProps) {
  const isRecording = phase === "recording";
  const isWorking = phase === "recording" || phase === "processing";
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  let status = "Ready to listen when you start.";
  if (phase === "recording") status = "Listening to lecture...";
  else if (phase === "processing") status = "Organizing notes...";
  else if (phase === "complete") status = `Notes added to ${targetNoteTitle}`;

  // Cycle the made-up "thinking" lines while the AI is working. The recorder
  // is remounted (via key) on each new recording, so the index starts fresh.
  const [thoughtIdx, setThoughtIdx] = useState(0);
  useEffect(() => {
    if (!isWorking) return;
    const id = setInterval(
      () => setThoughtIdx(i => (i + 1) % AI_THINKING_LINES.length),
      1700,
    );
    return () => clearInterval(id);
  }, [isWorking]);

  // Q&A: typed-out, slightly-varied answers to the three lecture questions.
  const { text: answerText, done: answerDone, run: runAnswer } = useTypewriter(60);
  const [askedQ, setAskedQ] = useState<string | null>(null);

  function ask(q: string) {
    setAskedQ(q);
    runAnswer(answerFor(q));
  }

  return (
    <div className="noto-recorder">
      <div className="noto-recorder-head">
        {isRecording && <span className="noto-rec-dot" />}
        <span className="noto-recorder-title">Lecture AI</span>
      </div>
      <div className="noto-recorder-status">{status}</div>

      <div className={"noto-wave" + (isRecording ? " is-on" : "")}>
        {[10, 22, 30, 18, 26, 14, 20, 16].map((h, i) => (
          <span key={i} style={{ height: h, animationDelay: `${i * 0.07}s` }} />
        ))}
      </div>

      {phase === "idle" && (
        <button className="noto-btn noto-btn-primary noto-recorder-btn" onClick={onStart}>
          <Mic size={12} strokeWidth={1.7} />
          <span>Record</span>
        </button>
      )}
      {phase === "recording" && (
        <>
          <div className="noto-recorder-timer">{mm}:{ss}</div>
          <button className="noto-btn noto-btn-bordered noto-recorder-btn" onClick={onStop}>
            <Square size={11} strokeWidth={1.7} />
            <span>Stop</span>
          </button>
        </>
      )}
      {phase === "processing" && (
        <div className="noto-spinner" aria-label="Processing" />
      )}

      {/* Made-up AI reasoning, shown only for visual flavor while working. */}
      {isWorking && (
        <div className="noto-think">
          <Sparkles size={11} strokeWidth={1.8} className="noto-think-icon" />
          <span key={thoughtIdx} className="noto-think-line">{AI_THINKING_LINES[thoughtIdx]}</span>
        </div>
      )}

      {phase === "complete" && (
        <>
          <div className="noto-recorder-actions">
            <button className="noto-btn noto-btn-bordered" onClick={onOpenNote}>Open note</button>
            <button className="noto-btn noto-btn-bordered" onClick={onViewLinks}>View links</button>
            <button className="noto-btn noto-btn-bordered" onClick={onRecordMore}>Record more</button>
          </div>

          <div className="noto-qa">
            <div className="noto-qa-label">Ask about this lecture</div>
            <div className="noto-qa-list">
              {questions.map(q => (
                <button
                  key={q}
                  className={"noto-qa-chip" + (askedQ === q ? " is-active" : "")}
                  onClick={() => ask(q)}
                >
                  <span>{q}</span>
                  <ArrowRight size={12} strokeWidth={2} />
                </button>
              ))}
            </div>
            {askedQ && (
              <div className={"noto-qa-answer" + (answerDone ? "" : " is-typing")}>
                <div className="noto-qa-answer-text">
                  <AnswerText text={answerText} />
                  {!answerDone && <span className="noto-ai-caret" aria-hidden="true" />}
                </div>
                {!answerDone && <span className="noto-ai-sheen" aria-hidden="true" />}
              </div>
            )}
          </div>
        </>
      )}

      {concepts && concepts.length > 0 && isWorking && (
        <div className="noto-concepts">
          {concepts.slice(-3).map((c, i) => (
            <div key={i} className="noto-concept">- {c}</div>
          ))}
        </div>
      )}

      <div className="noto-privacy">Recording only starts when you press Record.</div>
    </div>
  );
}

/** Renders [[wiki]] tokens in an answer as accent pills (display only). */
function AnswerText({ text }: { text: string }) {
  const parts: { kind: "text" | "wiki"; value: string }[] = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ kind: "text", value: text.slice(last, m.index) });
    parts.push({ kind: "wiki", value: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "wiki"
          ? <span key={i} className="noto-qa-link">{p.value}</span>
          : <span key={i}>{p.value}</span>
      )}
    </>
  );
}
