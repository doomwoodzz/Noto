// Floating "Noto AI" window state.
//
// Backed by an injected AIClient (dependency injection, like VaultController):
// the authenticated app passes a real OpenAI-backed client; the marketing demo
// passes a scripted mock. Real mode captures the microphone via MediaRecorder
// and uploads the recording on Stop (batch transcription); simulated mode skips
// the mic entirely and plays a scripted transcript so the public demo stays
// free and offline.

import { useCallback, useEffect, useRef, useState } from "react";
import type { VaultFile } from "../noto-core";
import type { AIClient, Flashcard } from "./aiClient";

export type AIPhase = "idle" | "recording" | "processing";
export type RecordTarget = "current" | "new";

export interface AIMessage {
  role: "ai" | "user" | "voice" | "sys";
  text: string;
  concepts?: string[];
  cards?: Flashcard[];
}

/** Hard ceiling on a single recording — keeps the upload under OpenAI's 25 MB limit. */
const MAX_RECORD_MS = 20 * 60 * 1000;

// Scripted transcript lines shown live during a *simulated* (demo) recording.
const DEMO_VOICE = [
  "Okay everyone, today we're covering photosynthesis.",
  "Plants convert light energy into chemical energy, stored as glucose.",
  "There are two linked stages: the light-dependent reactions and the Calvin cycle.",
  "Chlorophyll inside the chloroplast absorbs light — mostly red and blue wavelengths.",
  "Carbon dioxide enters through the stomata and feeds the Calvin cycle.",
  "For the exam, make sure you can compare the two stages side by side.",
];

const GREETING: AIMessage = {
  role: "ai",
  text:
    "Hi — I can summarize notes, surface related concepts, make flashcards, or capture a lecture " +
    "live. Hit the mic and I'll keep the transcript right here.",
};

/** Context the workspace supplies for grounding (current note + vault outline). */
export interface AIContext {
  noteTitle?: string;
  noteContent?: string;
  outline?: string;
  /** Other note titles (current note excluded) — used for find-links + lecture links. */
  titles: string[];
}

interface Opts {
  ai: AIClient;
  getContext: () => AIContext;
  getCurrentNote: () => VaultFile | null;
  appendToNote: (noteId: string, content: string, immediate?: boolean) => void;
  createLecture: (title: string, content: string) => Promise<VaultFile | null> | VaultFile | null;
  openTitle: (title: string) => void;
  toast: (msg: string) => void;
  initialOpen?: boolean;
}

export interface NotoAI {
  open: boolean;
  phase: AIPhase;
  pending: boolean;
  messages: AIMessage[];
  input: string;
  elapsed: number;
  pos: { x: number; y: number };
  askTarget: boolean;
  status: string;
  toggle: () => void;
  setOpen: (v: boolean) => void;
  setInput: (v: string) => void;
  send: () => void;
  quick: (label: string) => void;
  requestRecord: () => void;
  cancelRecordPrompt: () => void;
  startRecord: (target: RecordTarget) => void;
  stopRecord: () => void;
  onDragStart: (e: React.PointerEvent) => void;
  onDragMove: (e: React.PointerEvent) => void;
  onDragEnd: () => void;
  openTitle: (title: string) => void;
}

/** Pull [[wiki-link]] titles out of generated markdown for concept chips. */
function conceptsFrom(markdown: string): string[] {
  const out = new Set<string>();
  for (const m of markdown.matchAll(/\[\[([^\]]+)\]\]/g)) out.add(m[1].trim());
  return [...out].slice(0, 8);
}

export function useNotoAI(opts: Opts): NotoAI {
  const { ai, getContext, getCurrentNote, appendToNote, createLecture, openTitle, toast } = opts;
  const [open, setOpen] = useState(opts.initialOpen ?? false);
  const [phase, setPhase] = useState<AIPhase>("idle");
  const [pending, setPending] = useState(false);
  const [messages, setMessages] = useState<AIMessage[]>([GREETING]);
  const [input, setInput] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [askTarget, setAskTarget] = useState(false);

  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const sec = useRef(0);
  const voiceIdx = useRef(0);
  const targetRef = useRef<RecordTarget>("current");
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  // Always points at the latest stopRecord so the auto-stop timer never calls a
  // stale closure (it's defined after beginTimer).
  const stopRef = useRef<() => void>(() => {});

  // MediaRecorder state (real mode only).
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);

  const push = useCallback((m: AIMessage) => setMessages((prev) => [...prev, m]), []);

  const clearTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  const teardownStream = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    recorder.current = null;
    chunks.current = [];
  };
  useEffect(() => () => {
    clearTimer();
    teardownStream();
  }, []);

  const toggle = useCallback(() => setOpen((o) => !o), []);

  /** Run an AI call with a shared typing indicator + uniform error handling. */
  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setPending(true);
      try {
        await fn();
      } catch (err) {
        const text =
          err instanceof Error && err.message ? err.message : "AI is unavailable right now.";
        push({ role: "sys", text });
      } finally {
        setPending(false);
      }
    },
    [push],
  );

  /* -------------------------------- chat -------------------------------- */

  const send = useCallback(() => {
    const t = input.trim();
    if (!t || pending) return;
    push({ role: "user", text: t });
    setInput("");
    const ctx = getContext();
    void run(async () => {
      const reply = await ai.chat({
        noteTitle: ctx.noteTitle,
        noteContent: ctx.noteContent,
        outline: ctx.outline,
        question: t,
      });
      push({ role: "ai", text: reply || "I'm not sure how to help with that." });
    });
  }, [input, pending, push, getContext, run, ai]);

  const quick = useCallback(
    (label: string) => {
      if (label === "Record lecture") {
        setAskTarget(true);
        return;
      }
      if (pending) return;
      const ctx = getContext();
      push({ role: "user", text: label });

      if (label === "Summarize note" || label === "Flashcards" || label === "Find links") {
        if (!ctx.noteContent || !ctx.noteContent.trim()) {
          push({ role: "sys", text: "Open a note first, then I can work on it." });
          return;
        }
      }
      const title = ctx.noteTitle ?? "Untitled";
      const content = ctx.noteContent ?? "";

      void run(async () => {
        if (label === "Summarize note") {
          const reply = await ai.summarize({ noteTitle: title, noteContent: content });
          push({ role: "ai", text: reply });
        } else if (label === "Find links") {
          const related = await ai.findLinks({ noteTitle: title, noteContent: content, titles: ctx.titles });
          push(
            related.length
              ? { role: "ai", text: "Related notes in your vault:", concepts: related }
              : { role: "ai", text: "I couldn't find clearly related notes yet." },
          );
        } else if (label === "Flashcards") {
          const cards = await ai.flashcards({ noteTitle: title, noteContent: content });
          push(
            cards.length
              ? { role: "ai", text: `Here are ${cards.length} flashcards from this note:`, cards }
              : { role: "ai", text: "I couldn't generate flashcards from this note." },
          );
        }
      });
    },
    [pending, getContext, push, run, ai],
  );

  /* ------------------------------ recording ----------------------------- */

  const requestRecord = useCallback(() => {
    if (phase === "recording") return;
    setOpen(true);
    setAskTarget(true);
  }, [phase]);

  const cancelRecordPrompt = useCallback(() => setAskTarget(false), []);

  const beginTimer = useCallback(
    (onTick?: () => void) => {
      sec.current = 0;
      setElapsed(0);
      clearTimer();
      timer.current = setInterval(() => {
        sec.current += 1;
        setElapsed(sec.current);
        onTick?.();
        if (sec.current * 1000 >= MAX_RECORD_MS) {
          // Auto-stop at the cap so the upload stays under OpenAI's size limit.
          stopRef.current();
        }
      }, 1000);
    },
    [],
  );

  const startRecord = useCallback(
    (target: RecordTarget) => {
      if (phase === "recording") return;
      setAskTarget(false);
      voiceIdx.current = 0;
      targetRef.current = target;

      if (ai.simulated) {
        // Demo: no microphone — play scripted transcript lines live.
        setPhase("recording");
        push({ role: "sys", text: "Recording started — listening to the lecture" });
        beginTimer(() => {
          if (sec.current % 2 === 1 && voiceIdx.current < DEMO_VOICE.length) {
            push({ role: "voice", text: DEMO_VOICE[voiceIdx.current] });
            voiceIdx.current += 1;
          }
        });
        return;
      }

      // Real: capture the microphone.
      void (async () => {
        let mediaStream: MediaStream;
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
          push({ role: "sys", text: "I couldn't access the microphone. Check your browser permissions." });
          return;
        }
        stream.current = mediaStream;
        chunks.current = [];
        const mr = new MediaRecorder(mediaStream);
        mr.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.current.push(e.data);
        };
        recorder.current = mr;
        mr.start();
        setPhase("recording");
        push({ role: "sys", text: "Recording started — listening to the lecture" });
        beginTimer();
      })();
    },
    [phase, ai, push, beginTimer],
  );

  /** Resolve the captured audio Blob once MediaRecorder has fully stopped. */
  const finalizeRecording = useCallback((): Promise<Blob | null> => {
    const mr = recorder.current;
    if (!mr) return Promise.resolve(null);
    return new Promise((resolve) => {
      mr.onstop = () => {
        const type = mr.mimeType || "audio/webm";
        resolve(chunks.current.length ? new Blob(chunks.current, { type }) : null);
      };
      if (mr.state !== "inactive") mr.stop();
      else resolve(null);
    });
  }, []);

  const writeLectureNotes = useCallback(
    async (markdown: string) => {
      const now = Date.now();
      const note = targetRef.current === "current" ? getCurrentNote() : null;
      if (note) {
        appendToNote(note.id, `${note.content.trim()}\n\n${markdown}`, true);
        return note.title;
      }
      const title = `Lecture ${new Date(now).toLocaleDateString()}`;
      await createLecture(title, `# ${title}\n\n${markdown}`);
      return title;
    },
    [getCurrentNote, appendToNote, createLecture],
  );

  const stopRecord = useCallback(() => {
    clearTimer();
    const wasSimulated = ai.simulated;
    setPhase("processing");

    void (async () => {
      try {
        let audio: Blob | null = null;
        if (!wasSimulated) {
          audio = await finalizeRecording();
          teardownStream();
          if (!audio) {
            push({ role: "sys", text: "No audio was captured. Try recording again." });
            setPhase("idle");
            return;
          }
        }
        // Simulated transcribe ignores its argument; real transcribe needs the Blob.
        const transcript = await ai.transcribe(audio ?? new Blob());
        if (!transcript.trim()) {
          push({ role: "sys", text: "I couldn't make out any speech in that recording." });
          setPhase("idle");
          return;
        }
        const titles = getContext().titles;
        const markdown = await ai.lectureNotes({ transcript, titles });
        const targetTitle = await writeLectureNotes(markdown);
        push({
          role: "ai",
          text: "Done — I transcribed the lecture and saved structured notes.",
          concepts: conceptsFrom(markdown),
        });
        toast(`Notes added to ${targetTitle}`);
      } catch (err) {
        teardownStream();
        const text =
          err instanceof Error && err.message ? err.message : "AI is unavailable right now.";
        push({ role: "sys", text });
      } finally {
        setPhase("idle");
      }
    })();
  }, [ai, finalizeRecording, getContext, writeLectureNotes, push, toast]);

  useEffect(() => {
    stopRef.current = stopRecord;
  }, [stopRecord]);

  /* ------------------------------ dragging ------------------------------ */

  const onDragStart = useCallback(
    (e: React.PointerEvent) => {
      drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [pos],
  );
  const onDragMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    setPos({ x: drag.current.px + (e.clientX - drag.current.x), y: drag.current.py + (e.clientY - drag.current.y) });
  }, []);
  const onDragEnd = useCallback(() => {
    drag.current = null;
  }, []);

  const status =
    phase === "recording"
      ? "Listening to your lecture…"
      : phase === "processing"
        ? "Organizing notes…"
        : pending
          ? "Thinking…"
          : "Ready when you are";

  return {
    open, phase, pending, messages, input, elapsed, pos, askTarget, status,
    toggle, setOpen, setInput, send, quick,
    requestRecord, cancelRecordPrompt, startRecord, stopRecord,
    onDragStart, onDragMove, onDragEnd, openTitle,
  };
}
