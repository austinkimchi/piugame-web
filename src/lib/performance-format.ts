export function formatPerformanceGrade(value: string | null | undefined): string {
  const cleaned = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^x_/, "");

  if (!cleaned) {
    return "Played";
  }

  const plus = cleaned.endsWith("_p");
  const base = plus ? cleaned.slice(0, -2) : cleaned;
  return gradeDisplayLabel(base, plus);
}

export function isFailedPerformanceGrade(value: string | null | undefined): boolean {
  return String(value ?? "").trim().toLowerCase().startsWith("x_");
}

export function piuTimestampToDate(value: string | null | undefined): Date | null {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }

  const piuMatch = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*\(GMT([+-])(\d{1,2})(?::?(\d{2}))?\)$/i.exec(text);
  if (piuMatch) {
    const [, year, month, day, hour, minute, second = "0", sign, offsetHour, offsetMinute = "0"] = piuMatch;
    const offsetMinutes = (Number(offsetHour) * 60 + Number(offsetMinute)) * (sign === "+" ? 1 : -1);
    const utcTime =
      Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) -
      offsetMinutes * 60 * 1000;
    const parsed = new Date(utcTime);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function gradeDisplayLabel(value: string, plus: boolean): string {
  return `${value.replace(/_/g, " ").toUpperCase()}${plus ? "+" : ""}`;
}
