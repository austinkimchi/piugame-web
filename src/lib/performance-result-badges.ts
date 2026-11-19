/** Compact allowlist for the result artwork verified in public/assets/piu/ui/manifest.json.
 * Keep the full provenance inventory out of the client component graph.
 */
const GRADE_CODES = new Set(["sss_p", "sss", "ss_p", "ss", "s_p", "s", "aaa_p", "aaa", "aa_p", "aa", "a_p", "a", "b", "c", "d", "f"]);
const PLATE_CODES = new Set(["pg", "ug", "eg", "sg", "mg", "tg", "fg", "rg"]);

type ResultVersion = "phoenix" | "phoenix2";
export interface PerformanceResultBadge {
  text: string;
  label: string;
  image: { src: string; width: number; height: number } | null;
}

export function performanceResultBadges({ grade, plate, version, stageBreak = false }: {
  grade: string | null | undefined;
  plate: string | null | undefined;
  version: ResultVersion;
  stageBreak?: boolean;
}): { grade: PerformanceResultBadge | null; plate: PerformanceResultBadge | null } {
  if (stageBreak) return { grade: null, plate: null };
  const rawGrade = String(grade ?? "").trim().toLowerCase();
  const failed = rawGrade.startsWith("x_");
  const gradeCode = rawGrade.replace(/^x_/, "").replace(/\+$/, "_p");
  const gradeText = gradeCode.replace(/_p$/, "+").replace(/_/g, " ").toUpperCase() || "Played";
  const gradeKnown = GRADE_CODES.has(gradeCode);
  // Narrow the runtime input too: an unknown version must never invent a path.
  const knownVersion = version === "phoenix" || version === "phoenix2";
  const gradeWidth = version === "phoenix2" ? 300 : !failed && ["aaa_p", "sss_p"].includes(gradeCode) ? 289 : !failed && gradeCode === "aaa" ? 264 : 199;
  const rawPlate = String(plate ?? "").trim().toLowerCase();
  const plateCode = rawPlate.replace(/^s_/, "");
  const plateText = plateCode.toUpperCase();
  const base = `/assets/piu/ui/${version}`;
  return {
    grade: {
      text: gradeText,
      label: rawGrade ? `${failed ? "Failed grade" : "Grade"} ${gradeText}` : "Played; grade unavailable",
      image: knownVersion && gradeKnown ? {
        src: `${base}/grades/${failed ? "failed/x_" : ""}${gradeCode}.png`,
        width: gradeWidth,
        height: version === "phoenix2" ? 178 : 130,
      } : null,
    },
    plate: rawPlate ? {
      text: plateText,
      label: `Plate ${plateText}`,
      image: knownVersion && PLATE_CODES.has(plateCode) ? {
        src: `${base}/plates/full/${plateCode}.png`,
        width: version === "phoenix2" ? 240 : 291,
        height: version === "phoenix2" ? 72 : 66,
      } : null,
    } : null,
  };
}
