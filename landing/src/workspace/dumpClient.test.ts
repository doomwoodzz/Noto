import { describe, it, expect } from "vitest";
import { nextMockPhase } from "./dumpClient.ts";

describe("nextMockPhase (mock poll state machine)", () => {
  it("walks queued → fetching → shaping → awaiting_review and then holds", () => {
    expect(nextMockPhase("queued")).toBe("fetching");
    expect(nextMockPhase("fetching")).toBe("shaping");
    expect(nextMockPhase("shaping")).toBe("awaiting_review");
    // awaiting_review is a hold state — it only advances on commit, never on poll.
    expect(nextMockPhase("awaiting_review")).toBe("awaiting_review");
  });

  it("walks committing → done and then holds on the terminal state", () => {
    expect(nextMockPhase("committing")).toBe("done");
    expect(nextMockPhase("done")).toBe("done");
  });

  it("treats terminal/side states as fixpoints", () => {
    expect(nextMockPhase("failed")).toBe("failed");
    expect(nextMockPhase("cancelled")).toBe("cancelled");
  });
});
