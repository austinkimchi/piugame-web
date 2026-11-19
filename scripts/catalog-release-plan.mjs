import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const key = (text) => String(text ?? '').normalize('NFKC').trim().toLowerCase();
const chartPattern = /^(?:[SD](?:[1-9]|[12]\d|3[0-5])|C[2-9])$/;
const unique = (values) => [...new Set(values)];
const normalizedToken = token => String(token).replace(/^Cx/, 'C');

function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateTokens(tokens) {
  if (!Array.isArray(tokens) || !tokens.length || tokens.some(t => !chartPattern.test(t)) || unique(tokens).length !== tokens.length) {
    throw new Error('Expected unique, explicit S/D/C chart tokens.');
  }
}

function findSong(documents, entry) {
  const matches = documents.filter(d => (key(d.songKey) === key(entry.title) || key(d.songName) === key(entry.title)) && (!entry.artist || key(d.artist) === key(entry.artist)));
  if (matches.length > 1) throw new Error(`Ambiguous song identity: ${entry.title}`);
  return matches[0];
}

function chart(token) {
  return { mode: token[0], level: token.slice(1), token };
}

function existingChartToken(chart) {
  return normalizedToken(chart.token || `${chart.mode}${chart.level}`);
}

function historyEvent(release, token, type, note, document) {
  const linkedChart = document.chartLinks?.find(link => typeof link.id === 'string' && link.id.trim() && normalizedToken(String(link.tokens?.[release.version] ?? '').trim().toUpperCase().replace(/^CX/, 'C')) === token);
  return {
    id: `${release.version}:${release.releasedOn}:${token}:${type}`,
    date: release.releasedOn,
    version: release.version,
    type,
    chartId: linkedChart?.id.trim().slice(0, 80) ?? `${release.version}:${token}`,
    chartToken: token,
    note: `${release.release}: ${note}`,
  };
}

function snapshotDocuments(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.documents)) throw new Error('Expected an exported collection with documents.');
  return snapshot.documents;
}

// Produces a review artifact only. No MongoDB client or database mutation exists here.
export function planCatalogRelease(release, catalogSnapshot, sourceSnapshot, { asOf } = {}) {
  if (!isDate(asOf) || !isDate(release.releasedOn)) throw new Error('Explicit valid ISO release/as-of dates required.');
  if (release.releasedOn > asOf) throw new Error('Release is not generally available yet.');
  if (release.version !== 'phoenix2' || !release.release) throw new Error('Expected a named PHOENIX 2 release.');
  const url = new URL(release.sourceUrl);
  if (url.protocol !== 'https:' || !['piugame.com', 'www.piugame.com'].includes(url.hostname)) throw new Error('Official HTTPS notice required.');
  const catalog = snapshotDocuments(catalogSnapshot);
  const source = snapshotDocuments(sourceSnapshot);
  const plan = { release: release.release, sourceUrl: release.sourceUrl, asOf, readOnly: true, readyForReview: false, blockers: [], pendingSongs: release.pendingSongs ?? [], changes: [] };
  const identities = new Set();
  for (const entry of release.newSongs ?? []) {
    if (!entry.title || !entry.artist || !entry.folder || (entry.bpm !== null && (!Number.isFinite(entry.bpm) || entry.bpm <= 0))) throw new Error('New songs require title, artist, folder and positive BPM or explicit null.');
    validateTokens(entry.chartTokens);
    const identity = `${key(entry.title)}\0${key(entry.artist)}`;
    if (identities.has(identity)) throw new Error(`Duplicate release entry: ${entry.title}`);
    identities.add(identity);
    if (!Array.isArray(entry.images) || !entry.images.length) plan.blockers.push(`${entry.title}: official jacket not verified`);
    else if (entry.images.some(image => !/^[a-zA-Z0-9_-]+\.png$/.test(image))) throw new Error('Expected jacket filenames, not paths.');
    for (const [collection, documents, unified] of [['catalog', catalog, true], ['song_catalog_2', source, false]]) {
      const existing = findSong(documents, entry);
      if (existing) {
        const current = unified ? existing.chartTokensByVersion?.phoenix2 : existing.chartTokens;
        if (!Array.isArray(current) || entry.chartTokens.some(t => !current.map(normalizedToken).includes(t))) plan.blockers.push(`${collection}/${entry.title}: existing row differs; review explicitly as chart additions`);
        continue; // Never replace existing metadata or curated audio during re-runs.
      }
      const document = {
        songKey: entry.title, songName: entry.title, artist: entry.artist,
        piuVersion: 'phoenix2', catalogVersion: 'phoenix2', series: 'Phoenix 2', folder: entry.folder, folderPosition: null,
        bpm: entry.bpm, type: 'arcade', images: entry.images ?? [], tags: entry.tags ?? [],
        chartTokens: [...entry.chartTokens], chartsBasic: [], chartsFull: entry.chartTokens.map(chart), stepArtists: [],
        audioPath: null, audioPreview: null,
        source: { sourceFile: release.sourceUrl, releasedOn: release.releasedOn, chartEvidence: entry.chartEvidence ?? null },
      };
      if (unified) Object.assign(document, {
        catalogVersion: 'catalog', supportedVersions: ['phoenix2'], removedFromVersions: [],
        chartTokensByVersion: { phoenix2: [...entry.chartTokens] }, chartLinks: [], chartHistory: [],
        history: [{ date: release.releasedOn, type: 'added', version: 'phoenix2', note: `Added in ${release.release}.${entry.availabilityNote ? ` ${entry.availabilityNote}` : ''}` }],
      });
      plan.changes.push({ collection, action: 'insert', identity: { songKey: entry.title, artist: entry.artist }, document });
    }
  }

  // Accumulate updates per existing row, so multiple events cannot overwrite one another.
  const updates = new Map();
  function update(collection, document) {
    const id = `${collection}:${JSON.stringify(document._id)}`;
    if (!document._id) throw new Error('Existing rows require a preserved MongoDB identity.');
    if (!updates.has(id)) updates.set(id, { collection, action: 'update', identity: { _id: document._id, songKey: document.songKey, artist: document.artist }, before: {}, set: {} });
    return updates.get(id);
  }
  function addEvents(change, document, events) {
    const current = change.set.chartHistory ?? document.chartHistory ?? [];
    const added = events.filter(event => !current.some(old => old.id === event.id));
    if (!added.length) return;
    change.before.chartHistory = document.chartHistory ?? null;
    change.set.chartHistory = [...current, ...added];
  }
  for (const entry of release.chartAdditions ?? []) {
    validateTokens(entry.chartTokens);
    if (!entry.note) throw new Error('Chart additions require availability/provenance notes.');
    for (const [collection, documents, unified] of [['catalog', catalog, true], ['song_catalog_2', source, false]]) {
      const document = findSong(documents, entry);
      if (!document) { plan.blockers.push(`${collection}/${entry.title}: existing song not found`); continue; }
      if (unified && !document.supportedVersions?.includes('phoenix2')) { plan.blockers.push(`${entry.title}: PHOENIX 2 availability needs explicit review`); continue; }
      const change = update(collection, document);
      const beforeTokens = unified ? document.chartTokensByVersion?.phoenix2 : document.chartTokens;
      if (!Array.isArray(beforeTokens)) throw new Error(`Missing version-specific chart tokens: ${entry.title}`);
      const tokenField = unified ? 'chartTokensByVersion.phoenix2' : 'chartTokens';
      const tokens = change.set[tokenField] ?? beforeTokens;
      const additions = entry.chartTokens.filter(t => !tokens.map(normalizedToken).includes(t));
      if (!additions.length) continue;
      change.before[tokenField] = beforeTokens;
      change.set[tokenField] = [...tokens, ...additions];
      if (unified) {
        change.before.chartTokens = document.chartTokens ?? null;
        const union = change.set.chartTokens ?? document.chartTokens ?? [];
        change.set.chartTokens = [...union, ...additions.filter(t => !union.map(normalizedToken).includes(t))];
      }
      const full = change.set.chartsFull ?? document.chartsFull ?? [];
      change.before.chartsFull = document.chartsFull ?? null;
      change.set.chartsFull = [...full, ...additions.filter(t => !full.some(c => existingChartToken(c) === t)).map(chart)];
      if (unified) addEvents(change, document, additions.map(t => historyEvent(release, t, 'added', entry.note, document)));
    }
  }
  for (const entry of release.chartRevisions ?? []) {
    validateTokens([entry.chartToken]);
    if (!entry.note) throw new Error('Chart revisions require an official change description.');
    const document = findSong(catalog, entry);
    if (!document || !document.chartTokensByVersion?.phoenix2?.map(normalizedToken).includes(entry.chartToken)) { plan.blockers.push(`${entry.title}: revised chart missing from PHOENIX 2`); continue; }
    addEvents(update('catalog', document), document, [historyEvent(release, entry.chartToken, 'changed', entry.note, document)]);
  }
  plan.changes.push(...[...updates.values()].filter(change => Object.keys(change.set).length));
  if (plan.pendingSongs.length) plan.blockers.push(`${plan.pendingSongs.length} announced R!SE entries still need official chart evidence`);
  plan.readyForReview = plan.blockers.length === 0;
  return plan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [releaseFile, catalogFile, sourceFile, asOf, ...extra] = process.argv.slice(2);
  if (!asOf || extra.length) throw new Error('Usage: node scripts/catalog-release-plan.mjs RELEASE.json CATALOG.ejson SOURCE.ejson YYYY-MM-DD');
  const [release, catalog, source] = await Promise.all([releaseFile, catalogFile, sourceFile].map(async file => JSON.parse(await readFile(file, 'utf8'))));
  console.log(JSON.stringify(planCatalogRelease(release, catalog, source, { asOf }), null, 2));
}
