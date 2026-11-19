import type { TitleEntry, TitleRequirementMetric } from "@austinkimchi/piugame-sdk";

export interface NextTitleObjective {
  name: string;
  metric: TitleRequirementMetric;
  current: number;
  previousTarget: number;
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
    .map((title) => {
      const metric = title.requirement.metric;
      const target = title.requirement.target;
      const previousTarget = titles.reduce((highest, possiblePrevious) => {
        const requirement = possiblePrevious.requirement;
        const isCurrentTitle = possiblePrevious.name.trim().toLocaleLowerCase()
          === currentTitleName?.trim().toLocaleLowerCase();
        if (
          requirement === null
          || requirement.metric !== metric
          || requirement.target >= target
          || (!possiblePrevious.owned && !isCurrentTitle)
        ) {
          return highest;
        }
        return Math.max(highest, requirement.target);
      }, 0);

      return {
        name: title.name,
        metric,
        current: title.requirement.current!,
        previousTarget,
        target,
      };
    })
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
    const leftProgress = objectiveProgress(left);
    const rightProgress = objectiveProgress(right);
    if (left.metric === right.metric) {
      return left.target - right.target;
    }
    return rightProgress - leftProgress;
  })[0] ?? null;
}

function objectiveProgress(objective: NextTitleObjective): number {
  const interval = objective.target - objective.previousTarget;
  if (interval <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, (objective.current - objective.previousTarget) / interval));
}
