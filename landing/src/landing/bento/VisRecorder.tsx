import { useEffect, useState } from "react";

const BARS = [10, 22, 30, 18, 26, 14, 20, 16, 24, 12];

export function VisRecorder() {
  const [phase, setPhase] = useState<"recording" | "idle">("recording");
  const [elapsed, setElapsed] = useState(34);
  const isRecording = phase === "recording";

  useEffect(() => {
    if (!isRecording) return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [isRecording]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div
      className="lr-recorder"
      onClick={() => setPhase((p) => (p === "recording" ? "idle" : "recording"))}
    >
      <div className="lr-recorder-head">
        {isRecording && <span className="lr-rec-dot" />}
        <span className="lr-recorder-name">Lecture AI</span>
      </div>
      <div className="lr-recorder-status">
        {isRecording ? "Listening to lecture..." : "Ready to listen when you start."}
      </div>
      <div className="lr-wave" style={{ opacity: isRecording ? 1 : 0.4 }}>
        {BARS.map((h, i) => (
          <span
            key={i}
            style={{
              height: h,
              animationDelay: `${i * 0.07}s`,
              animationPlayState: isRecording ? "running" : "paused",
            }}
          />
        ))}
      </div>
      <div className="lr-timer">{mm}:{ss}</div>
    </div>
  );
}
