export type MobileSyncSource = "ios" | "android" | "browser-extension";
export type MobilePiuVersion = "phoenix" | "phoenix2";

export interface MobilePerformanceImport {
  schemaVersion: 1;
  idempotencyKey: string;
  installationId: string;
  source: MobileSyncSource;
  appVersion: string | null;
  piuVersion: MobilePiuVersion;
  generatedAt: string;
  profile: {
    username: string;
    displayName: string;
    titleName: string | null;
    gameId: string | null;
    pumpTag: string | null;
    avatarUrl: string | null;
    pumbilityScore: number | null;
    pp: number | null;
    rating: number | null;
    playCount: number | null;
    clearCount: number | null;
    totalCharts: number | null;
    progressPercent: number | null;
    plateCounts: Record<string, number>;
    recentArcade: string | null;
    lastAccess: string | null;
  };
  recentPlays: MobileRecentPlay[];
}

export interface MobileRecentPlay {
  songName: string;
  mode: "S" | "D" | "C";
  level: string;
  score: number | null;
  grade: string | null;
  plate: string | null;
  stageBreak: boolean;
  judgments: {
    perfect: number | null;
    great: number | null;
    good: number | null;
    bad: number | null;
    miss: number | null;
  };
  playedAt: string;
}

export class MobileSyncValidationError extends Error {
  readonly field: string | null;

  constructor(message: string, field: string | null = null) {
    super(message);
    this.field = field;
  }
}

const FORBIDDEN_KEYS = new Set(["password", "credentials", "cookie", "cookies", "html", "rawhtml", "mb_password"]);
const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const ASSET_CODE_PATTERN = /^[a-z0-9_+-]{1,24}$/;
const PIU_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*\(GMT([+-])(\d{1,2})(?::?(\d{2}))?\)$/i;
const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/i;

export function parseMobilePerformanceImport(value: unknown, now = new Date()): MobilePerformanceImport {
  assertNoForbiddenKeys(value);
  const root = record(value, "payload");
  if (root.schemaVersion !== 1) {
    throw new MobileSyncValidationError("Unsupported schema version.", "schemaVersion");
  }

  const generatedAt = timestamp(root.generatedAt, "generatedAt");
  const generatedAtDate = new Date(generatedAt);
  if (generatedAtDate.getTime() > now.getTime() + 10 * 60 * 1000) {
    throw new MobileSyncValidationError("generatedAt is too far in the future.", "generatedAt");
  }

  const profile = record(root.profile, "profile");
  const recentPlays = array(root.recentPlays, "recentPlays", 100).map((play, index) =>
    parseRecentPlay(play, index, generatedAtDate),
  );

  return {
    schemaVersion: 1,
    idempotencyKey: text(root.idempotencyKey, "idempotencyKey", 8, 180, /^[A-Za-z0-9._:@-]+$/),
    installationId: text(root.installationId, "installationId", 8, 128, INSTALLATION_ID_PATTERN),
    source: enumValue(root.source, "source", ["ios", "android", "browser-extension"] as const),
    appVersion: optionalText(root.appVersion, "appVersion", 40),
    piuVersion: enumValue(root.piuVersion, "piuVersion", ["phoenix", "phoenix2"] as const),
    generatedAt,
    profile: {
      username: text(profile.username, "profile.username", 1, 80),
      displayName: text(profile.displayName, "profile.displayName", 1, 120),
      titleName: optionalText(profile.titleName, "profile.titleName", 120),
      gameId: optionalText(profile.gameId, "profile.gameId", 80),
      pumpTag: optionalText(profile.pumpTag, "profile.pumpTag", 80),
      avatarUrl: optionalHttpsUrl(profile.avatarUrl, "profile.avatarUrl"),
      pumbilityScore: optionalNumber(profile.pumbilityScore, "profile.pumbilityScore", 0, 10_000_000),
      pp: optionalNumber(profile.pp, "profile.pp", 0, 10_000_000),
      rating: optionalInteger(profile.rating, "profile.rating", 0, 10_000_000),
      playCount: optionalInteger(profile.playCount, "profile.playCount", 0, 100_000_000),
      clearCount: optionalInteger(profile.clearCount, "profile.clearCount", 0, 100_000_000),
      totalCharts: optionalInteger(profile.totalCharts, "profile.totalCharts", 0, 100_000_000),
      progressPercent: optionalInteger(profile.progressPercent, "profile.progressPercent", 0, 100),
      plateCounts: plateCounts(profile.plateCounts),
      recentArcade: optionalText(profile.recentArcade, "profile.recentArcade", 160),
      lastAccess: optionalText(profile.lastAccess, "profile.lastAccess", 160),
    },
    recentPlays,
  };
}

function parseRecentPlay(value: unknown, index: number, generatedAt: Date): MobileRecentPlay {
  const path = `recentPlays[${index}]`;
  const play = record(value, path);
  const playedAt = text(play.playedAt, `${path}.playedAt`, 1, 80);
  const playedAtDate = parsePlayTimestamp(playedAt);
  if (!playedAtDate || playedAtDate.getTime() > generatedAt.getTime() + 10 * 60 * 1000) {
    throw new MobileSyncValidationError("Invalid play timestamp.", `${path}.playedAt`);
  }

  return {
    songName: text(play.songName, `${path}.songName`, 1, 180),
    mode: enumValue(String(play.mode ?? "").toUpperCase(), `${path}.mode`, ["S", "D", "C"] as const),
    level: text(play.level, `${path}.level`, 1, 3, /^\d{1,3}$/),
    score: optionalInteger(play.score, `${path}.score`, 0, 1_000_000),
    grade: optionalAssetCode(play.grade, `${path}.grade`),
    plate: optionalAssetCode(play.plate, `${path}.plate`),
    stageBreak: booleanValue(play.stageBreak, `${path}.stageBreak`),
    judgments: judgments(play.judgments, path),
    playedAt,
  };
}

function judgments(value: unknown, path: string): MobileRecentPlay["judgments"] {
  if (value === undefined || value === null) {
    return { perfect: null, great: null, good: null, bad: null, miss: null };
  }
  const input = record(value, `${path}.judgments`);
  return {
    perfect: optionalInteger(input.perfect, `${path}.judgments.perfect`, 0, 100_000),
    great: optionalInteger(input.great, `${path}.judgments.great`, 0, 100_000),
    good: optionalInteger(input.good, `${path}.judgments.good`, 0, 100_000),
    bad: optionalInteger(input.bad, `${path}.judgments.bad`, 0, 100_000),
    miss: optionalInteger(input.miss, `${path}.judgments.miss`, 0, 100_000),
  };
}

function plateCounts(value: unknown): Record<string, number> {
  if (value === undefined || value === null) {
    return {};
  }
  const input = record(value, "profile.plateCounts");
  const entries = Object.entries(input);
  if (entries.length > 40) {
    throw new MobileSyncValidationError("Too many plate counts.", "profile.plateCounts");
  }
  return Object.fromEntries(
    entries.map(([key, count]) => [
      text(key.toLowerCase(), `profile.plateCounts.${key}`, 1, 24, ASSET_CODE_PATTERN),
      integer(count, `profile.plateCounts.${key}`, 0, 100_000_000),
    ]),
  );
}

function assertNoForbiddenKeys(value: unknown, depth = 0): void {
  if (depth > 8 || value === null || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenKeys(item, depth + 1);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      throw new MobileSyncValidationError("Credentials, cookies, and raw HTML are forbidden.", key);
    }
    assertNoForbiddenKeys(child, depth + 1);
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MobileSyncValidationError("Expected an object.", field);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, field: string, maxItems: number): unknown[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new MobileSyncValidationError(`Expected at most ${maxItems} items.`, field);
  }
  return value;
}

function text(value: unknown, field: string, minLength: number, maxLength: number, pattern?: RegExp): string {
  if (typeof value !== "string") {
    throw new MobileSyncValidationError("Expected text.", field);
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length < minLength || normalized.length > maxLength || (pattern && !pattern.test(normalized))) {
    throw new MobileSyncValidationError("Invalid text value.", field);
  }
  return normalized;
}

function optionalText(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  return text(value, field, 1, maxLength);
}

function optionalHttpsUrl(value: unknown, field: string): string | null {
  const normalized = optionalText(value, field, 2_048);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:") throw new Error();
    return url.toString();
  } catch {
    throw new MobileSyncValidationError("Expected an HTTPS URL.", field);
  }
}

function enumValue<const T extends readonly string[]>(value: unknown, field: string, allowed: T): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new MobileSyncValidationError("Unsupported value.", field);
  }
  return value as T[number];
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new MobileSyncValidationError("Expected a boolean.", field);
  }
  return value;
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new MobileSyncValidationError("Expected an integer in range.", field);
  }
  return value;
}

function optionalInteger(value: unknown, field: string, minimum: number, maximum: number): number | null {
  if (value === undefined || value === null) return null;
  return integer(value, field, minimum, maximum);
}

function optionalNumber(value: unknown, field: string, minimum: number, maximum: number): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new MobileSyncValidationError("Expected a number in range.", field);
  }
  return value;
}

function optionalAssetCode(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return text(String(value).toLowerCase(), field, 1, 24, ASSET_CODE_PATTERN);
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new MobileSyncValidationError("Expected a timestamp.", field);
  }
  const date = parseISOTimestamp(value);
  if (!date) {
    throw new MobileSyncValidationError("Invalid timestamp.", field);
  }
  return date.toISOString();
}

function parsePlayTimestamp(value: string): Date | null {
  const piuMatch = PIU_TIMESTAMP_PATTERN.exec(value);
  if (piuMatch) {
    const [, year, month, day, hour, minute, second = "0", sign, offsetHour, offsetMinute = "0"] = piuMatch;
    return dateFromParts({ year, month, day, hour, minute, second, milliseconds: "0", sign, offsetHour, offsetMinute });
  }
  return parseISOTimestamp(value);
}

function parseISOTimestamp(value: string): Date | null {
  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction = "0", zone, sign = "+", offsetHour = "0", offsetMinute = "0"] = match;
  return dateFromParts({
    year,
    month,
    day,
    hour,
    minute,
    second,
    milliseconds: fraction.padEnd(3, "0"),
    sign: zone.toUpperCase() === "Z" ? "+" : sign,
    offsetHour: zone.toUpperCase() === "Z" ? "0" : offsetHour,
    offsetMinute: zone.toUpperCase() === "Z" ? "0" : offsetMinute,
  });
}

function dateFromParts(parts: {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
  milliseconds: string;
  sign: string;
  offsetHour: string;
  offsetMinute: string;
}): Date | null {
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  const milliseconds = Number(parts.milliseconds);
  const offsetHour = Number(parts.offsetHour);
  const offsetMinute = Number(parts.offsetMinute);
  const wallTime = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds);
  const wallDate = new Date(wallTime);
  if (
    wallDate.getUTCFullYear() !== year ||
    wallDate.getUTCMonth() !== month - 1 ||
    wallDate.getUTCDate() !== day ||
    wallDate.getUTCHours() !== hour ||
    wallDate.getUTCMinutes() !== minute ||
    wallDate.getUTCSeconds() !== second ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return null;
  }
  const offset = (offsetHour * 60 + offsetMinute) * (parts.sign === "+" ? 1 : -1);
  return new Date(wallTime - offset * 60 * 1000);
}
