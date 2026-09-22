import { isPiuSeriesId } from "./catalog-version.ts";
import type { PiuSeriesId } from "./types.ts";

export interface MobileFavoriteUpdate {
  saved: boolean;
  version: PiuSeriesId;
}

export class MobileFavoriteValidationError extends Error {}

export function parseMobileFavoriteUpdate(value: unknown): MobileFavoriteUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MobileFavoriteValidationError("Expected an object.");
  }

  const input = value as Record<string, unknown>;
  if (typeof input.saved !== "boolean") {
    throw new MobileFavoriteValidationError("saved must be a boolean.");
  }
  if (!isPiuSeriesId(input.version) || (input.version !== "phoenix" && input.version !== "phoenix2")) {
    throw new MobileFavoriteValidationError("version must be phoenix or phoenix2.");
  }

  return { saved: input.saved, version: input.version };
}
