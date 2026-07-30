import "server-only";

export function resolveOAuthOrigin(args: {
  fallbackOrigin: string;
  override?: string;
}): string {
  const fallbackOrigin = normalizeOrigin(args.fallbackOrigin);
  const override = normalizeOrigin(args.override);
  const origin = override || fallbackOrigin;
  const allowedOrigins = allowedOAuthOrigins();

  if (allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
    throw new Error(`OAuth origin is not allowed: ${origin}`);
  }

  return origin;
}

export function publicRequestOrigin(headers: Headers, fallbackOrigin: string): string {
  const forwardedHost = firstForwardedValue(headers.get("x-forwarded-host"));
  const forwardedProto = firstForwardedValue(headers.get("x-forwarded-proto"));
  const host = forwardedHost || headers.get("host")?.trim();
  if (!host) {
    return fallbackOrigin;
  }

  const fallbackProtocol = safeProtocol(fallbackOrigin);
  const protocol = forwardedProto || fallbackProtocol;
  return `${protocol}://${host}`;
}

function allowedOAuthOrigins(): string[] {
  return String(process.env.OAUTH_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => normalizeOrigin(origin))
    .filter((origin) => origin.length > 0);
}

function normalizeOrigin(value: string | undefined): string {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function firstForwardedValue(value: string | null): string {
  return String(value ?? "").split(",")[0]?.trim() ?? "";
}

function safeProtocol(origin: string): "http" | "https" {
  try {
    const protocol = new URL(origin).protocol;
    return protocol === "http:" ? "http" : "https";
  } catch {
    return process.env.NODE_ENV === "production" ? "https" : "http";
  }
}
