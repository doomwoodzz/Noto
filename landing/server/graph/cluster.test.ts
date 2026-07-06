// landing/server/graph/cluster.test.ts
import { describe, it, expect } from "vitest";
import { assignCommunities } from "./cluster.ts";
import type { PersistedEdge } from "../../src/noto-core/graphEdges.ts";

function edge(source: string, target: string): PersistedEdge {
  return { id: `${source}->${target}`, sourceId: source, targetId: target, relation: "links_to", confidence: "EXTRACTED", confidenceScore: 1 };
}

describe("assignCommunities", () => {
  it("groups two densely-linked clusters separately", () => {
    const nodeIds = ["a1", "a2", "a3", "b1", "b2", "b3"];
    const edges = [
      edge("a1", "a2"), edge("a2", "a3"), edge("a1", "a3"),
      edge("b1", "b2"), edge("b2", "b3"), edge("b1", "b3"),
    ];
    const communities = assignCommunities(nodeIds, edges);
    expect(communities.size).toBe(6);
    expect(communities.get("a1")).toBe(communities.get("a2"));
    expect(communities.get("a1")).toBe(communities.get("a3"));
    expect(communities.get("b1")).toBe(communities.get("b2"));
    expect(communities.get("a1")).not.toBe(communities.get("b1"));
  });

  it("assigns every isolated node its own bucket with no edges", () => {
    const communities = assignCommunities(["x", "y"], []);
    expect(communities.get("x")).not.toBe(communities.get("y"));
  });
});
