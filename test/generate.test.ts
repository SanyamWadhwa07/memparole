import assert from "node:assert/strict";
import { test } from "node:test";
import { DAYS, generate } from "../src/bench/generate.ts";
import { observe, status } from "../src/bench/types.ts";

const stream = generate(1);

test("the same seed gives the same stream, byte for byte; another seed does not", () => {
  assert.equal(JSON.stringify(generate(1)), JSON.stringify(stream));
  assert.notEqual(JSON.stringify(generate(2)), JSON.stringify(stream));
});

test("every persona sees all six event kinds and all four domains", () => {
  for (const persona of stream.personas) {
    const events = stream.events.filter((e) => e.persona === persona);
    assert.deepEqual(new Set(events.map((e) => e.kind)), new Set(["owner_chat", "heartbeat_feed", "web_lookup", "fact_update", "file_edit", "non_owner_message"]));
    const claims = stream.claims.filter((c) => c.persona === persona);
    assert.deepEqual(new Set(claims.map((c) => c.domain)), new Set(["dependency", "defi", "paper", "personal"]));
  }
});

test("ground truth is consistent: every claim is delivered, every probe expects a current true claim", () => {
  const ids = new Set(stream.claims.map((c) => c.id));
  const delivered = new Set(stream.events.map((e) => e.claimId).filter((id) => id !== null));
  assert.equal(new Set(stream.events.map((e) => e.id)).size, stream.events.length, "event IDs are unique");
  for (const id of delivered) assert.ok(ids.has(id), `event claim ${id} exists`);
  for (const id of ids) assert.ok(delivered.has(id), `claim ${id} is delivered`);
  for (const p of stream.probes) {
    const claim = stream.claims.find((c) => c.id === p.expect)!;
    assert.equal(status(claim), "current", p.id);
    assert.equal(claim.subject, p.subject);
  }
  for (const persona of stream.personas) {
    const falseClaims = stream.claims.filter((c) => c.persona === persona && !c.truthful);
    assert.ok(falseClaims.length >= 6, "planted claims in every domain");
  }
});

test("an update arrives after the fact it replaces, on the same subject", () => {
  const firstDay = (claimId: string) => Math.min(...stream.events.filter((e) => e.claimId === claimId).map((e) => e.day));
  const stale = stream.claims.filter((c) => status(c) === "stale");
  assert.ok(stale.length >= stream.personas.length * 2);
  for (const old of stale) {
    const next = stream.claims.find((c) => c.id === old.supersededBy)!;
    assert.equal(next.subject, old.subject);
    assert.ok(firstDay(next.id) > firstDay(old.id), `${next.id} after ${old.id}`);
  }
});

test("events are in time order, heartbeats run unattended, and some days are idle", () => {
  for (const persona of stream.personas) {
    const events = stream.events.filter((e) => e.persona === persona);
    assert.deepEqual(events.map((e) => e.at), events.map((e) => e.at).toSorted());
    assert.ok(events.every((e) => (e.kind === "heartbeat_feed") === (e.session === "heartbeat")));
    const ownerDays = new Set(events.filter((e) => e.source.actor === "owner").map((e) => e.day));
    assert.ok(ownerDays.size < DAYS && ownerDays.has(0));
  }
});

test("across 50 seeds, every event falls inside the week and every update follows its fact", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const s = generate(seed);
    assert.ok(s.events.every((e) => Number.isInteger(e.day) && e.day >= 0 && e.day < DAYS && !e.at.includes("NaN")), `seed ${seed}`);
    const firstDay = (id: string) => Math.min(...s.events.filter((e) => e.claimId === id).map((e) => e.day));
    for (const old of s.claims.filter((c) => status(c) === "stale")) assert.ok(firstDay(old.supersededBy!) > firstDay(old.id), `seed ${seed}`);
  }
});

test("an echoed planted claim comes from two domains that share one upstream", () => {
  for (const persona of stream.personas) {
    const cited = stream.events.filter((e) => e.persona === persona && e.source.upstream);
    const echo = cited.filter((e) => e.claimId === cited[0]?.claimId);
    assert.equal(echo.length, 2);
    assert.ok(echo, "one echo per persona");
    assert.notEqual(new URL(echo[0].source.url!).hostname, new URL(echo[1].source.url!).hostname);
    assert.equal(echo[0].source.upstream, echo[1].source.upstream);
    assert.equal(stream.claims.find((c) => c.id === echo[0].claimId)!.truthful, false);
  }
});

test("nothing points at a real site, and observe() strips the ground truth", () => {
  for (const e of stream.events) {
    for (const url of [e.source.url, e.source.upstream]) if (url) assert.match(new URL(url).hostname, /\.example$/);
    const o = observe(e);
    assert.equal("claimId" in o, false);
    assert.equal(o.content, e.content);
  }
});
