import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { ObjectId, type Collection } from "mongodb";

import { isValidMobilePkceVerifier, mobilePkceChallenge } from "@/lib/mobile-auth-core";
import { AccountWriteUnavailableError, withActiveAccountWrite } from "@/lib/account-write-fence";
import { getMongoClient, hasMongoConfig } from "@/lib/mongodb";
import { PerformanceUserBusyError } from "@/lib/performance-user-lock";
import type { PiuCatalogVersion } from "@/lib/types";

const COMMUNITY_DB_NAME = process.env.COMMUNITY_DB_NAME ?? "piugame_web";
const USERS_COLLECTION = process.env.COMMUNITY_USERS_COLLECTION ?? "users";
const MOBILE_CODES_COLLECTION = process.env.MOBILE_OAUTH_CODES_COLLECTION ?? "mobile_oauth_codes";
const MOBILE_TOKENS_COLLECTION = process.env.MOBILE_ACCESS_TOKENS_COLLECTION ?? "mobile_access_tokens";
const AUTHORIZATION_CODE_TTL_SECONDS = 2 * 60;
const ACCESS_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;
const TOKEN_TOUCH_INTERVAL_MS = 15 * 60 * 1000;

declare global {
  var piuMobileAuthIndexesPromise: Promise<void> | undefined;
}

interface MobileAuthorizationCodeDocument {
  userId: ObjectId;
  codeHash: string;
  clientId: "mypiu-ios" | "mypiu-android";
  redirectUri: string;
  codeChallenge: string;
  createdAt: Date;
  expiresAt: Date;
}

interface MobileAccessTokenDocument {
  userId: ObjectId;
  tokenHash: string;
  clientId: "mypiu-ios" | "mypiu-android";
  installationId: string;
  clientName: string;
  platform: "ios" | "android";
  appVersion: string | null;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date;
  revokedAt: Date | null;
}

interface MobileUserDocument {
  name: string;
  email: string;
  username?: string | null;
  imageUrl: string | null;
  preferences?: {
    piuGameVersion?: PiuCatalogVersion;
  };
  piuLink?: {
    piuUsername?: string;
    displayName?: string;
    avatarUrl?: string | null;
  };
}

export interface MobileAccessIdentity {
  userId: string;
  clientId: "mypiu-ios" | "mypiu-android";
  installationId: string;
  tokenId: string;
  platform: "ios" | "android";
}

export interface MobileAccountSnapshot {
  id: string;
  name: string;
  email: string;
  username: string | null;
  imageUrl: string | null;
  piuGameVersion: PiuCatalogVersion;
  piuProfile: {
    piuUsername: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
}

export async function createMobileAuthorizationCode(args: {
  userId: string;
  clientId: "mypiu-ios" | "mypiu-android";
  redirectUri: string;
  codeChallenge: string;
}): Promise<string> {
  const userId = objectId(args.userId);
  try {
    return await withActiveAccountWrite([userId], async (assertLeaseOwned) => {
      const { codes } = await mobileCollections();
      const code = randomBytes(32).toString("base64url");
      const now = new Date();
      await assertLeaseOwned();
      await codes.insertOne({
        userId,
        codeHash: hashSecret(code),
        clientId: args.clientId,
        redirectUri: args.redirectUri,
        codeChallenge: args.codeChallenge,
        createdAt: now,
        expiresAt: new Date(now.getTime() + AUTHORIZATION_CODE_TTL_SECONDS * 1000),
      });
      return code;
    });
  } catch (error) {
    throwMobileAuthorizationFenceError(error);
  }
}

export async function exchangeMobileAuthorizationCode(args: {
  code: string;
  clientId: "mypiu-ios" | "mypiu-android";
  codeVerifier: string;
  redirectUri: string;
  installationId: string;
  clientName: string;
  platform: "ios" | "android";
  appVersion: string | null;
}): Promise<{ accessToken: string; expiresIn: number }> {
  if (!isValidMobilePkceVerifier(args.codeVerifier)) {
    throw new MobileAuthorizationError("invalid_grant");
  }

  const { codes } = await mobileCollections();
  const authorization = await codes.findOneAndDelete({
    codeHash: hashSecret(args.code),
    clientId: args.clientId,
    redirectUri: args.redirectUri,
    codeChallenge: mobilePkceChallenge(args.codeVerifier),
    expiresAt: { $gt: new Date() },
  });
  if (!authorization) {
    throw new MobileAuthorizationError("invalid_grant");
  }
  return issueMobileAccessToken({
    userId: authorization.userId.toHexString(),
    clientId: args.clientId,
    installationId: args.installationId,
    clientName: args.clientName,
    platform: args.platform,
    appVersion: args.appVersion,
  });
}

export async function issueMobileAccessToken(args: {
  userId: string;
  clientId: "mypiu-ios" | "mypiu-android";
  installationId: string;
  clientName: string;
  platform: "ios" | "android";
  appVersion: string | null;
}): Promise<{ accessToken: string; expiresIn: number }> {
  const userId = objectId(args.userId);
  try {
    return await withActiveAccountWrite([userId], async (assertLeaseOwned) => {
      const { tokens } = await mobileCollections();
      const accessToken = `mypiu_${randomBytes(32).toString("base64url")}`;
      const now = new Date();
      await assertLeaseOwned();
      await tokens.insertOne({
        userId,
        tokenHash: hashSecret(accessToken),
        clientId: args.clientId,
        installationId: args.installationId,
        clientName: args.clientName,
        platform: args.platform,
        appVersion: args.appVersion,
        createdAt: now,
        expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000),
        lastUsedAt: now,
        revokedAt: null,
      });
      return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
    });
  } catch (error) {
    throwMobileAuthorizationFenceError(error);
  }
}

export async function authenticateMobileAccessToken(accessToken: string | null): Promise<MobileAccessIdentity | null> {
  if (!accessToken?.startsWith("mypiu_") || !hasMongoConfig()) {
    return null;
  }

  const { users, tokens } = await mobileCollections();
  const now = new Date();
  const token = await tokens.findOne({
    tokenHash: hashSecret(accessToken),
    expiresAt: { $gt: now },
    revokedAt: null,
  });
  if (!token) {
    return null;
  }
  const user = await users.findOne({ _id: token.userId }, { projection: { _id: 1 } });
  if (!user) {
    return null;
  }

  if (now.getTime() - token.lastUsedAt.getTime() >= TOKEN_TOUCH_INTERVAL_MS) {
    void tokens
      .updateOne({ _id: token._id, revokedAt: null }, { $set: { lastUsedAt: now } })
      .catch(() => undefined);
  }

  return {
    userId: token.userId.toHexString(),
    clientId: token.clientId,
    installationId: token.installationId,
    tokenId: token._id.toHexString(),
    platform: token.platform,
  };
}

export async function revokeMobileAccessToken(accessToken: string | null): Promise<boolean> {
  if (!accessToken?.startsWith("mypiu_") || !hasMongoConfig()) {
    return false;
  }

  const { tokens } = await mobileCollections();
  const result = await tokens.updateOne(
    { tokenHash: hashSecret(accessToken), revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
  return result.modifiedCount > 0;
}

export async function getMobileAccountSnapshot(userIdInput: string): Promise<MobileAccountSnapshot | null> {
  const userId = objectId(userIdInput);
  const { users } = await mobileCollections();
  const user = await users.findOne({ _id: userId });
  if (!user) {
    return null;
  }

  const piuUsername = user.piuLink?.piuUsername?.trim();
  return {
    id: userId.toHexString(),
    name: user.name,
    email: user.email,
    username: user.username ?? null,
    imageUrl: user.imageUrl,
    piuGameVersion: user.preferences?.piuGameVersion === "phoenix2" ? "phoenix2" : "phoenix",
    piuProfile: piuUsername
      ? {
          piuUsername,
          displayName: user.piuLink?.displayName?.trim() || piuUsername,
          avatarUrl: user.piuLink?.avatarUrl ?? null,
        }
      : null,
  };
}

export class MobileAuthorizationError extends Error {
  readonly code: "invalid_grant" | "temporarily_unavailable";

  constructor(code: "invalid_grant" | "temporarily_unavailable") {
    super(code);
    this.code = code;
  }
}

function throwMobileAuthorizationFenceError(error: unknown): never {
  if (error instanceof AccountWriteUnavailableError) {
    throw new MobileAuthorizationError("invalid_grant");
  }
  if (error instanceof PerformanceUserBusyError) {
    throw new MobileAuthorizationError("temporarily_unavailable");
  }
  throw error;
}

async function mobileCollections() {
  if (!hasMongoConfig()) {
    throw new Error("MongoDB is required for mobile authentication.");
  }

  const client = await getMongoClient();
  const db = client.db(COMMUNITY_DB_NAME);
  const result = {
    users: db.collection<MobileUserDocument>(USERS_COLLECTION),
    codes: db.collection<MobileAuthorizationCodeDocument>(MOBILE_CODES_COLLECTION),
    tokens: db.collection<MobileAccessTokenDocument>(MOBILE_TOKENS_COLLECTION),
  };
  if (!globalThis.piuMobileAuthIndexesPromise) {
    globalThis.piuMobileAuthIndexesPromise = ensureMobileAuthIndexes(result.codes, result.tokens);
  }
  await globalThis.piuMobileAuthIndexesPromise;
  return result;
}

async function ensureMobileAuthIndexes(
  codes: Collection<MobileAuthorizationCodeDocument>,
  tokens: Collection<MobileAccessTokenDocument>,
): Promise<void> {
  await Promise.all([
    codes.createIndex({ codeHash: 1 }, { unique: true }),
    codes.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    tokens.createIndex({ tokenHash: 1 }, { unique: true }),
    tokens.createIndex({ userId: 1, revokedAt: 1, expiresAt: -1 }),
    tokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
}

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function objectId(value: string): ObjectId {
  if (!ObjectId.isValid(value)) {
    throw new Error("Invalid user identifier.");
  }
  return new ObjectId(value);
}
