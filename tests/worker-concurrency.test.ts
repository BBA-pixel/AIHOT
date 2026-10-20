// Changes must persist with their audit, reject invalid/unauthorized writes, drain active jobs,
// and never restart a queue while the process is shutting down.
import "./setup.ts";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import type { WorkerConcurrency } from "@aihot/contracts/admin";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { passwordLogin, SESSION_COOKIE, sessionPrincipal } from "@aihot/backend/admin/auth";
import { loadWorkerConcurrency, updateWorkerConcurrency } from "@aihot/backend/jobs/concurrency";
import { enqueue, getBoss, QUEUES, refreshWorkerConcurrency, stopBoss, watchWorkerConcurrency, work } from "@aihot/backend/jobs/queue";
import { buildApp } from "../apps/api/src/app.ts";

const app = await buildApp();
const previous = { password: config.adminPassword, dev: config.devAdmin };
const envNames = ["ANALYZE_CONCURRENCY", "FETCH_CONCURRENCY", "EXTRACT_CONCURRENCY", "DIGEST_CONCURRENCY"];
const oldEnv = new Map(envNames.map(key => [key, process.env[key]]));
const defaults: WorkerConcurrency = { analyze: 6, fetch: 8, extract: 4, digest: 3 };
const low: WorkerConcurrency = { analyze: 1, fetch: 2, extract: 1, digest: 1 };

beforeEach(async () => {
  config.adminPassword = "test-concurrency-password";
  config.devAdmin = null;
  for (const key of envNames) delete process.env[key];
  await sql`DELETE FROM settings WHERE key = 'worker.concurrency'`;
});
after(async () => {
  await app.close(); await stopBoss(); await closeDb();
  config.adminPassword = previous.password; config.devAdmin = previous.dev;
  for (const [key, value] of oldEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

async function admin() {
  const { token } = await passwordLogin(config.adminPassword!, "/admin/settings", "concurrency-test");
  const cookie = `${SESSION_COOKIE}=${token}`;
  const principal = await sessionPrincipal(cookie);
  return { cookie, "x-csrf-token": principal!.csrf };
}

test("concurrency settings require an admin and CSRF, reject invalid values, and survive a reload", async () => {
  const url = "/api/admin/settings/concurrency";
  const input = { values: low, reason: "Lower provider load" };
  assert.equal((await app.inject({ method: "PUT", url, payload: input })).statusCode, 401);
  const headers = await admin();
  assert.equal((await app.inject({ method: "PUT", url, headers: { cookie: headers.cookie }, payload: input })).statusCode, 403);
  for (const invalid of [0, -1, 1.5, 33, "2", null]) {
    assert.equal((await app.inject({ method: "PUT", url, headers, payload: { ...input, values: { ...low, analyze: invalid } } })).statusCode, 400);
  }
  assert.equal((await app.inject({ method: "PUT", url, headers, payload: { ...input, reason: " " } })).statusCode, 400);
  assert.equal((await app.inject({ method: "PUT", url, headers, payload: { ...input, values: { ...low, group: 2 } } })).statusCode, 400);
  assert.deepEqual((await loadWorkerConcurrency()).values, defaults);
  const response = await app.inject({ method: "PUT", url, headers, payload: input });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().values, low);
  assert.equal(response.json().configured, true);
  process.env.ANALYZE_CONCURRENCY = "12";
  const reloaded = await app.inject({ method: "GET", url: "/api/admin/settings", headers });
  assert.equal(reloaded.statusCode, 200, reloaded.body);
  assert.deepEqual(reloaded.json().concurrency.values, low, "saved operator choices override deployment defaults");
  const [entry] = await sql`SELECT before, after, reason FROM audit_log WHERE action='worker.concurrency.update' ORDER BY id DESC LIMIT 1`;
  assert.deepEqual(entry!.before, defaults);
  assert.deepEqual(entry!.after, low);
  assert.equal(entry!.reason, input.reason);
});

test("deployment defaults remain available before the first save, and concurrent saves retain an ordered audit", async () => {
  process.env.ANALYZE_CONCURRENCY = "1";
  process.env.FETCH_CONCURRENCY = "2";
  assert.deepEqual((await loadWorkerConcurrency()).values, { ...defaults, analyze: 1, fetch: 2 });
  assert.equal((await loadWorkerConcurrency()).configured, false);
  await Promise.all([
    updateWorkerConcurrency({ values: low, reason: "first operator" }, "concurrency-first"),
    updateWorkerConcurrency({ values: { ...low, analyze: 2 }, reason: "second operator" }, "concurrency-second"),
  ]);
  const entries = await sql`SELECT before, after FROM audit_log WHERE actor IN ('concurrency-first','concurrency-second') ORDER BY id`;
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[1]!.before, entries[0]!.after);
  assert.deepEqual((await loadWorkerConcurrency()).values, entries[1]!.after);
});

test("a failed audit commit cannot leave an unaudited concurrency change", async () => {
  await sql.unsafe(`CREATE FUNCTION reject_concurrency_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.actor='reject-concurrency' THEN RAISE EXCEPTION 'reject concurrency audit'; END IF; RETURN NEW; END $$`);
  await sql.unsafe(`CREATE CONSTRAINT TRIGGER reject_concurrency_audit AFTER INSERT ON audit_log
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_concurrency_audit()`);
  try {
    await assert.rejects(updateWorkerConcurrency({ values: low, reason: "must roll back" }, "reject-concurrency"), /reject concurrency audit/);
    assert.equal((await loadWorkerConcurrency()).configured, false);
    assert.equal((await sql`SELECT 1 FROM audit_log WHERE actor='reject-concurrency'`).length, 0);
  } finally {
    await sql.unsafe("DROP TRIGGER reject_concurrency_audit ON audit_log; DROP FUNCTION reject_concurrency_audit()");
  }
});

async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 10_000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, "queue reached the expected state");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test("live reductions and increases drain active work and shutdown cannot revive a resized queue", async (t) => {
  await updateWorkerConcurrency({ values: { ...low, analyze: 2 }, reason: "start two tasks" }, "test");
  const boss = await getBoss();
  const releases = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>();
  const started: string[] = [];
  let active = 0;
  let resizeStarted = Promise.withResolvers<void>();
  const originalOff = boss.offWork.bind(boss);
  t.mock.method(boss, "offWork", (name: Parameters<typeof boss.offWork>[0], options?: Parameters<typeof boss.offWork>[1]) => {
    const waiting = originalOff(name, options);
    if (name === QUEUES.analyze) resizeStarted.resolve();
    return waiting;
  });
  const send = async (name: string) => {
    releases.set(name, Promise.withResolvers<void>());
    await enqueue(QUEUES.analyze, { articleId: name }, { singletonKey: name });
  };
  try {
    await work(boss, QUEUES.analyze, { pollingIntervalSeconds: 0.5 }, async ({ articleId }) => {
      started.push(articleId); active++;
      await releases.get(articleId)!.promise;
      active--;
    });
    watchWorkerConcurrency();
    await send("one"); await send("two"); await send("three");
    await until(() => active === 2);
    await updateWorkerConcurrency({ values: low, reason: "reduce while busy" }, "test");
    await resizeStarted.promise;
    const reducing = refreshWorkerConcurrency();
    releases.get("one")!.resolve();
    await until(() => active === 1);
    await new Promise(resolve => setTimeout(resolve, 650));
    assert.deepEqual(new Set(started), new Set(["one", "two"]), "no queued work begins while the old pool drains");
    releases.get("two")!.resolve();
    await reducing;
    await until(() => started.includes("three"));
    await send("four");
    await new Promise(resolve => setTimeout(resolve, 650));
    assert.equal(active, 1);
    assert.ok(!started.includes("four"));
    releases.get("three")!.resolve();
    await until(() => started.includes("four"));
    resizeStarted = Promise.withResolvers<void>();
    await updateWorkerConcurrency({ values: { ...low, analyze: 2 }, reason: "increase again" }, "test");
    const increasing = refreshWorkerConcurrency();
    await resizeStarted.promise;
    await send("five"); await send("six");
    releases.get("four")!.resolve();
    await increasing;
    await until(() => active === 2);
    assert.ok(started.includes("five") && started.includes("six"));
    resizeStarted = Promise.withResolvers<void>();
    await send("must-not-start");
    await updateWorkerConcurrency({ values: low, reason: "reduce before shutdown" }, "test");
    const resizing = refreshWorkerConcurrency();
    await resizeStarted.promise;
    const stopping = stopBoss();
    releases.get("five")!.resolve(); releases.get("six")!.resolve();
    await Promise.all([resizing, stopping]);
    assert.ok(!started.includes("must-not-start"));
    assert.equal(active, 0);
  } finally {
    for (const release of releases.values()) release.resolve();
    await stopBoss();
  }
});
