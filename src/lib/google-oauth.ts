import "server-only";

import { resolveOAuthOrigin } from "@/lib/oauth-origin";

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  id_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface GoogleTokenInfo {
  iss?: string;
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: string | boolean;
  name?: string;
  picture?: string;
  exp?: string;
  error?: string;
}

export function hasGoogleOAuthConfig(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function googleOAuthOrigin(fallbackOrigin: string): string {
  return resolveOAuthOrigin({
    fallbackOrigin,
    override: process.env.GOOGLE_OAUTH_ORIGIN,
  });
}

export function googleAuthUrl(args: { origin: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: requireGoogleEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: `${args.origin}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state: args.state,
    prompt: "select_account",
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode(args: { code: string; origin: string }) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code: args.code,
      client_id: requireGoogleEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireGoogleEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: `${args.origin}/api/auth/google/callback`,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  const body = (await response.json()) as GoogleTokenResponse;
  if (!response.ok || !body.id_token) {
    throw new Error(body.error_description || body.error || "Google token exchange failed.");
  }

  return verifyGoogleIdToken(body.id_token);
}

async function verifyGoogleIdToken(idToken: string) {
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, {
    cache: "no-store",
  });
  const body = (await response.json()) as GoogleTokenInfo;
  if (!response.ok || body.error) {
    throw new Error(body.error || "Google identity verification failed.");
  }

  if (body.aud !== requireGoogleEnv("GOOGLE_CLIENT_ID")) {
    throw new Error("Google identity audience did not match this app.");
  }
  if (body.iss !== "accounts.google.com" && body.iss !== "https://accounts.google.com") {
    throw new Error("Google identity issuer was not trusted.");
  }
  if (!body.sub || !body.email) {
    throw new Error("Google identity did not include an account id and email.");
  }
  if (body.email_verified !== true && body.email_verified !== "true") {
    throw new Error("Google identity email was not verified.");
  }

  return {
    googleId: body.sub,
    email: body.email,
    emailVerified: true,
    name: body.name ?? body.email,
    imageUrl: body.picture ?? null,
  };
}

function requireGoogleEnv(key: "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET"): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Missing ${key}`);
  }
  return value;
}
