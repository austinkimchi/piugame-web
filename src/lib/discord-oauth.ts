import "server-only";

import { resolveOAuthOrigin } from "@/lib/oauth-origin";

interface DiscordTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface DiscordUserResponse {
  id?: string;
  username?: string;
  global_name?: string | null;
  avatar?: string | null;
  email?: string | null;
  verified?: boolean;
}

export interface DiscordProfile {
  discordId: string;
  username: string;
  displayName: string;
  email: string | null;
  emailVerified: boolean;
  imageUrl: string | null;
}

export function hasDiscordOAuthConfig(): boolean {
  return Boolean(process.env.DISCORD_CLIENT_ID?.trim());
}

export function discordOAuthOrigin(fallbackOrigin: string): string {
  return resolveOAuthOrigin({
    fallbackOrigin,
    override: process.env.DISCORD_OAUTH_ORIGIN,
  });
}

export function discordAuthUrl(args: { origin: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: requireDiscordEnv("DISCORD_CLIENT_ID"),
    redirect_uri: `${args.origin}/api/auth/discord/callback`,
    response_type: "code",
    scope: "identify email",
    state: args.state,
    prompt: "consent",
  });

  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export async function exchangeDiscordCode(args: { code: string; origin: string }): Promise<DiscordProfile> {
  const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: requireDiscordEnv("DISCORD_CLIENT_ID"),
      client_secret: requireDiscordEnv("DISCORD_CLIENT_SECRET"),
      grant_type: "authorization_code",
      code: args.code,
      redirect_uri: `${args.origin}/api/auth/discord/callback`,
    }),
    cache: "no-store",
  });
  const tokenBody = (await tokenResponse.json()) as DiscordTokenResponse;
  if (!tokenResponse.ok || !tokenBody.access_token) {
    throw new Error(tokenBody.error_description || tokenBody.error || "Discord token exchange failed.");
  }

  const userResponse = await fetch("https://discord.com/api/users/@me", {
    headers: {
      Authorization: `Bearer ${tokenBody.access_token}`,
    },
    cache: "no-store",
  });
  const userBody = (await userResponse.json()) as DiscordUserResponse;
  if (!userResponse.ok || !userBody.id || !userBody.username) {
    throw new Error("Discord identity verification failed.");
  }

  return {
    discordId: userBody.id,
    username: userBody.username,
    displayName: userBody.global_name || userBody.username,
    email: userBody.verified === true ? userBody.email?.trim().toLowerCase() || null : null,
    emailVerified: userBody.verified === true && Boolean(userBody.email?.trim()),
    imageUrl: userBody.avatar ? `https://cdn.discordapp.com/avatars/${userBody.id}/${userBody.avatar}.png?size=128` : null,
  };
}

function requireDiscordEnv(key: "DISCORD_CLIENT_ID" | "DISCORD_CLIENT_SECRET"): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Missing ${key}`);
  }
  return value;
}
