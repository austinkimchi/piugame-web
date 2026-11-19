import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";
import { ObjectId } from "mongodb";
import ts from "typescript";

type Auth = typeof import("../src/lib/auth.ts");
type User = Awaited<ReturnType<Auth["upsertDiscordUser"]>>;
type GoogleProfile = Parameters<Auth["upsertGoogleUser"]>[0];
type DiscordProfile = Parameters<Auth["upsertDiscordUser"]>[0];
type Filter = Record<string, unknown>;

// Exercise the actual server entry points with a closed dependency map: these tests
// cannot connect to MongoDB, an OAuth provider, or the account/bot services.
function loadServerModule<T>(filename: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../src/lib/${filename}.ts`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const loadedModule = { exports: {} };
  const require = (name: string) => {
    if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected server dependency: ${name}`);
    return dependencies[name];
  };
  new Function("require", "module", "exports", outputText)(require, loadedModule, loadedModule.exports);
  return loadedModule.exports as T;
}

function setEnv(t: TestContext, values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
}

const googleProfile: GoogleProfile = {
  googleId: "google-player", email: "player@example.com", emailVerified: true,
  name: "Player", imageUrl: null,
};
const discordProfile: DiscordProfile = {
  discordId: "discord-player", username: "player", displayName: "Player",
  email: "player@example.com", emailVerified: true, imageUrl: null,
};

function user(overrides: Partial<User> = {}): User {
  return {
    _id: new ObjectId(), email: "player@example.com", emailVerified: true,
    name: "Existing player", imageUrl: null, primaryProvider: "apple",
    providers: [{ provider: "apple", providerAccountId: "apple-player" }],
    roles: ["user"], createdAt: new Date(), updatedAt: new Date(), lastLoginAt: new Date(),
    ...overrides,
  };
}

function authFixture(initial: User[] = []) {
  const users = [...initial];
  const events: string[] = [];
  let beforeLease: (() => void) | undefined;
  let rejectLease = false;
  function matches(document: User, filter: Filter): boolean {
    return Object.entries(filter).every(([key, value]) => {
      if (key === "$or") return (value as Filter[]).some((part) => matches(document, part));
      if (key === "_id") return document._id.equals(value as ObjectId);
      if (key === "email" || key === "appleId") return document[key] === value;
      if (key === "providers") {
        const identity = (value as { $elemMatch: { provider: string; providerAccountId: string } }).$elemMatch;
        return document.providers.some((provider) => provider.provider === identity.provider && provider.providerAccountId === identity.providerAccountId);
      }
      throw new Error(`Unexpected user filter: ${key}`);
    });
  }
  function checkUniqueEmail(email: string, exceptId?: ObjectId) {
    if (users.some((document) => document.email === email && !document._id.equals(exceptId))) {
      throw new Error("Duplicate account email");
    }
  }
  const collection = {
    indexes: async () => [],
    createIndex: async () => "test-index",
    deleteMany: async () => { events.push("bot-delete"); },
    updateOne: async () => { events.push("bot-update"); },
  };
  const userCollection = {
    ...collection,
    findOne: async (filter: Filter) => users.find((document) => matches(document, filter)) ?? null,
    insertOne: async (document: Omit<User, "_id">) => {
      checkUniqueEmail(document.email);
      const insertedId = new ObjectId();
      users.push({ ...document, _id: insertedId });
      events.push("insert");
      return { insertedId };
    },
    findOneAndUpdate: async (filter: Filter, update: { $set: Partial<User>; $push?: { providers: User["providers"][number] } }) => {
      const document = users.find((candidate) => matches(candidate, filter));
      if (!document) return null;
      checkUniqueEmail(update.$set.email ?? document.email, document._id);
      Object.assign(document, update.$set);
      if (update.$push) document.providers.push(update.$push.providers);
      events.push("update");
      return document;
    },
  };
  const require = createRequire(import.meta.url);
  const dependencies = {
    "server-only": {},
    "node:crypto": require("node:crypto"),
    mongodb: { ObjectId },
    "next/headers": {},
    react: { cache: (fn: unknown) => fn },
    "@/lib/account-deletion-core": { DISCORD_BOT_USER_COLLECTIONS: ["test_bot_accounts"] },
    "@/lib/account-write-fence": {
      withActiveAccountWrite: async (ids: ObjectId[], operation: (assertLeaseOwned: () => Promise<void>) => unknown) => {
        events.push("lease");
        beforeLease?.();
        const assertLeaseOwned = async () => {
          events.push("assert-lease");
          if (rejectLease || ids.some((id) => !users.some((document) => document._id.equals(id)))) throw new Error("Account unavailable");
        };
        await assertLeaseOwned();
        return operation(assertLeaseOwned);
      },
    },
    "@/lib/mongodb": {
      hasMongoConfig: () => true,
      getMongoClient: async () => ({ db: () => ({ collection: (name: string) => name === (process.env.COMMUNITY_USERS_COLLECTION ?? "users") ? userCollection : collection }) }),
    },
    "@/lib/credential-crypto": {},
    "@/lib/performance-user-lock": {},
    "@/lib/piu-account": {},
    "@/lib/performance": {},
    "@/lib/performance-format": {},
    "@/lib/piu-version": { DEFAULT_PIU_GAME_VERSION: "phoenix2", normalizePiuGameVersion: () => "phoenix2" },
  };
  globalThis.piuCommunityIndexesPromise = undefined;
  return {
    auth: loadServerModule<Auth>("auth", dependencies), users, events,
    beforeLease: (fn: () => void) => { beforeLease = fn; },
    rejectLease: () => { rejectLease = true; },
  };
}

function oauthFixture(t: TestContext, provider: "google" | "discord", identity: object) {
  setEnv(t, {
    GOOGLE_CLIENT_ID: "test-google-client", GOOGLE_CLIENT_SECRET: "test-secret",
    DISCORD_CLIENT_ID: "test-discord-client", DISCORD_CLIENT_SECRET: "test-secret",
  });
  let request = 0;
  t.mock.method(globalThis, "fetch", async () => {
    request += 1;
    assert.ok(request <= 2, "Only token exchange and identity validation are expected");
    return Response.json(request === 1 ? { access_token: "test-access", id_token: "test-id" } : identity);
  });
  const dependencies = { "server-only": {}, "@/lib/oauth-origin": {} };
  return provider === "google"
    ? loadServerModule<typeof import("../src/lib/google-oauth.ts")>("google-oauth", dependencies).exchangeGoogleCode
    : loadServerModule<typeof import("../src/lib/discord-oauth.ts")>("discord-oauth", dependencies).exchangeDiscordCode;
}

for (const verified of [false, "false", undefined, "TRUE", 1]) {
  test(`Google token claims reject unverified email (${String(verified)})`, async (t) => {
    const exchange = oauthFixture(t, "google", {
      aud: "test-google-client", iss: "https://accounts.google.com", sub: "google-player",
      email: "player@example.com", email_verified: verified,
    });
    await assert.rejects(exchange({ code: "test-code", origin: "https://example.com" }), /email was not verified/);
  });
}

for (const verified of [true, "true"]) {
  test(`Google token claims accept verified email (${typeof verified})`, async (t) => {
    const exchange = oauthFixture(t, "google", {
      aud: "test-google-client", iss: "accounts.google.com", sub: "google-player",
      email: "player@example.com", email_verified: verified,
    });
    const profile = await exchange({ code: "test-code", origin: "https://example.com" });
    assert.equal(profile.email, "player@example.com");
    assert.equal(profile.emailVerified, true);
  });
}

for (const verified of [false, undefined, "true"]) {
  test(`Discord discards email without boolean verification (${String(verified)})`, async (t) => {
    const exchange = oauthFixture(t, "discord", { id: "discord-player", username: "player", email: "admin@example.com", verified });
    const profile = await exchange({ code: "test-code", origin: "https://example.com" });
    assert.equal(profile.email, null);
    assert.equal(profile.emailVerified, false);
  });
}

test("Discord accepts and normalizes only a verified, nonempty email", async (t) => {
  const exchange = oauthFixture(t, "discord", { id: "discord-player", username: "player", email: " PLAYER@EXAMPLE.COM ", verified: true });
  const profile = await exchange({ code: "test-code", origin: "https://example.com" });
  assert.equal(profile.email, "player@example.com");
  assert.equal(profile.emailVerified, true);
});

test("Discord does not treat a missing email as verified", async (t) => {
  const exchange = oauthFixture(t, "discord", { id: "discord-player", username: "player", verified: true });
  const profile = await exchange({ code: "test-code", origin: "https://example.com" });
  assert.equal(profile.email, null);
  assert.equal(profile.emailVerified, false);
});

test("Google upsert independently rejects an unverified profile before any write", async () => {
  const fixture = authFixture([user()]);
  await assert.rejects(fixture.auth.upsertGoogleUser({ ...googleProfile, emailVerified: false }), /email was not verified/);
  assert.deepEqual(fixture.events, []);
  assert.equal(fixture.users.length, 1);
});

test("an unverified Discord email cannot sign in to a verified Google account", async () => {
  const owner = user({ providers: [{ provider: "google", providerAccountId: "owner-google" }] });
  const fixture = authFixture([owner]);
  const created = await fixture.auth.upsertDiscordUser({ ...discordProfile, emailVerified: false });
  assert.notEqual(created._id.toHexString(), owner._id.toHexString());
  assert.equal(created.email, "discord-discord-player@piugame.local");
  assert.equal(created.emailVerified, false);
  assert.equal(created.providers[0].email, undefined);
  assert.deepEqual(owner.providers, [{ provider: "google", providerAccountId: "owner-google" }]);
});

for (const provider of ["google", "discord"] as const) {
  const upsert = (auth: Auth) => provider === "google" ? auth.upsertGoogleUser(googleProfile) : auth.upsertDiscordUser(discordProfile);

  test(`${provider} cannot claim an account seeded with an unverified matching email`, async () => {
    const owner = user({ emailVerified: false });
    const fixture = authFixture([owner]);
    const created = await upsert(fixture.auth);
    assert.notEqual(created._id.toHexString(), owner._id.toHexString());
    assert.match(created.email, new RegExp(`^${provider}-.+@piugame\\.local$`));
    assert.equal(created.emailVerified, false);
    assert.equal(owner.emailVerified, false);
    assert.equal(owner.providers.length, 1);
    const repeat = await upsert(fixture.auth);
    assert.equal(repeat._id.toHexString(), created._id.toHexString());
    assert.equal(fixture.users.length, 2);
  });

  test(`${provider} can link to an account with a verified matching email`, async () => {
    const owner = user();
    const fixture = authFixture([owner]);
    const linked = await upsert(fixture.auth);
    assert.equal(linked._id.toHexString(), owner._id.toHexString());
    assert.equal(linked.emailVerified, true);
    assert.equal(linked.providers.length, 2);
    assert.ok(fixture.events.includes("lease"));
  });

  test(`${provider} uses the provider owner before a different verified email owner`, async () => {
    const emailOwner = user();
    const providerOwner = user({
      email: "old-address@example.com", emailVerified: false,
      providers: [{ provider, providerAccountId: `${provider}-player` }],
    });
    const fixture = authFixture([emailOwner, providerOwner]);
    const signedIn = await upsert(fixture.auth);
    assert.equal(signedIn._id.toHexString(), providerOwner._id.toHexString());
    assert.equal(signedIn.email, "old-address@example.com");
    assert.equal(signedIn.emailVerified, false, "a different verified address must not verify the stored address");
    assert.equal(emailOwner.providers.length, 1);
  });

  test(`${provider} rechecks email verification after acquiring the account lease`, async () => {
    const owner = user();
    const fixture = authFixture([owner]);
    fixture.beforeLease(() => { owner.emailVerified = false; });
    await assert.rejects(upsert(fixture.auth), /no longer verified/);
    assert.ok(!fixture.events.includes("update"));
    assert.equal(owner.providers.length, 1);
  });

  test(`${provider} does not recreate an account deleted before the lease`, async () => {
    const fixture = authFixture([user()]);
    fixture.beforeLease(() => { fixture.users.splice(0); });
    await assert.rejects(upsert(fixture.auth), /Account unavailable/);
    assert.equal(fixture.users.length, 0);
    assert.ok(!fixture.events.includes("insert"));
  });
}

test("Discord upgrades its own placeholder after verification without losing the account", async () => {
  const fixture = authFixture();
  const first = await fixture.auth.upsertDiscordUser({ ...discordProfile, emailVerified: false });
  const originalId = first._id.toHexString();
  const verified = await fixture.auth.upsertDiscordUser(discordProfile);
  assert.equal(verified._id.toHexString(), originalId);
  assert.equal(verified.email, "player@example.com");
  assert.equal(verified.emailVerified, true);
  assert.equal(fixture.users.length, 1);
});

test("Discord preserves both accounts when a placeholder upgrades to an already-owned email", async () => {
  const emailOwner = user();
  const fixture = authFixture([emailOwner]);
  const first = await fixture.auth.upsertDiscordUser({ ...discordProfile, emailVerified: false });
  const verified = await fixture.auth.upsertDiscordUser(discordProfile);
  assert.equal(verified._id.toHexString(), first._id.toHexString());
  assert.equal(verified.email, "discord-discord-player@piugame.local");
  assert.equal(verified.emailVerified, false);
  assert.equal(emailOwner.providers.length, 1);
  assert.equal(fixture.users.length, 2);
});

test("Google can promote its collision placeholder only after the address becomes unclaimed", async () => {
  const unverifiedOwner = user({ emailVerified: false });
  const fixture = authFixture([unverifiedOwner]);
  const first = await fixture.auth.upsertGoogleUser(googleProfile);
  const originalId = first._id.toHexString();
  assert.notEqual(first.email, googleProfile.email);
  fixture.users.splice(fixture.users.indexOf(unverifiedOwner), 1);
  const verified = await fixture.auth.upsertGoogleUser(googleProfile);
  assert.equal(verified._id.toHexString(), originalId);
  assert.equal(verified.email, googleProfile.email);
  assert.equal(verified.emailVerified, true);
});

test("a later unverified Discord profile does not downgrade a previously verified account", async () => {
  const fixture = authFixture();
  const first = await fixture.auth.upsertDiscordUser(discordProfile);
  const signedIn = await fixture.auth.upsertDiscordUser({ ...discordProfile, emailVerified: false });
  assert.equal(signedIn._id.toHexString(), first._id.toHexString());
  assert.equal(signedIn.email, discordProfile.email);
  assert.equal(signedIn.emailVerified, true);
  assert.equal(signedIn.providers[0].email, undefined);
});

test("an explicit Discord link keeps the authenticated account email and verification", async () => {
  const owner = user();
  const fixture = authFixture([owner]);
  const linked = await fixture.auth.upsertDiscordUser({ ...discordProfile, email: "unverified@example.com", emailVerified: false }, owner._id.toHexString());
  assert.equal(linked.email, "player@example.com");
  assert.equal(linked.emailVerified, true);
  assert.equal(linked.providers.find((provider) => provider.provider === "discord")?.email, undefined);
});

test("an explicit Discord link cannot take a provider from another account", async () => {
  const owner = user();
  const discordOwner = user({ email: "other@example.com", providers: [{ provider: "discord", providerAccountId: "discord-player" }] });
  const fixture = authFixture([owner, discordOwner]);
  await assert.rejects(fixture.auth.upsertDiscordUser(discordProfile, owner._id.toHexString()), /already linked to another user/);
  assert.ok(!fixture.events.includes("update"));
  assert.ok(!fixture.events.includes("bot-delete"));
});

test("Discord writes fail when account lease ownership is lost", async () => {
  const fixture = authFixture([user()]);
  fixture.rejectLease();
  await assert.rejects(fixture.auth.upsertDiscordUser(discordProfile), /Account unavailable/);
  assert.ok(!fixture.events.includes("update"));
});

test("administrator allowlists require verified account email, preserving explicit moderators", async (t) => {
  setEnv(t, { SITE_ADMIN_EMAILS: "ADMIN@EXAMPLE.COM" });
  const unverified = user({ email: "admin@example.com", emailVerified: false, roles: ["user", "admin"] });
  const verified = user({ email: "ADMIN@example.com", emailVerified: true });
  const moderator = user({ email: "moderator@example.com", emailVerified: false, roles: ["moderator"] });
  const fixture = authFixture([unverified, verified, moderator]);
  assert.deepEqual((await fixture.auth.getUserById(unverified._id.toHexString()))?.roles, ["user"]);
  assert.deepEqual((await fixture.auth.getUserById(verified._id.toHexString()))?.roles, ["user", "admin", "moderator"]);
  assert.deepEqual((await fixture.auth.getUserById(moderator._id.toHexString()))?.roles, ["user", "moderator"]);
});

test("Apple still links a verified email to the existing account and keeps Google", async () => {
  const owner = user({ providers: [{ provider: "google", providerAccountId: "google-player" }] });
  const fixture = authFixture([owner]);
  const linked = await fixture.auth.upsertAppleUser({ appleId: "apple-player", email: owner.email, emailVerified: true, name: "Apple player" });
  assert.equal(linked._id.toHexString(), owner._id.toHexString());
  assert.equal(linked.appleId, "apple-player");
  assert.deepEqual(linked.providers.map((provider) => provider.provider), ["google", "apple"]);
  assert.ok(fixture.events.includes("lease"));
});

test("an explicit Apple link still cannot take an identity owned by another account", async () => {
  const owner = user({ providers: [{ provider: "google", providerAccountId: "google-player" }] });
  const appleOwner = user({ email: "other@example.com", appleId: "apple-player" });
  const fixture = authFixture([owner, appleOwner]);
  await assert.rejects(fixture.auth.upsertAppleUser({ appleId: "apple-player", email: owner.email, emailVerified: true, name: null }, owner._id.toHexString()), /already linked to another user/);
  assert.ok(!fixture.events.includes("update"));
});
