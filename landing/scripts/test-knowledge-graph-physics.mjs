import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const modulePath = new URL("../src/noto/KnowledgeGraphPhysics.ts", import.meta.url);

async function importTypescriptModule(url) {
  const source = await readFile(url, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2023,
      verbatimModuleSyntax: true,
    },
  });
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(compiled.outputText)}`);
}

const {
  createInitialGraphBodies,
  dragGraphCluster,
  stepGraphBodies,
} = await importTypescriptModule(modulePath);

const graph = {
  nodes: [
    { id: "active", title: "Active", degree: 2 },
    { id: "linked", title: "Linked", degree: 1 },
    { id: "other", title: "Other", degree: 0 },
  ],
  edges: [{ source: "active", target: "linked" }],
};

const bounds = { width: 300, height: 240, padding: 40 };
const bodies = createInitialGraphBodies(graph, "active", bounds);
const before = structuredClone(bodies);

const dragged = dragGraphCluster(bodies, graph.edges, "active", { x: 24, y: 12 }, bounds);

assert.equal(dragged.active.x, before.active.x + 24);
assert.equal(dragged.active.y, before.active.y + 12);
assert.equal(dragged.linked.x, before.linked.x + 24);
assert.equal(dragged.linked.y, before.linked.y + 12);
assert.equal(dragged.other.x, before.other.x);
assert.equal(dragged.other.y, before.other.y);

const released = stepGraphBodies(dragged, graph.edges, bounds, 0.16, null);
assert.notEqual(released.active.x, dragged.active.x);
assert.notEqual(released.linked.y, dragged.linked.y);

const url = pathToFileURL(modulePath.pathname).href;
console.log(`Knowledge graph physics tests passed for ${url}`);
