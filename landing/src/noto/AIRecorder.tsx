import { Mic, Square } from "lucide-react";
import type { RecorderPhase } from "./types";

interface AIRecorderProps {
  phase: RecorderPhase;
  elapsed: number;
  concepts: string[];
  targetNoteTitle: string;
  onStart: () => void;
  onStop: () => void;
  onOpenNote: () => void;
  onRecordMore: () => void;
}

export function AIRecorder({
  phase, elapsed, concepts, targetNoteTitle,
  onStart, onStop, onOpenNote, onRecordMore,
}: AIRecorderProps) {
  const isRecording = phase === "recording";
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  let status = "Ready to listen when you start.";
  if (phase === "recording") status = "Listening to lecture...";
  else if (phase === "processing") status = "Organizing notes...";
  else if (phase === "complete") status = `Notes added to ${targetNoteTitle}`;

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
      {phase === "complete" && (
        <div className="noto-recorder-actions">
          <button className="noto-btn noto-btn-bordered" onClick={onOpenNote}>Open note</button>
          <button className="noto-btn noto-btn-bordered" onClick={onRecordMore}>Record more</button>
        </div>
      )}

      {concepts && concepts.length > 0 && (
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
