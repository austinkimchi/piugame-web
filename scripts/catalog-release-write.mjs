import { BSON, MongoClient, ObjectId } from 'mongodb';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { open, readFile, rename, unlink, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { planCatalogRelease } from './catalog-release-plan.mjs';

const { EJSON } = BSON;
const release = JSON.parse(await readFile(new URL('./releases/phoenix2-v1.02.0.json', import.meta.url), 'utf8'));
const schema = 'piugame-october-release-journal/v1';
const collections = ['catalog', 'song_catalog_2'];
const guardedFields = ['_id', 'songKey', 'songName', 'artist', 'chartHistory', 'chartTokensByVersion.phoenix2', 'supportedVersions', 'removedFromVersions', 'chartLinks'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
const own = (value, field) => Object.hasOwn(value, field);
const clone = value => EJSON.deserialize(EJSON.serialize(value, { relaxed: false }), { relaxed: false });
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, sorted(value[k])])) : value;
const canonical = value => JSON.stringify(sorted(EJSON.serialize(value, { relaxed: false })));
const equal = (a, b) => canonical(a) === canonical(b);
const keyFor = change => `${change.collection}/${change.identity.songKey}/${change.identity.artist}`;

export function parsePlan(bytes, reviewedHash) {
  const digest = hash(bytes);
  if (reviewedHash !== undefined && reviewedHash !== digest) fail('Reviewed plan SHA-256 does not match the exact plan bytes.');
  const plan = EJSON.parse(bytes.toString(), { relaxed: false });
  if (plan.release !== release.release || plan.sourceUrl !== release.sourceUrl || plan.readyForReview !== true || plan.readOnly !== true || !equal(plan.blockers, []) || !equal(plan.pendingSongs, [])) fail('Only the reviewed, unblocked October release plan is accepted.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plan.asOf ?? '') || plan.asOf < release.releasedOn) fail('Invalid plan date.');
  const expected = planCatalogRelease(release, { documents: [] }, { documents: [] }, { asOf: plan.asOf }).changes;
  if (!Array.isArray(plan.changes) || plan.changes.length !== 43) fail('Expected exactly 42 inserts and one Hello William history update.');
  const remaining = new Map(expected.map(c => [keyFor(c), c]));
  let updates = 0;
  for (const change of plan.changes) {
    if (change.action === 'insert') {
      const wanted = remaining.get(keyFor(change));
      if (!wanted || !equal(change, wanted)) fail('Insert differs from the committed October manifest.');
      remaining.delete(keyFor(change));
    } else {
      updates++;
      if (change.action !== 'update' || change.collection !== 'catalog' || change.identity?.songKey !== 'Hello William' || change.identity?.artist !== 'Banya Production' || !(change.identity._id instanceof ObjectId) || !equal(Object.keys(change).sort(), ['action', 'before', 'collection', 'identity', 'set']) || !equal(Object.keys(change.identity).sort(), ['_id', 'artist', 'songKey']) || !equal(Object.keys(change.before ?? {}), ['chartHistory']) || !equal(Object.keys(change.set ?? {}), ['chartHistory'])) fail('Only the known Hello William chartHistory update is accepted.');
      const before = change.before.chartHistory;
      const after = change.set.chartHistory;
      if (before !== null && !Array.isArray(before)) fail('Invalid before history.');
      const event = after?.at(-1);
      const wanted = { id: 'phoenix2:2026-10-15:D20:changed', date: '2026-10-15', version: 'phoenix2', type: 'changed', chartId: event?.chartId, chartToken: 'D20', note: 'PHOENIX 2 v1.02.0: Part of the D20 chart was modified; difficulty unchanged.' };
      if (typeof event?.chartId !== 'string' || !event.chartId || !equal(event, wanted) || !equal(after, [...(before ?? []), wanted]) || (before ?? []).some(e => e.id === wanted.id)) fail('History update must append exactly the official D20 event.');
    }
  }
  if (remaining.size || updates !== 1) fail('Incomplete or duplicate release operations.');
  return { plan, planHash: digest };
}

function fieldState(document, field) {
  let value = document;
  for (const part of field.split('.')) {
    if (!value || typeof value !== 'object' || !own(value, part)) return { present: false };
    value = value[part];
  }
  return { present: true, value };
}
function relevant(document) { return Object.fromEntries(guardedFields.map(f => [f, fieldState(document, f)])); }
function casFilter(states) {
  return Object.fromEntries(Object.entries(states).map(([field, state]) => [field, state.present ? { $exists: true, $eq: state.value } : { $exists: false }]));
}
function matchesFields(document, expected) {
  return document && Object.entries(expected).every(([field, value]) => own(document, field) && equal(document[field], value));
}

async function targetIdentity(db) {
  const result = { database: db.databaseName, collections: {} };
  for (const name of collections) {
    const info = await db.listCollections({ name }, { nameOnly: false }).toArray();
    if (info.length !== 1 || !info[0].info?.uuid || (info[0].options?.collation && info[0].options.collation.locale !== 'simple')) fail(`Missing collection UUID or unsupported collation: ${name}`);
    const indexes = await db.collection(name).listIndexes().toArray();
    const identityIndex = indexes.some(i => i.unique === true && !i.partialFilterExpression && !i.sparse && (!i.collation || i.collation.locale === 'simple') && equal(Object.keys(i.key).sort(), ['artist', 'songKey']) && Number(i.key.songKey) === 1 && Number(i.key.artist) === 1);
    if (!identityIndex) fail(`Existing unique non-partial songKey+artist index required: ${name}`);
    result.collections[name] = info[0].info.uuid;
  }
  return result;
}

async function readInsert(db, operation) {
  const c = db.collection(operation.collection);
  const byId = await c.findOne({ _id: operation.document._id });
  const byIdentity = await c.findOne(operation.identity);
  if (!byId && !byIdentity) {
    if (operation.phase === 'done') fail(`Completed insert disappeared: ${operation.key}`);
    return { state: 'before', document: null };
  }
  if (operation.phase === 'pending' || !byId || !byIdentity || !equal(byIdentity._id, operation.document._id) || !matchesFields(byId, operation.document)) fail(`Insert ID/identity collision or concurrent edit: ${operation.key}`);
  return { state: 'after', document: byId };
}

async function readUpdate(db, operation) {
  const document = await db.collection(operation.collection).findOne({ _id: operation.identity._id });
  if (!document) fail('Hello William disappeared.');
  const observed = relevant(document);
  if (equal(observed, operation.after)) {
    if (operation.phase === 'pending') fail('History already changed outside this journal.');
    return { state: 'after', document };
  }
  if (equal(observed, operation.before) && operation.phase !== 'done') return { state: 'before', document };
  fail('Concurrent edit to Hello William identity, availability, links, or history.');
}
const inspect = (db, operation) => operation.action === 'insert' ? readInsert(db, operation) : readUpdate(db, operation);

async function prepare(db, parsed, target, idFactory) {
  const operations = [];
  const generatedIds = new Set();
  for (const change of parsed.plan.changes) {
    const base = { key: keyFor(change), collection: change.collection, action: change.action, identity: change.identity, phase: 'pending', audits: [] };
    if (change.action === 'insert') {
      const id = idFactory();
      if (!(id instanceof ObjectId) || generatedIds.has(id.toHexString())) fail('Generated insert IDs must be distinct ObjectIds.');
      generatedIds.add(id.toHexString());
      const operation = { ...base, document: { ...change.document, _id: id }, beforeDocument: null, expectedAfterDocument: { ...change.document, _id: id } };
      await readInsert(db, operation);
      operations.push(operation);
    } else {
      const document = await db.collection(change.collection).findOne({ _id: change.identity._id });
      if (!document || document.songKey !== change.identity.songKey || document.artist !== change.identity.artist || !equal(document.chartHistory ?? null, change.before.chartHistory)) fail('Hello William identity/history no longer matches the reviewed before state.');
      if (!document.supportedVersions?.includes('phoenix2') || document.removedFromVersions?.includes('phoenix2') || !document.chartTokensByVersion?.phoenix2?.includes('D20')) fail('Hello William D20 is no longer available in Phoenix 2.');
      const chartId = document.chartLinks?.find(link => link.tokens?.phoenix2 === 'D20')?.id ?? 'phoenix2:D20';
      if (change.set.chartHistory.at(-1).chartId !== chartId) fail('Reviewed history event does not match the current linked chart identity.');
      const before = relevant(document);
      const afterDocument = { ...document, chartHistory: change.set.chartHistory };
      operations.push({ ...base, before, after: relevant(afterDocument), beforeDocument: document, expectedAfterDocument: afterDocument, set: change.set });
    }
  }
  return { schema, planHash: parsed.planHash, target, createdAt: new Date().toISOString(), phase: 'pending', operations };
}

// Atomic replacement makes a crash expose either the old complete journal or the
// new complete journal. Both the file and its directory are fsynced before return.
export async function saveJournal(filename, journal) {
  const temporary = `${filename}.tmp-${randomUUID()}`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(EJSON.stringify(journal, { relaxed: false }, 2) + '\n');
    await handle.sync();
  } finally { await handle.close(); }
  try {
    await rename(temporary, filename);
    const directory = await open(path.dirname(filename), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}

async function journalExists(filename) {
  try {
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) fail('Journal must be a regular non-symlink file.');
    return true;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

// Linux flock owns an inode, not a removable lock directory. The helper exits on
// pipe EOF, so a killed parent releases the lock without stale-lock deletion.
export async function withJournalLock(filename, callback) {
  const lockfile = `${filename}.lock`;
  const lockHandle = await open(lockfile, 'a', 0o600);
  await lockHandle.close();
  const child = spawn('flock', ['--exclusive', '--nonblock', lockfile, process.execPath, '-e', 'process.stdin.resume();process.stdin.on("end",()=>process.exit(0));process.stdout.write("LOCKED\\n");'], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.on('error', () => {}); // A failed lock helper can close this pipe first.
  let acquired = false;
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', () => reject(new Error('Another writer holds the journal lock, or flock is unavailable.')));
      child.stdout.once('data', data => {
        if (data.toString().trim() === 'LOCKED') { acquired = true; resolve(); }
        else reject(new Error('Unexpected flock helper response.'));
      });
    });
    return await callback();
  } finally {
    child.stdin.end();
    if (acquired && child.exitCode === null) await once(child, 'exit');
  }
}

function validateResume(journal, parsed, target) {
  if (journal.schema !== schema || journal.planHash !== parsed.planHash || !equal(journal.target, target) || !['pending', 'complete'].includes(journal.phase) || !Array.isArray(journal.operations) || journal.operations.length !== 43) fail('Journal does not match this plan and collection UUIDs.');
  const generatedIds = new Set();
  for (let i = 0; i < journal.operations.length; i++) {
    const operation = journal.operations[i], change = parsed.plan.changes[i];
    if (operation.key !== keyFor(change) || operation.action !== change.action || operation.collection !== change.collection || !equal(operation.identity, change.identity) || !['pending', 'prepared', 'done'].includes(operation.phase)) fail('Invalid journal operation identity or phase.');
    if (!Array.isArray(operation.audits) || (operation.phase !== 'pending' && !operation.audits.some(a => a.outcome === 'write-intent')) || (operation.phase === 'done' && !['acknowledged', 'recovered-after-write'].includes(operation.audits.at(-1)?.outcome)) || (journal.phase === 'complete' && operation.phase !== 'done')) fail('Invalid journal audit/phase transition.');
    if (change.action === 'insert') {
      const { _id, ...document } = operation.document;
      if (!(_id instanceof ObjectId) || generatedIds.has(_id.toHexString()) || !equal(document, change.document) || !equal(operation.expectedAfterDocument, operation.document) || operation.beforeDocument !== null) fail('Invalid journal insert payload.');
      generatedIds.add(_id.toHexString());
    } else {
      if (!equal(operation.set, change.set) || !equal(operation.before, relevant(operation.beforeDocument)) || !equal(operation.after, relevant({ ...operation.beforeDocument, ...change.set })) || !equal(operation.expectedAfterDocument, { ...operation.beforeDocument, ...change.set }) || !equal(operation.beforeDocument.chartHistory ?? null, change.before.chartHistory) || !equal(operation.beforeDocument._id, change.identity._id)) fail('Invalid journal update payload.');
    }
  }
}

export async function executeRelease({ db, planBytes, reviewedHash, journalPath, apply = false, resume = false, idFactory = () => new ObjectId(), hooks = {} }) {
  const parsed = parsePlan(planBytes, reviewedHash);
  if (apply && (!reviewedHash || !journalPath)) fail('Apply requires an explicit reviewed SHA-256 and journal path.');
  if (resume && !apply) fail('Resume requires explicit apply.');
  if (!apply) {
    const target = await targetIdentity(db);
    await prepare(db, parsed, target, idFactory);
    return { readOnly: true, planHash: parsed.planHash, operations: 43, target };
  }
  return withJournalLock(journalPath, async () => {
    const exists = await journalExists(journalPath);
    if (exists !== resume) fail(exists ? 'Journal already exists; use explicit resume with the same plan.' : 'Resume journal is missing.');
    const target = await targetIdentity(db);
    const journal = exists ? EJSON.parse(await readFile(journalPath, 'utf8'), { relaxed: false }) : await prepare(db, parsed, target, idFactory);
    if (exists) validateResume(journal, parsed, target);
    // Check all operations before any write, including already completed ones.
    for (const operation of journal.operations) await inspect(db, operation);
    if (!exists) await saveJournal(journalPath, journal);
    for (const operation of journal.operations) {
      await hooks.beforeOperation?.(operation);
      let observed = await inspect(db, operation);
      if (observed.state === 'after') {
        if (operation.phase !== 'done') {
          operation.phase = 'done';
          operation.audits.push({ at: new Date().toISOString(), outcome: 'recovered-after-write', afterDocument: observed.document });
          await saveJournal(journalPath, journal);
        }
        continue;
      }
      operation.phase = 'prepared';
      operation.audits.push({ at: new Date().toISOString(), outcome: 'write-intent', beforeDocument: observed.document, expectedAfterDocument: operation.action === 'insert' ? operation.document : { ...observed.document, ...operation.set } });
      await saveJournal(journalPath, journal);
      await hooks.afterPrepare?.(operation);
      // Recheck after journal I/O. The actual update is still atomic CAS; insert
      // races are stopped by both _id and the required unique identity index.
      observed = await inspect(db, operation);
      if (observed.state !== 'before') fail('State changed after write intent; resume to inspect it explicitly.');
      const collection = db.collection(operation.collection);
      const writeConcern = { w: 'majority', j: true };
      let result;
      if (operation.action === 'insert') result = await collection.insertOne(operation.document, { writeConcern });
      else result = await collection.updateOne(casFilter(operation.before), { $set: operation.set }, { writeConcern, upsert: false });
      await hooks.afterDatabaseWrite?.(operation);
      if (result.acknowledged !== true || (operation.action === 'update' && Number(result.matchedCount) !== 1)) fail('Write was not acknowledged or compare-and-set did not match; resume with the same journal.');
      const after = await inspect(db, operation);
      if (after.state !== 'after') fail('Database result did not match the intended after state.');
      operation.phase = 'done';
      operation.audits.push({ at: new Date().toISOString(), outcome: 'acknowledged', result, afterDocument: after.document });
      await saveJournal(journalPath, journal);
    }
    journal.phase = 'complete';
    await saveJournal(journalPath, journal);
    return { readOnly: false, planHash: parsed.planHash, operations: journal.operations.length, phase: journal.phase, journalPath };
  });
}

async function cli() {
  const args = process.argv.slice(2), options = {};
  const valueFlags = new Set(['--plan', '--reviewed-sha256', '--journal', '--database']);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (own(options, arg)) fail(`Duplicate argument: ${arg}`);
    if (valueFlags.has(arg)) { if (!args[i + 1] || args[i + 1].startsWith('--')) fail(`Missing value: ${arg}`); options[arg] = args[++i]; }
    else if (['--apply', '--resume', '--preflight'].includes(arg)) options[arg] = true;
    else fail(`Unknown argument: ${arg}`);
  }
  if (!options['--plan']) fail('Usage: --plan FILE [--preflight --database NAME] [--apply --reviewed-sha256 HASH --journal FILE --database NAME [--resume]]');
  const planBytes = await readFile(options['--plan']);
  const parsed = parsePlan(planBytes, options['--reviewed-sha256']);
  if (options['--resume'] && !options['--apply']) fail('Resume requires --apply.');
  if (!options['--apply'] && !options['--preflight']) {
    console.log(JSON.stringify({ readOnly: true, planHash: parsed.planHash, operations: 43, databaseContacted: false }));
    return;
  }
  if (!options['--database'] || !process.env.CATALOG_RELEASE_MONGODB_URI) fail('Explicit --database and CATALOG_RELEASE_MONGODB_URI required; application .env files are never loaded.');
  if (options['--apply']) {
    if (!options['--reviewed-sha256'] || !options['--journal'] || !path.isAbsolute(options['--journal'])) fail('Apply requires a reviewed hash and absolute journal path.');
    const directory = await realpath(path.dirname(options['--journal']));
    const repository = await realpath(fileURLToPath(new URL('..', import.meta.url)));
    if (directory === repository || directory.startsWith(repository + path.sep)) fail('Journal must stay outside the Git checkout.');
    options['--journal'] = path.join(directory, path.basename(options['--journal']));
  }
  const client = new MongoClient(process.env.CATALOG_RELEASE_MONGODB_URI, { retryWrites: false, readPreference: 'primary', serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    console.log(JSON.stringify(await executeRelease({ db: client.db(options['--database']), planBytes, reviewedHash: options['--reviewed-sha256'], journalPath: options['--journal'], apply: !!options['--apply'], resume: !!options['--resume'] })));
  } finally { await client.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli().catch(error => { console.error(error.name === 'MongoServerError' || error.name?.startsWith('Mongo') ? 'MongoDB operation failed. Do not use a new journal; inspect and resume the existing journal.' : error.message); process.exitCode = 1; });
}
