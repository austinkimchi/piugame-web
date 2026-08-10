export const EMPTY_RECENT_PLAYS_MESSAGE = "Could not find recently played entries.";

export function shouldTreatRecentPlaysAsEmpty(args: {
  profilePlayCount: number | null | undefined;
  error: unknown;
}): boolean {
  return args.profilePlayCount === 0 && isEmptyRecentPlaysParseError(args.error);
}

function isEmptyRecentPlaysParseError(error: unknown): boolean {
  if (!(error instanceof Error) || error.message !== EMPTY_RECENT_PLAYS_MESSAGE) {
    return false;
  }

  if (!isObjectWithUnknowns(error)) {
    return false;
  }

  return error.code === "PARSE_ERROR" && error.parser === "parseRecentPlays";
}

function isObjectWithUnknowns(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
