const CHART_TOKEN_PATTERN = /^([SDC])(?:X)?(.+)$/i;

export function performanceChartTokenKey(songName: string, mode: string | null | undefined, level: string | null | undefined): string {
  return [songName, mode ?? "unknown", level ?? "unknown"].map(normalizeChartKeyPart).join(":");
}

export function performanceChartTokenCandidates(songName: string, catalogChartToken: string | null | undefined): string[] {
  const chart = parseCatalogChartToken(catalogChartToken);
  if (!chart) {
    return [];
  }

  return Array.from(new Set(chart.modeVariants.map((mode) => performanceChartTokenKey(songName, mode, chart.level))));
}

export function performanceChartTokenCandidatesFromPlay(play: { songName: string; mode: string | null | undefined; level: string | null | undefined }): string[] {
  return normalizedModeVariants(play.mode).map((mode) => performanceChartTokenKey(play.songName, mode, play.level));
}

export function catalogChartTokenFromPlay(play: { mode: string | null | undefined; level: string | null | undefined }): string | null {
  const prefix = normalizedModeVariants(play.mode)[0];
  const level = String(play.level ?? "").trim();

  if (!/^[SDC]$/.test(prefix) || !/^\d{1,2}[+-]?$/.test(level)) {
    return null;
  }

  return `${prefix}${level}`;
}

function parseCatalogChartToken(value: string | null | undefined): { level: string; modeVariants: string[] } | null {
  const match = CHART_TOKEN_PATTERN.exec(String(value ?? "").trim());
  if (!match) {
    return null;
  }

  const [, modeRaw, levelRaw] = match;
  const level = levelRaw.trim();
  if (!level) {
    return null;
  }

  switch (modeRaw.toUpperCase()) {
    case "S":
      return { level, modeVariants: ["S", "Single", "Singles"] };
    case "D":
      return { level, modeVariants: ["D", "Double", "Doubles"] };
    case "C":
      return { level, modeVariants: ["C", "Co-op", "Coop", "Cooperative"] };
    default:
      return null;
  }
}

function normalizedModeVariants(mode: string | null | undefined): string[] {
  const normalized = mode?.replace(/[^a-z]/gi, "").toLowerCase() ?? "";
  if (normalized === "s" || normalized === "single" || normalized === "singles") {
    return ["S", "Single", "Singles"];
  }

  if (normalized === "d" || normalized === "double" || normalized === "doubles") {
    return ["D", "Double", "Doubles"];
  }

  if (normalized === "c" || normalized === "coop" || normalized === "cooperative") {
    return ["C", "Co-op", "Coop", "Cooperative"];
  }

  return [mode ?? "unknown"];
}

function normalizeChartKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
