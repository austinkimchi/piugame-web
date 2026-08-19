export interface CommunityScoreLinkDraft {
  performancePlayId: string;
  piuVersion: "phoenix" | "phoenix2";
  score: number | null;
  grade: string | null;
  plate: string | null;
  stageBreak: boolean;
  judgments: { perfect: number | null; great: number | null; good: number | null; bad: number | null; miss: number | null } | null;
}
