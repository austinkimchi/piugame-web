import manifest from "../../public/assets/piu/ui/manifest.json";

export type PiuAssetVersion = "phoenix" | "phoenix2" | "shared";
export type PiuGrade = "SSS+" | "SSS" | "SS+" | "SS" | "S+" | "S" | "AAA+" | "AAA" | "AA+" | "AA" | "A+" | "A" | "B" | "C" | "D" | "F";
export type PiuPlateCode = "pg" | "ug" | "eg" | "sg" | "mg" | "tg" | "fg" | "rg";
export type PiuStepballMode = "S" | "D" | "CO-OP";
export type PiuUiAsset = (typeof manifest.assets)[number] & { url: string };

export const PIU_UI_ASSET_BASE = "/assets/piu/ui";
export const PIU_UI_ASSETS: readonly PiuUiAsset[] = manifest.assets.map((asset) => ({
  ...asset,
  url: `${PIU_UI_ASSET_BASE}/${asset.path.split("/").map(encodeURIComponent).join("/")}`,
}));
const assetsById = new Map(PIU_UI_ASSETS.map((asset) => [asset.id, asset]));

/** Return only a verified local asset; unknown identifiers never invent a URL. */
export function getPiuUiAsset(id: string): PiuUiAsset | null {
  return assetsById.get(id) ?? null;
}

/** Failed grades are separate official x_* artwork, not a CSS treatment. */
export function getPiuGradeAsset(
  grade: PiuGrade,
  options: { version?: "phoenix" | "phoenix2"; failed?: boolean } = {},
): PiuUiAsset | null {
  const version = options.version ?? "phoenix2";
  const code = grade.toLowerCase().replace("+", "_p");
  const category = options.failed ? "grades/failed" : "grades";
  return getPiuUiAsset(`${version}:${category}:${options.failed ? "x_" : ""}${code}`);
}

export function getPiuPlateAsset(
  plate: PiuPlateCode,
  options: { version?: "phoenix" | "phoenix2"; size?: "small" | "full" } = {},
): PiuUiAsset | null {
  const size = options.size ?? "full";
  return getPiuUiAsset(`${options.version ?? "phoenix2"}:plates/${size}:${size === "small" ? "s_" : ""}${plate}`);
}

/**
 * PHOENIX 2 uses the shared s_num_* set for Singles, Doubles and Co-op.
 * d_num_* counterparts are absent on the official server. Keep digits as
 * separate transparent sprites for composition; this helper does no resizing.
 */
export function getPhoenix2StepballAssets(mode: PiuStepballMode, value: number): {
  background: PiuUiAsset;
  label: PiuUiAsset;
  icon: PiuUiAsset | null;
  digits: PiuUiAsset[];
} | null {
  if (!Number.isInteger(value) || value < 0 || value > 99) return null;
  if (mode === "CO-OP" && (value < 2 || value > 5)) return null;
  const prefix = mode === "S" ? "s" : mode === "D" ? "d" : "c";
  const get = (name: string) => getPiuUiAsset(`phoenix2:stepballs/full:${name}`);
  const background = get(`${prefix}_bg`);
  const label = get(`${prefix}_text`);
  const digits = (mode === "CO-OP" ? String(value) : String(value).padStart(2, "0"))
    .split("").map((digit) => get(`s_num_${digit}`));
  if (!background || !label || digits.some((digit) => digit === null)) return null;
  return { background, label, icon: mode === "CO-OP" ? get("c_icon") : null, digits: digits as PiuUiAsset[] };
}
