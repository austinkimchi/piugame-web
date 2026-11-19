import test from 'node:test';
import assert from 'node:assert/strict';
import { planCatalogRelease } from '../scripts/catalog-release-plan.mjs';

const release = () => ({ release: 'PHOENIX 2 v1.02.0', version: 'phoenix2', releasedOn: '2026-10-15', sourceUrl: 'https://piugame.com/phoenix2_notice?wr_id=357', newSongs: [], chartAdditions: [], chartRevisions: [], pendingSongs: [] });
const row = () => ({ _id: { $oid: '0123456789abcdef01234567' }, songKey: 'Existing', songName: 'Existing', artist: 'Artist', chartTokens: ['S10', 'D20'], chartTokensByVersion: { phoenix: ['S9'], phoenix2: ['S10', 'D20'] }, supportedVersions: ['phoenix', 'phoenix2'], chartsFull: [{ token: 'S10', mode: 'S', level: '10', links: [{ url: 'curated' }] }], audioPath: 'manual/curated.wav', tags: ['curated'], folderPosition: 5, chartLinks: [{ id: 'phoenix:S9', tokens: { phoenix: 'S9', phoenix2: 'S10' } }], history: [{ date: '2026-07-09', note: 'curated history' }] });
const snapshot = documents => ({ documents });
const options = { asOf: '2026-11-19' };

test('additions preserve curated fields, IDs, Phoenix tokens, and old links', () => {
  const document = row();
  const original = structuredClone(document);
  const input = { ...release(), chartAdditions: [{ title: 'Existing', artist: 'Artist', chartTokens: ['S15'], note: 'Steam Link exclusive.' }] };
  const plan = planCatalogRelease(input, snapshot([document]), snapshot([document]), options);
  const change = plan.changes.find(c => c.collection === 'catalog');
  assert.equal(plan.readyForReview, true);
  assert.deepEqual(document, original);
  assert.deepEqual(change.identity._id, document._id);
  assert.deepEqual(change.set['chartTokensByVersion.phoenix2'], ['S10', 'D20', 'S15']);
  for (const field of ['audioPath', 'audioPreview', 'tags', 'folderPosition', 'chartLinks', 'history', 'chartTokensByVersion.phoenix']) assert.equal(Object.hasOwn(change.set, field), false);
  assert.deepEqual(change.set.chartsFull[0], document.chartsFull[0]);
  assert.match(change.set.chartHistory[0].note, /Steam Link/);
});

test('same-level chart revision changes history only and is idempotent', () => {
  const document = row();
  const input = { ...release(), chartRevisions: [{ title: 'Existing', chartToken: 'D20', note: 'Chart modified, level unchanged.' }] };
  const first = planCatalogRelease(input, snapshot([document]), snapshot([document]), options);
  assert.equal(first.changes.length, 1);
  assert.deepEqual(Object.keys(first.changes[0].set), ['chartHistory']);
  const after = { ...document, ...first.changes[0].set };
  assert.equal(planCatalogRelease(input, snapshot([after]), snapshot([document]), options).changes.length, 0);
});

test('multiple addition entries accumulate and retain original comparison values', () => {
  const document = row();
  const input = { ...release(), chartAdditions: ['S15', 'S17'].map(token => ({ title: 'Existing', chartTokens: [token], note: 'Official additions.' })) };
  const change = planCatalogRelease(input, snapshot([document]), snapshot([document]), options).changes.find(c => c.collection === 'catalog');
  assert.deepEqual(change.set['chartTokensByVersion.phoenix2'], ['S10', 'D20', 'S15', 'S17']);
  assert.deepEqual(change.before['chartTokensByVersion.phoenix2'], ['S10', 'D20']);
  assert.equal(change.set.chartHistory.length, 2);
});

test('new songs contain no invented previews and require verified jackets', () => {
  const song = { title: 'New', artist: 'Artist', bpm: 180, folder: 'ORIGINAL', images: [], chartTokens: ['S10', 'C2'] };
  const input = { ...release(), newSongs: [song] };
  const plan = planCatalogRelease(input, snapshot([]), snapshot([]), options);
  assert.equal(plan.readyForReview, false);
  assert.match(plan.blockers[0], /jacket/);
  assert.equal(plan.changes.length, 2);
  const document = plan.changes[0].document;
  assert.equal(document.audioPath, null);
  assert.equal(document.audioPreview, null);
  assert.equal(document.folderPosition, null);
  assert.deepEqual(document.supportedVersions, ['phoenix2']);
  input.newSongs[0].images = ['verified-jacket.png'];
  assert.equal(planCatalogRelease(input, snapshot([]), snapshot([]), options).readyForReview, true);
});

test('existing release songs are not overwritten on re-import', () => {
  const document = row();
  const song = { title: 'Existing', artist: 'Artist', bpm: 180, folder: 'ORIGINAL', images: ['jacket.png'], chartTokens: ['S10', 'D20'] };
  const input = { ...release(), newSongs: [song] };
  assert.equal(planCatalogRelease(input, snapshot([document]), snapshot([document]), options).changes.length, 0);
  song.chartTokens.push('D24');
  const plan = planCatalogRelease(input, snapshot([document]), snapshot([document]), options);
  assert.equal(plan.changes.length, 0);
  assert.equal(plan.blockers.length, 2);
});

test('future releases, ambiguous titles, and invalid or duplicate chart tokens fail closed', () => {
  assert.throws(() => planCatalogRelease({ ...release(), releasedOn: '2026-02-30' }, snapshot([]), snapshot([]), options), /valid ISO/);
  assert.throws(() => planCatalogRelease({ ...release(), releasedOn: '2026-11-24' }, snapshot([]), snapshot([]), options), /not generally available/);
  const input = { ...release(), chartRevisions: [{ title: 'Existing', chartToken: 'D20', note: 'Correction.' }] };
  assert.throws(() => planCatalogRelease(input, snapshot([row(), { ...row(), artist: 'Other' }]), snapshot([]), options), /Ambiguous/);
  for (const tokens of [['S?'], ['S10', 'S10'], ['CO-OPx2']]) {
    assert.throws(() => planCatalogRelease({ ...release(), chartAdditions: [{ title: 'Existing', chartTokens: tokens }] }, snapshot([row()]), snapshot([row()]), options), /chart tokens/);
  }
});

test('unverified R!SE additions block completion without inventing rows', () => {
  const plan = planCatalogRelease({ ...release(), pendingSongs: [{ title: 'Transmission', reason: 'Needs chart evidence.' }] }, snapshot([]), snapshot([]), options);
  assert.equal(plan.readyForReview, false);
  assert.deepEqual(plan.changes, []);
});
