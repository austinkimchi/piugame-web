import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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

test('chart history uses curated cross-version IDs for revisions and additions', () => {
  const document = row();
  document.chartLinks = [{ id: 'phoenix:D19', tokens: { phoenix: 'D19', phoenix2: 'D20' } }, { id: 'phoenix:S14', tokens: { phoenix: 'S14', phoenix2: 'S15' } }];
  const input = { ...release(), chartAdditions: [{ title: 'Existing', chartTokens: ['S15'], note: 'Added.' }], chartRevisions: [{ title: 'Existing', chartToken: 'D20', note: 'Modified.' }] };
  const plan = planCatalogRelease(input, snapshot([document]), snapshot([document]), options);
  const change = plan.changes.find(c => c.collection === 'catalog');
  assert.equal(change.set.chartHistory.find(e => e.chartToken === 'D20').chartId, 'phoenix:D19');
  assert.equal(change.set.chartHistory.find(e => e.chartToken === 'S15').chartId, 'phoenix:S14');
  assert.equal(Object.hasOwn(change.set, 'chartLinks'), false);
  document.chartLinks = [];
  const fallback = planCatalogRelease(input, snapshot([document]), snapshot([document]), options).changes.find(c => c.collection === 'catalog');
  assert.equal(fallback.set.chartHistory.find(e => e.chartToken === 'D20').chartId, 'phoenix2:D20');
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

test('unknown BPM is explicit and Steam Link availability survives insertion', () => {
  const song = { title: 'New', artist: 'Artist', bpm: null, folder: 'R!se Volume 1', images: ['jacket.png'], chartTokens: ['S15'], tags: ['Steam Link Exclusive'], availabilityNote: 'Exclusive to Steam Link accounts.' };
  const input = { ...release(), newSongs: [song] };
  const plan = planCatalogRelease(input, snapshot([]), snapshot([]), options);
  assert.equal(plan.readyForReview, true);
  assert.equal(plan.changes[0].document.bpm, null);
  assert.match(plan.changes[0].document.history[0].note, /Steam Link/);
  for (const bpm of [undefined, 0, -1, '180', NaN]) {
    assert.throws(() => planCatalogRelease({ ...input, newSongs: [{ ...song, bpm }] }, snapshot([]), snapshot([]), options), /BPM/);
  }
});

test('legacy chart objects without token are preserved without duplicates', () => {
  const document = row();
  document.chartsFull.push({ mode: 'S', level: '15', links: [{ url: 'curated' }] });
  const input = { ...release(), chartAdditions: [{ title: 'Existing', chartTokens: ['S15'], note: 'Verified.' }] };
  const plan = planCatalogRelease(input, snapshot([document]), snapshot([document]), options);
  for (const change of plan.changes) assert.deepEqual(change.set.chartsFull, document.chartsFull);
});

test('legacy Cx2 aliases compare equal without rewriting stored values', () => {
  const document = row();
  document.chartTokens = ['Cx2'];
  document.chartTokensByVersion.phoenix2 = ['Cx2'];
  document.chartsFull = [{ mode: 'C', level: 'x2', links: [{ url: 'curated' }] }];
  const addition = { ...release(), chartAdditions: [{ title: 'Existing', chartTokens: ['C2'], note: 'Verified.' }] };
  assert.deepEqual(planCatalogRelease(addition, snapshot([document]), snapshot([document]), options).changes, []);
  const existing = { ...release(), newSongs: [{ title: 'Existing', artist: 'Artist', bpm: null, folder: 'ORIGINAL', images: ['jacket.png'], chartTokens: ['C2'] }] };
  const plan = planCatalogRelease(existing, snapshot([document]), snapshot([document]), options);
  assert.equal(plan.readyForReview, true);
  assert.deepEqual(plan.changes, []);
  assert.deepEqual(document.chartTokens, ['Cx2']);
});

test('October manifest retains notice co-op charts, all observed feed charts, and verified jackets', async () => {
  const input = JSON.parse(await readFile(new URL('../scripts/releases/phoenix2-v1.02.0.json', import.meta.url)));
  const evidence = JSON.parse(await readFile(new URL('../scripts/releases/phoenix2-v1.02.0-evidence.json', import.meta.url)));
  assert.equal(input.newSongs.length, 21);
  assert.equal(input.newSongs.reduce((n, s) => n + s.chartTokens.length, 0), 171);
  assert.equal(evidence.feedSummary.rows, 4704);
  assert.equal(evidence.feedSummary.skippedRows, 0);
  assert.deepEqual(evidence.feedSummary.terminalOffsets, [4750, 4800]);
  assert.deepEqual(input.pendingSongs, []);
  assert.equal(input.newSongs.filter(s => s.bpm === null).length, 15);
  assert.equal(input.newSongs.filter(s => s.folder === 'R!se Volume 1').length, 15);
  for (const song of input.newSongs) {
    const observed = evidence.songs.find(s => s.songName === song.title && s.artist === song.artist);
    assert.ok(observed, song.title);
    const extra = song.chartTokens.filter(t => !observed.chartTokens.includes(t));
    assert.deepEqual(extra, ['NEMONEMO', 'Until Defined'].includes(song.title) ? ['C2'] : []);
    assert.ok(observed.chartTokens.every(t => song.chartTokens.includes(t)));
    assert.deepEqual(song.images, observed.images);
    for (const filename of song.images) {
      const asset = evidence.assets.find(a => a.file === filename);
      assert.ok(asset);
      const bytes = await readFile(new URL(`../public/assets/piu/phoenix2/song_img2/${filename}`, import.meta.url));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    }
  }
  const hello = { ...row(), songName: 'Hello William', songKey: 'Hello William' };
  const first = planCatalogRelease(input, snapshot([hello]), snapshot([hello]), options);
  assert.equal(first.readyForReview, true);
  assert.equal(first.changes.length, 43);
  const inserts = first.changes.filter(c => c.action === 'insert');
  assert.equal(inserts.length, 42);
  assert.ok(inserts.every(c => c.document.audioPath === null && c.document.audioPreview === null && c.document.chartsBasic.length === 0));
  assert.ok(inserts.every(c => c.document.series === 'Phoenix 2'));
  const revision = first.changes.find(c => c.action === 'update');
  assert.deepEqual(Object.keys(revision.set), ['chartHistory']);
  const after = collection => snapshot([
    collection === 'catalog' ? { ...hello, ...revision.set } : hello,
    ...inserts.filter(c => c.collection === collection).map(c => c.document),
  ]);
  const second = planCatalogRelease(input, after('catalog'), after('song_catalog_2'), options);
  assert.equal(second.readyForReview, true);
  assert.deepEqual(second.changes, []);
});
