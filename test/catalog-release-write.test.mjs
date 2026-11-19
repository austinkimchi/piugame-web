import test from 'node:test';
import assert from 'node:assert/strict';
import { BSON, ObjectId } from 'mongodb';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { planCatalogRelease } from '../scripts/catalog-release-plan.mjs';
import { executeRelease, parsePlan, withJournalLock } from '../scripts/catalog-release-write.mjs';

const { EJSON } = BSON;
const release = JSON.parse(await readFile(new URL('../scripts/releases/phoenix2-v1.02.0.json', import.meta.url), 'utf8'));
const serialize = value => EJSON.stringify(value, { relaxed: false });
const copy = value => EJSON.parse(serialize(value), { relaxed: false });
const same = (a, b) => serialize(a) === serialize(b);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function get(document, field) {
  let value = document;
  for (const part of field.split('.')) {
    if (!value || !Object.hasOwn(value, part)) return { present: false };
    value = value[part];
  }
  return { present: true, value };
}
function matches(document, query) {
  return Object.entries(query).every(([field, expected]) => {
    const actual = get(document, field);
    if (expected && Object.hasOwn(expected, '$exists')) return actual.present === expected.$exists && (!Object.hasOwn(expected, '$eq') || same(actual.value, expected.$eq));
    return actual.present && same(actual.value, expected);
  });
}

class FakeDB {
  databaseName = 'test_catalog';
  documents = { catalog: [], song_catalog_2: [] };
  uuids = { catalog: new BSON.UUID(), song_catalog_2: new BSON.UUID() };
  writes = [];
  unique = true;
  listCollections({ name }) { return { toArray: async () => [{ name, info: { uuid: this.uuids[name] }, options: {} }] }; }
  collection(name) {
    const db = this;
    return {
      listIndexes: () => ({ toArray: async () => [{ key: { _id: 1 }, unique: true }, ...(db.unique ? [{ key: { songKey: 1, artist: 1 }, unique: true }] : [])] }),
      findOne: async query => copy(db.documents[name].find(d => matches(d, query)) ?? null),
      insertOne: async (document, options) => {
        await db.onWrite?.('insert', name, document);
        assert.deepEqual(options.writeConcern, { w: 'majority', j: true });
        if (db.documents[name].some(d => same(d._id, document._id) || (d.songKey === document.songKey && d.artist === document.artist))) throw Object.assign(new Error('duplicate key'), { code: 11000 });
        db.documents[name].push(copy(document));
        db.writes.push({ action: 'insert', name, id: document._id });
        return { acknowledged: true, insertedId: document._id };
      },
      updateOne: async (query, update, options) => {
        await db.onWrite?.('update', name, query);
        assert.equal(options.upsert, false);
        assert.deepEqual(options.writeConcern, { w: 'majority', j: true });
        assert.deepEqual(Object.keys(update), ['$set']);
        assert.deepEqual(Object.keys(update.$set), ['chartHistory']);
        const document = db.documents[name].find(d => matches(d, query));
        if (!document) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
        Object.assign(document, copy(update.$set));
        db.writes.push({ action: 'update', name, id: document._id });
        return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
      },
    };
  }
}

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'catalog-writer-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const db = new FakeDB();
  const hello = {
    _id: new ObjectId(), songKey: 'Hello William', songName: 'Hello William', artist: 'Banya Production',
    supportedVersions: ['phoenix', 'phoenix2'], removedFromVersions: [], chartTokensByVersion: { phoenix: ['D20'], phoenix2: ['D20'] },
    audioPath: 'manual/precisely-aligned.wav', tags: ['curated'], folderPosition: 17,
    chartsFull: [{ mode: 'D', level: '20', links: [{ url: 'curated-chart-link' }] }], unrelatedBson: BSON.Long.fromString('9223372036854775807'),
  };
  db.documents.catalog.push(copy(hello));
  const plan = planCatalogRelease(release, { documents: [hello] }, { documents: [] }, { asOf: '2026-11-19' });
  const planBytes = Buffer.from(serialize(plan));
  const journalPath = path.join(directory, 'journal.ejson');
  const options = { db, planBytes, reviewedHash: digest(planBytes), journalPath, apply: true };
  return { db, hello, plan, options, journalPath, journal: async () => EJSON.parse(await readFile(journalPath, 'utf8'), { relaxed: false }) };
}

test('EJSON retains ObjectIds and rejects altered manifests, arbitrary setters and wrong hash', async t => {
  const f = await fixture(t);
  assert.ok(parsePlan(f.options.planBytes).plan.changes.at(-1).identity._id instanceof ObjectId);
  assert.throws(() => parsePlan(f.options.planBytes, '0'.repeat(64)), /SHA-256/);
  for (const edit of [p => { p.changes[0].document.audioPath = 'unreviewed'; }, p => { p.changes.at(-1).set.audioPath = null; }, p => { p.changes.pop(); }]) {
    const changed = copy(f.plan); edit(changed);
    assert.throws(() => parsePlan(Buffer.from(serialize(changed))));
  }
});

test('default and read-only preflight never write a database or journal', async t => {
  const f = await fixture(t);
  const result = await executeRelease({ ...f.options, apply: false });
  assert.equal(result.readOnly, true); assert.equal(f.db.writes.length, 0);
  await assert.rejects(readFile(f.journalPath), { code: 'ENOENT' });
  const planFile = path.join(path.dirname(f.journalPath), 'plan.ejson');
  await writeFile(planFile, f.options.planBytes);
  const output = execFileSync(process.execPath, ['scripts/catalog-release-write.mjs', '--plan', planFile], { cwd: new URL('..', import.meta.url), env: { ...process.env, CATALOG_RELEASE_MONGODB_URI: 'invalid-do-not-connect' }, encoding: 'utf8' });
  assert.equal(JSON.parse(output).databaseContacted, false);
});

test('all operations and unique identity indexes preflight before first database write', async t => {
  const f = await fixture(t);
  f.db.unique = false;
  await assert.rejects(executeRelease(f.options), /unique/);
  f.db.unique = true;
  const last = f.plan.changes.filter(c => c.action === 'insert').at(-1);
  f.db.documents[last.collection].push({ ...copy(last.document), _id: new ObjectId() });
  await assert.rejects(executeRelease(f.options), /collision/);
  assert.equal(f.db.writes.length, 0);
  await assert.rejects(readFile(f.journalPath), { code: 'ENOENT' });
});

test('durable IDs and before/after audit precede writes; only one existing field changes', async t => {
  const f = await fixture(t), before = copy(f.hello);
  let sawPrepared = false;
  await executeRelease({ ...f.options, hooks: { afterPrepare: async operation => {
    const journal = await f.journal();
    assert.equal(journal.operations.length, 43);
    assert.ok(journal.operations.filter(o => o.action === 'insert').every(o => o.document._id instanceof ObjectId));
    assert.equal(journal.operations.find(o => o.key === operation.key).phase, 'prepared');
    sawPrepared = true;
  } } });
  const journal = await f.journal();
  assert.equal(sawPrepared, true); assert.equal(journal.phase, 'complete'); assert.equal(f.db.writes.length, 43);
  assert.ok(journal.operations.every(o => o.phase === 'done' && o.audits.at(-1).afterDocument));
  const operation = journal.operations.at(-1);
  assert.deepEqual(operation.before.chartHistory, { present: false });
  assert.equal(operation.after.chartHistory.present, true);
  const { chartHistory, ...unchanged } = f.db.documents.catalog[0];
  assert.equal(chartHistory.length, 1); assert.ok(same(unchanged, before));
  assert.ok(operation.audits.at(-1).afterDocument.unrelatedBson instanceof BSON.Long);
  assert.equal((await executeRelease({ ...f.options, resume: true })).phase, 'complete');
  assert.equal(f.db.writes.length, 43);
});

test('partial failure resumes with the same generated IDs and no repeated inserts', async t => {
  const f = await fixture(t);
  f.db.onWrite = () => { if (f.db.writes.length === 3) throw new Error('injected interruption'); };
  await assert.rejects(executeRelease(f.options), /interruption/);
  const saved = await f.journal(), ids = saved.operations.filter(o => o.action === 'insert').map(o => o.document._id.toHexString());
  assert.equal(f.db.writes.length, 3); assert.equal(saved.operations[3].phase, 'prepared');
  f.db.onWrite = null;
  await assert.rejects(executeRelease(f.options), /already exists/);
  await executeRelease({ ...f.options, resume: true, idFactory: () => { throw new Error('must not regenerate'); } });
  assert.equal(f.db.writes.length, 43);
  assert.deepEqual((await f.journal()).operations.filter(o => o.action === 'insert').map(o => o.document._id.toHexString()), ids);
});

for (const action of ['insert', 'update']) {
  test(`crash after ${action} but before result journaling recovers without repeating the write`, async t => {
    const f = await fixture(t);
    await assert.rejects(executeRelease({ ...f.options, hooks: { afterDatabaseWrite: operation => { if (operation.action === action) throw new Error('crash after write'); } } }), /crash/);
    const journal = await f.journal(), interrupted = journal.operations.find(o => o.phase === 'prepared');
    assert.equal(interrupted.action, action);
    await executeRelease({ ...f.options, resume: true });
    assert.equal(f.db.writes.length, 43);
    assert.equal((await f.journal()).operations.find(o => o.key === interrupted.key).audits.at(-1).outcome, 'recovered-after-write');
  });
}

test('CAS rejects an edit racing the final read, and resume stops on ambiguous history', async t => {
  const f = await fixture(t);
  f.db.onWrite = action => { if (action === 'update') f.db.documents.catalog[0].chartHistory = [{ id: 'manual-review', note: 'Keep this concurrent edit.' }]; };
  await assert.rejects(executeRelease(f.options), /compare-and-set/);
  assert.equal(f.db.writes.filter(w => w.action === 'update').length, 0);
  f.db.onWrite = null;
  await assert.rejects(executeRelease({ ...f.options, resume: true }), /Concurrent edit/);
  assert.equal(f.db.documents.catalog[0].chartHistory[0].id, 'manual-review');
});

test('a missing-to-null history change is a concurrent change, not a matching preimage', async t => {
  const f = await fixture(t);
  await assert.rejects(executeRelease({ ...f.options, hooks: { afterPrepare: operation => { if (operation.action === 'update') f.db.documents.catalog[0].chartHistory = null; } } }), /Concurrent edit/);
  assert.equal(f.db.writes.filter(w => w.action === 'update').length, 0);
});

test('unrelated curated changes survive the narrow history update and appear in after audit', async t => {
  const f = await fixture(t);
  await executeRelease({ ...f.options, hooks: { afterPrepare: operation => {
    if (operation.action === 'update') Object.assign(f.db.documents.catalog[0], { audioPath: 'manual/new-precise.wav', tags: ['new-curation'], folderPosition: 99 });
  } } });
  const document = f.db.documents.catalog[0];
  assert.equal(document.audioPath, 'manual/new-precise.wav'); assert.deepEqual(document.tags, ['new-curation']); assert.equal(document.folderPosition, 99);
  const audited = (await f.journal()).operations.at(-1).audits.at(-1).afterDocument;
  assert.equal(audited.audioPath, document.audioPath); assert.equal(Number(audited.folderPosition), 99);
});

test('generated ID collision and pending-operation identity collision fail closed', async t => {
  const f = await fixture(t);
  await assert.rejects(executeRelease({ ...f.options, idFactory: () => f.hello._id }), /collision/);
  assert.equal(f.db.writes.length, 0);
  await assert.rejects(executeRelease({ ...f.options, hooks: { afterPrepare: () => { throw new Error('pause before write'); } } }), /pause/);
  const journal = await f.journal(), pending = journal.operations[1];
  f.db.documents[pending.collection].push(copy(pending.document));
  await assert.rejects(executeRelease({ ...f.options, resume: true }), /collision/);
  assert.equal(f.db.writes.length, 0);
});

test('a prepared insert with a different ID or changed payload is not called already-applied', async t => {
  for (const change of ['id', 'payload']) {
    const f = await fixture(t);
    await assert.rejects(executeRelease({ ...f.options, hooks: { afterPrepare: () => { throw new Error('pause'); } } }), /pause/);
    const operation = (await f.journal()).operations[0], document = copy(operation.document);
    if (change === 'id') document._id = new ObjectId(); else document.artist = 'Concurrent change';
    f.db.documents[operation.collection].push(document);
    await assert.rejects(executeRelease({ ...f.options, resume: true }), /collision/);
    assert.equal(f.db.writes.length, 0);
  }
});

test('resume refuses collection replacement or changed plan bytes before further writes', async t => {
  const f = await fixture(t);
  await assert.rejects(executeRelease({ ...f.options, hooks: { afterPrepare: () => { throw new Error('pause'); } } }), /pause/);
  f.db.uuids.catalog = new BSON.UUID();
  await assert.rejects(executeRelease({ ...f.options, resume: true }), /UUIDs/);
  await assert.rejects(executeRelease({ ...f.options, planBytes: Buffer.concat([f.options.planBytes, Buffer.from('\n')]), resume: true }), /SHA-256/);
  assert.equal(f.db.writes.length, 0);
});

test('journal lock excludes another writer and recovers automatically after process death', async t => {
  const f = await fixture(t);
  await withJournalLock(f.journalPath, async () => {
    await assert.rejects(withJournalLock(f.journalPath, () => assert.fail('second writer entered')), /lock/);
  });
  const moduleUrl = new URL('../scripts/catalog-release-write.mjs', import.meta.url).href;
  const script = `import {withJournalLock} from ${JSON.stringify(moduleUrl)}; await withJournalLock(${JSON.stringify(f.journalPath)},async()=>{console.log('HOLDING');await new Promise(()=>{});});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  await once(child.stdout, 'data');
  await assert.rejects(withJournalLock(f.journalPath, () => assert.fail('entered held lock')), /lock/);
  child.kill('SIGKILL'); await once(child, 'exit');
  let acquired = false;
  for (let i = 0; i < 20 && !acquired; i++) {
    try { await withJournalLock(f.journalPath, () => { acquired = true; }); }
    catch { await new Promise(resolve => setTimeout(resolve, 20)); }
  }
  assert.equal(acquired, true);
});
