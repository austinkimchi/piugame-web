function paginationNumber(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

export function sessionOffset(value: unknown): number {
  const parsed = paginationNumber(value);
  return parsed !== null && Number.isSafeInteger(parsed) ? Math.max(0, parsed) : 0;
}

export function sessionLimit(value: unknown, maximum = 100): number {
  const parsed = paginationNumber(value);
  return Math.min(maximum, Math.max(1, parsed ?? 50));
}
