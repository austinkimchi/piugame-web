import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoClient, ObjectId } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { casFilter } from '../scripts/catalog-release-write.mjs';

// Explicit opt-in only. This test neither downloads nor starts a server, and it
// refuses the normal MongoDB port so default test runs cannot reach production.
const enabled = process.env.CATALOG_WRITER_RUN_MONGO_INTEGRATION === '1';
test('MongoDB 5.0.8: exact CAS, query array traversal, field presence, and object parents', { skip: !enabled }, async () => {
  const uri = process.env.CATALOG_WRITER_TEST_MONGODB_URI ?? '';
  const match = /^mongodb:\/\/127\.0\.0\.1:(\d+)\/?$/.exec(uri);
  assert.ok(match && Number(match[1]) > 1024 && Number(match[1]) !== 27017, 'Use an explicitly supplied ephemeral loopback port, without credentials.');
  const client = new MongoClient(uri, { directConnection: true, serverSelectionTimeoutMS: 5000 });
  const databaseName = `catalog_writer_cas_${randomUUID().replaceAll('-', '')}`;
  let created = false;
  try {
    await client.connect();
    const admin = client.db('admin');
    const build = await admin.command({ buildInfo: 1 });
    assert.equal(build.version, '5.0.8');
    const hello = await admin.command({ hello: 1 });
    assert.equal(hello.isWritablePrimary, true);
    assert.equal(hello.setName, undefined);
    assert.notEqual(hello.msg, 'isdbgrid');
    const db = client.db(databaseName);
    assert.deepEqual(await db.listCollections().toArray(), []);
    await db.createCollection('cases'); created = true;
    const collection = db.collection('cases');
    const id = new ObjectId();
    const present = value => ({ present: true, value });
    const states = history => ({ _id: present(id), chartHistory: history });
    const reset = async value => collection.replaceOne({ _id: id }, { _id: id, ...value }, { upsert: true });
    const matches = async filter => !!(await collection.findOne(filter));

    await reset({ chartHistory: [] });
    const emptyFilter = casFilter(states(present([])));
    assert.ok(emptyFilter._id.equals(id));
    assert.equal(await matches(emptyFilter), true);
    assert.equal((await collection.updateOne(emptyFilter, { $set: { marker: 'normal-match' } })).matchedCount, 1);
    await reset({ chartHistory: [[]] });
    assert.equal(await matches({ _id: id, chartHistory: { $exists: true, $eq: [] } }), true, 'Reproduce the original query equality vulnerability.');
    assert.equal(await matches(emptyFilter), false);
    assert.equal((await collection.updateOne(emptyFilter, { $set: { marker: 'must-not-write' } })).matchedCount, 0);
    assert.deepEqual((await collection.findOne({ _id: id })).chartHistory, [[]]);

    const missingFilter = casFilter(states({ present: false }));
    const nullFilter = casFilter(states(present(null)));
    await reset({});
    assert.equal(await matches(missingFilter), true);
    assert.equal(await matches(nullFilter), false);
    await reset({ chartHistory: null });
    assert.equal(await matches(missingFilter), false);
    assert.equal(await matches(nullFilter), true);
    await reset({ chartHistory: [null] });
    assert.equal(await matches(nullFilter), false);

    const tokens = casFilter({ _id: present(id), 'chartTokensByVersion.phoenix2': present(['D20']) });
    await reset({ chartTokensByVersion: { phoenix2: ['D20'] } });
    assert.equal(await matches(tokens), true);
    await reset({ chartTokensByVersion: [{ phoenix2: 'D20' }] });
    assert.equal(await matches({ _id: id, $expr: { $eq: ['$chartTokensByVersion.phoenix2', { $literal: ['D20'] }] } }), true, 'Aggregation paths also traverse parent arrays.');
    assert.equal(await matches(tokens), false, 'Object-parent guard must reject that traversal.');

    const literalHistory = [{ note: '$artist', nested: { $eq: ['expression-looking', 'values'] } }];
    await reset({ chartHistory: literalHistory });
    assert.equal(await matches(casFilter(states(present(literalHistory)))), true, '$literal protects dollar-prefixed stored data.');
    console.log('Verified MongoDB 5.0.8: normal CAS, nested-array rejection, missing/null distinction, object parents, and literal data.');
  } finally {
    try { if (created) await client.db(databaseName).dropDatabase(); }
    finally { await client.close(); }
  }
});
