const INTERNAL_REDIRECT_ORIGIN = "https://mypiu.invalid";

export function safeInternalRedirectPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }

  try {
    const parsed = new URL(value, INTERNAL_REDIRECT_ORIGIN);
    if (parsed.origin !== INTERNAL_REDIRECT_ORIGIN) {
      return "/";
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}
