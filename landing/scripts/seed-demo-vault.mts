// Seeds a demo "Introduction to Distributed Systems" vault against a running
// dev server, for README screenshot capture. Idempotent — re-running skips
// notes that already exist at their path.
//
// Prerequisite: `npm run dev` running in another terminal (Express API on
// :8787). Usage: `npm run seed:demo-vault`

const API_BASE = process.env.NOTO_API_BASE ?? "http://localhost:8787";
// The CSRF origin pin checks the request's Origin header against APP_ORIGIN
// (see landing/.env.example), not the host we're actually connecting to —
// so this must match APP_ORIGIN's default, not API_BASE.
const ORIGIN = process.env.NOTO_APP_ORIGIN ?? "http://localhost:5173";

const cookies = new Map<string, string>();

function cookieHeader(): string {
  return Array.from(cookies.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function absorbSetCookies(res: Response): void {
  const getSetCookie = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  const raw = getSetCookie ? getSetCookie.call(res.headers) : [];
  for (const line of raw) {
    const pair = line.split(";", 1)[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    cookie: cookieHeader(),
    ...(init.headers as Record<string, string> | undefined),
  };
  if (method !== "GET" && method !== "HEAD") {
    headers.origin = ORIGIN;
    const csrf = cookies.get("noto_csrf");
    if (csrf) headers["x-csrf-token"] = csrf;
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  absorbSetCookies(res);
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

interface SeedNote {
  path: string;
  title: string;
  content: string;
}

const NOTES: SeedNote[] = [
  {
    path: "Lectures/Course-Overview.md",
    title: "Distributed Systems — Course Overview",
    content: `# Distributed Systems — Course Overview

This course covers the core problems that show up whenever more than one machine has to agree on something. Five threads run through everything we'll cover: [[Consensus]], [[Replication]], [[The CAP Theorem]], [[Consistency Models]], and [[Fault Tolerance]].

We'll spend the first few weeks on consensus algorithms ([[Paxos]], [[Raft]]) because almost every other topic — [[Leader Election]], [[Two-Phase Commit]], even [[Sharding]] — leans on having a way for nodes to agree. Once that's solid, we move to replication strategies and the consistency/availability tradeoffs they force on you.

Reading is assigned per lecture; problem sets are due the following Monday.`,
  },
  {
    path: "Lectures/Consensus.md",
    title: "Consensus",
    content: `# Consensus

Consensus is the problem of getting a set of nodes to agree on a single value, even when some of them crash or messages get delayed or reordered. It sounds simple until you try to do it without a central coordinator that itself might fail.

Every practical consensus protocol we'll study — [[Paxos]], [[Raft]] — solves the same core problem with different tradeoffs in complexity and readability. Consensus underpins [[Leader Election]] (electing a leader is just agreeing on "who's in charge") and [[Two-Phase Commit]] (agreeing on whether a transaction committed).

FLP impossibility (Fischer, Lynch, Paterson, 1985) proves you can't guarantee consensus in a fully asynchronous system if even one node can fail — every real protocol works around this with timeouts and randomization, not by beating the theorem.`,
  },
  {
    path: "Lectures/Replication.md",
    title: "Replication",
    content: `# Replication

Replication means keeping copies of the same data on multiple nodes, for two reasons: durability (a copy survives even if one machine dies) and availability (reads can be served from whichever replica is closest or least loaded).

The hard part isn't copying data — it's deciding when a write is "done." Wait for every replica to ack, and you get strong consistency but terrible availability during a partition. Wait for just one, and replicas can disagree about the current value. This tradeoff is formalized by [[The CAP Theorem]] and shows up concretely in [[Quorum Systems]], [[Vector Clocks]], and [[Gossip Protocols]].

See also: [[Sharding]] for when one replica set isn't enough.`,
  },
  {
    path: "Lectures/CAP-Theorem.md",
    title: "The CAP Theorem",
    content: `# The CAP Theorem

CAP says a distributed system can only guarantee two of three properties during a network partition: Consistency (every read sees the latest write), Availability (every request gets a response), and Partition tolerance (the system keeps working despite dropped/delayed messages).

Since partitions are a fact of life on real networks, the honest framing is: when a partition happens, do you sacrifice consistency (stay available, maybe serve stale data) or availability (refuse requests until the partition heals)? Most systems we'll study pick a point on this spectrum rather than a hard C or A — see [[Consistency Models]] for the actual menu of options, and [[Replication]] for where the tradeoff gets implemented.

[[Sharding]] doesn't get you out of this — it just moves the boundary of what counts as "one system."`,
  },
  {
    path: "Lectures/Consistency-Models.md",
    title: "Consistency Models",
    content: `# Consistency Models

"Consistency" isn't one thing — it's a spectrum of guarantees about what a read is allowed to return relative to prior writes:

- **Strong/linearizable**: reads always see the most recent write, as if there were only one copy of the data.
- **Sequential**: all nodes see operations in the same order, just not necessarily real-time order.
- **Causal**: operations that are causally related are seen in order; unrelated ones can be seen in any order.
- **Eventual**: given no new writes, all replicas converge to the same value — eventually.

[[Vector Clocks]] are how you actually detect causal relationships in practice. [[Quorum Systems]] are a knob for trading off how strong a guarantee you get against how available you stay, and they connect straight back to [[The CAP Theorem]].`,
  },
  {
    path: "Lectures/Fault-Tolerance.md",
    title: "Fault Tolerance",
    content: `# Fault Tolerance

A fault-tolerant system keeps working correctly even when some of its components fail. "Correctly" is doing a lot of work in that sentence — it depends what kind of fault you're tolerant to.

**Crash faults**: a node just stops. This is the easy case — [[Consensus]] protocols like [[Paxos]] and [[Raft]] are built to tolerate a minority of crashed nodes.

**Byzantine faults**: a node keeps running but sends arbitrary, possibly malicious, messages. Much harder — see [[Byzantine Fault Tolerance]].

Coordination protocols like [[Two-Phase Commit]] are fault-*intolerant* by design in one specific way: if the coordinator crashes mid-protocol, participants can be left blocked indefinitely. That's the motivation for [[Leader Election]] — replace a crashed coordinator instead of waiting for it forever.`,
  },
  {
    path: "Lectures/Paxos.md",
    title: "Paxos",
    content: `# Paxos

Paxos (Lamport, 1998) was the first consensus protocol proven correct under asynchronous, crash-fault conditions. It works in two phases: a **prepare** phase where a proposer asks a majority of acceptors to promise not to accept anything older, and an **accept** phase where it proposes a value and a majority must accept it before it's considered chosen.

The majority requirement is what keeps two proposers from both succeeding with different values — any two majorities of the same node set must overlap by at least one node, and that overlapping node enforces ordering. This is the same idea behind [[Quorum Systems]].

Paxos is famously correct but notoriously hard to implement and explain, which is the entire reason [[Raft]] exists. It's also the theoretical basis for [[Leader Election]] in most production systems.`,
  },
  {
    path: "Lectures/Raft.md",
    title: "Raft",
    content: `# Raft

Raft (Ongaro & Ousterhout, 2014) solves the same problem as [[Paxos]] — crash-fault-tolerant [[Consensus]] — but was explicitly designed for understandability. It splits the problem into three mostly-independent subproblems: [[Leader Election]], log replication, and safety.

Raft always has at most one leader per term. Followers that don't hear from a leader within a randomized timeout start an election, request votes, and whichever candidate gets a majority becomes leader for that term. All writes flow through the leader, which replicates log entries to followers and commits once a majority have them — the same majority-overlap trick as Paxos, just packaged with an explicit leader instead of anonymous proposers.

Most systems built after ~2015 (etcd, Consul, CockroachDB) use Raft over Paxos specifically because it's easier to implement correctly.`,
  },
  {
    path: "Lectures/Two-Phase-Commit.md",
    title: "Two-Phase Commit",
    content: `# Two-Phase Commit

Two-Phase Commit (2PC) coordinates a transaction across multiple participants (e.g. different database shards) so it either commits everywhere or aborts everywhere.

**Phase 1 (prepare)**: the coordinator asks every participant "can you commit?" Each participant locks its resources and replies yes/no.

**Phase 2 (commit/abort)**: if everyone said yes, the coordinator tells everyone to commit; if anyone said no (or timed out), it tells everyone to abort.

The well-known flaw: if the coordinator crashes after phase 1 but before sending phase 2, participants are stuck holding locks, unable to unilaterally decide (a participant that said "yes" can't safely abort on its own — the coordinator might have already told someone else to commit). This is the classic motivation for combining 2PC with [[Consensus]]-based [[Leader Election]] so a new coordinator can take over rather than leaving participants blocked. See [[Fault Tolerance]] for the general framing of this failure mode.`,
  },
  {
    path: "Lectures/Leader-Election.md",
    title: "Leader Election",
    content: `# Leader Election

Many distributed protocols want exactly one node acting as coordinator at a time — [[Two-Phase Commit]]'s coordinator, [[Raft]]'s leader, a primary in a primary-backup replication scheme. Leader election is how you pick (and replace) that node.

The core difficulty is the same one [[Consensus]] solves: nodes need to agree on who the leader is, even though messages can be delayed and nodes can crash, and "the old leader is dead" is indistinguishable over an asynchronous network from "the old leader is just slow." Get this wrong and you get **split brain** — two nodes both believing they're the leader, both accepting writes.

Raft's randomized election timeout and term numbers, and Paxos-based systems using a distinguished proposer, are both ways of making split brain astronomically unlikely rather than provably impossible — a running theme in [[Fault Tolerance]].`,
  },
  {
    path: "Lectures/Vector-Clocks.md",
    title: "Vector Clocks",
    content: `# Vector Clocks

A vector clock is a mechanism for detecting whether one event *causally* happened before another, or whether two events are concurrent (neither caused the other), without relying on synchronized wall-clock time.

Each node keeps a vector of counters, one per node in the system. On every local event, a node increments its own counter; on every message send, it attaches its current vector; on every receive, it merges the incoming vector (taking the max of each position) and increments its own counter.

Two events are causally ordered if one vector is entrywise ≤ the other; otherwise they're concurrent, which is exactly the signal a system needs to detect *conflicting* concurrent writes to the same key — the situation [[Replication]] and [[Consistency Models]] both have to handle when they promise anything weaker than strong consistency.`,
  },
  {
    path: "Lectures/Gossip-Protocols.md",
    title: "Gossip Protocols",
    content: `# Gossip Protocols

Gossip (epidemic) protocols spread information through a cluster the way rumors spread through a social network: each node periodically picks a few random peers and shares what it knows. No central coordinator, no fixed topology to maintain.

This makes gossip extremely robust to node churn and partial failures — there's no single point that, if it goes down, stops the spread — at the cost of only *eventual* consistency (see [[Consistency Models]]): a piece of information takes O(log N) rounds to reach all N nodes with high probability, not immediately.

Used for cluster membership (which nodes are alive), failure detection, and metadata propagation in systems like Cassandra and Consul. It's the least coordinated tool in the [[Replication]] toolbox — the opposite end of the spectrum from [[Consensus]]-backed replication.`,
  },
  {
    path: "Lectures/Sharding.md",
    title: "Sharding",
    content: `# Sharding

Sharding (horizontal partitioning) splits a dataset across multiple nodes by key, so each shard holds a disjoint subset of the data instead of every node holding everything.

Where [[Replication]] is about *availability and durability* (many copies of the same data), sharding is about *scale* (spreading a dataset too big for one node). Most production systems do both: shard for scale, then replicate each shard for durability.

The hard problems are choosing a partitioning scheme that doesn't create hot shards (consistent hashing is the standard answer), and handling operations that span multiple shards — those need [[Two-Phase Commit]] or an equivalent, and reintroduce all the tradeoffs from [[The CAP Theorem]] at the cross-shard boundary.`,
  },
  {
    path: "Lectures/Byzantine-Fault-Tolerance.md",
    title: "Byzantine Fault Tolerance",
    content: `# Byzantine Fault Tolerance

A Byzantine fault is one where a node doesn't just crash — it keeps participating but sends incorrect, inconsistent, or malicious messages, possibly telling different nodes different things. The name comes from the "Byzantine Generals Problem" (Lamport, Shostak, Pease, 1982).

Tolerating Byzantine faults is strictly harder than the crash-fault [[Consensus]] we cover elsewhere: classic results show you need at least 3f+1 nodes to tolerate f Byzantine nodes (versus 2f+1 for crash faults), because you can no longer trust a single node's report of what another node said.

Relevant mainly outside a single trusted organization's datacenter — blockchain consensus (PBFT, and its descendants) is the main place you'll encounter this in practice, precisely because no participant is assumed trustworthy. See [[Fault Tolerance]] for how this fits alongside simpler crash-fault models.`,
  },
  {
    path: "Lectures/Quorum-Systems.md",
    title: "Quorum Systems",
    content: `# Quorum Systems

A quorum system defines, for reads and writes, how many replicas must participate before an operation counts as complete. The classic formulation: with N replicas, require W replicas to acknowledge a write and R replicas to agree on a read, such that **R + W > N**.

That overlap condition guarantees every read quorum intersects every write quorum in at least one replica — so any read is guaranteed to see the most recent write, *if* that replica's value is correctly identified as the newest (which is where [[Vector Clocks]] or timestamps come in).

Tuning R and W is a direct, practical knob on [[The CAP Theorem]] tradeoff: W=N (wait for everyone) maximizes consistency but tanks availability during a partition; W=1 maximizes availability but weakens consistency to whatever [[Consistency Models]] tier you're willing to accept. This is the same majority-overlap idea [[Paxos]] uses, generalized to configurable thresholds.`,
  },
];

async function main(): Promise<void> {
  // Warm-up call: on a cookie-less request, ensureLocalSession() mints a new
  // session and Set-Cookies it, but (see auth/localSession.ts +
  // auth/session.ts) that cookie only takes effect on the *next* request —
  // the current request's req.cookies was already parsed before the session
  // existed. Every other route (e.g. GET /api/vaults) hard-401s via
  // requireUserId() on that first touch. /api/auth/me is the one route that
  // falls back to ensureLocalOwner() directly (see auth/routes.ts) instead of
  // 401ing, which is exactly why the test suite's `signup()` helper
  // (server/test-helpers.ts) also probes it first "to establish the
  // session." Mirror that here rather than eating a spurious failure on
  // GET /api/vaults.
  await api("/api/auth/me");

  // Now the session + CSRF cookies are established; this also bootstraps
  // (per notes/routes.ts's ensureDefaultVault) a default vault.
  const { vaults } = await api<{ vaults: Array<{ id: string; name: string }> }>("/api/vaults");
  const vaultId = vaults[0]?.id;
  if (!vaultId) throw new Error("No vault returned by GET /api/vaults");

  const { files } = await api<{ files: Array<{ path: string }> }>(`/api/vaults/${vaultId}/files`);
  const existing = new Set(files.map((f) => f.path));

  let created = 0;
  for (const note of NOTES) {
    if (existing.has(note.path)) {
      console.log(`skip (exists): ${note.path}`);
      continue;
    }
    await api(`/api/vaults/${vaultId}/files`, {
      method: "POST",
      body: JSON.stringify({ path: note.path, title: note.title, content: note.content }),
    });
    created += 1;
    console.log(`created: ${note.path}`);
  }

  console.log(`\nDone. vaultId=${vaultId}, created=${created}/${NOTES.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
