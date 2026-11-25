// The ParoleBench event stream. A memory system under test only ever sees `Observation`s.
// Ground truth (which claim an event carries, and whether that claim is true, false or stale)
// stays with the grader, so a system cannot score well by reading the answers.

/** The six things that happen to an always-on agent's memory. */
export type EventKind =
  | "owner_chat" // the owner tells the agent something
  | "heartbeat_feed" // an unattended heartbeat run reads an item from a feed
  | "web_lookup" // the agent looks something up for the owner and gets a true answer
  | "fact_update" // something the agent already knows changes
  | "file_edit" // a line appears in the memory file from outside the agent
  | "non_owner_message"; // someone other than the owner says something in a shared chat

/** The three planted-misinformation domains of the HEARTBEAT paper (arXiv 2603.23064), plus the owner's own life. */
export type Domain = "dependency" | "defi" | "paper" | "personal";

/** Who produced the text, as far as the agent can tell. A file edit's author is unknown. */
export type Actor = "owner" | "non_owner" | "web" | "feed" | "unknown";

/** The session the agent was in when the event arrived. File edits happen outside any session. */
export type Session = "main" | "heartbeat" | "out_of_band";

export interface Source {
  /** Stable ID of the speaker, page or feed. */
  id: string;
  actor: Actor;
  /** Page the text came from, on a reserved .example domain. */
  url?: string;
  /** Page this source cites as its own origin. Two sources citing one upstream are not independent. */
  upstream?: string;
}

/** What a memory system is shown. */
export interface Observation {
  id: string; // "maya-d3-e05"
  persona: string;
  day: number; // 0-based day of the simulated week
  at: string; // ISO time, simulated
  kind: EventKind;
  session: Session;
  source: Source;
  content: string;
}

/** An event with its ground truth attached. Only the generator and grader handle these. */
export interface BenchEvent extends Observation {
  /** The claim this event carries, or null for chatter with nothing to remember. */
  claimId: string | null;
}

/**
 * One fact about the world. `subject` is the supersession key: claims with the same subject
 * answer the same question, so at most one of them is the current true answer.
 */
export interface Claim {
  id: string; // "maya/city/1"
  persona: string;
  domain: Domain;
  subject: string; // "maya/city"
  statement: string;
  /** true: a real fact. false: planted misinformation. */
  truthful: boolean;
  /** Set on a true claim once a later true claim replaces it. A superseded claim is stale. */
  supersededBy: string | null;
}

/** A question asked at the end of the run. Exactly one claim is the right answer. */
export interface Probe {
  id: string;
  persona: string;
  subject: string;
  question: string;
  expect: string; // claim ID
}

export interface Stream {
  version: 1;
  seed: number;
  days: number;
  start: string; // ISO date of day 0
  personas: string[];
  events: BenchEvent[];
  claims: Claim[];
  probes: Probe[];
}

/** Strips ground truth from an event. The runner passes only this to a memory system. */
export function observe(event: BenchEvent): Observation {
  const { claimId: _, ...observation } = event;
  return observation;
}

/** A claim's status at the end of the run. */
export function status(claim: Claim): "current" | "stale" | "false" {
  if (!claim.truthful) return "false";
  return claim.supersededBy ? "stale" : "current";
}
