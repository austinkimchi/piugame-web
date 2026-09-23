import type { TitleEntry, TitleRequirementMetric } from "@austinkimchi/piugame-sdk";

export interface NextTitleObjective {
  name: string;
  metric: TitleRequirementMetric;
  current: number;
  target: number;
}

const TITLE_METRIC_PREFIXES: Array<[RegExp, TitleRequirementMetric]> = [
  [/^\[S\]|^SINGLE\s/i, "single_pumbility"],
  [/^\[D\]|^DOUBLE\s/i, "double_pumbility"],
  [/^\[P\.B\]/i, "total_pumbility"],
];

export function selectNextTitleObjective(
  titles: TitleEntry[],
  currentTitleName: string | null,
): NextTitleObjective | null {
  const candidates = titles
    .filter((title): title is TitleEntry & { requirement: NonNullable<TitleEntry["requirement"]> } =>
      title.locked && !title.owned && title.requirement !== null && title.requirement.current !== null,
    )
    .filter((title) => !/^\?+$/.test(title.name.trim()))
    .map((title) => ({
      name: title.name,
      metric: title.requirement.metric,
      current: title.requirement.current!,
      target: title.requirement.target,
    }))
    .filter((candidate) => candidate.target > candidate.current);

  if (candidates.length === 0) {
    return null;
  }

  const preferredMetric = TITLE_METRIC_PREFIXES.find(([pattern]) =>
    pattern.test(currentTitleName?.trim() ?? ""),
  )?.[1];
  const pool = preferredMetric
    ? candidates.filter((candidate) => candidate.metric === preferredMetric)
    : candidates;
  const ranked = pool.length > 0 ? pool : candidates;

  return ranked.sort((left, right) => {
    const leftProgress = left.current / left.target;
    const rightProgress = right.current / right.target;
    if (left.metric === right.metric) {
      return left.target - right.target;
    }
    return rightProgress - leftProgress;
  })[0] ?? null;
}
