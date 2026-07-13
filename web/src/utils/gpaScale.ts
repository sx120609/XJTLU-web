export interface FourPointGradeBand {
  min: number;
  label: string;
  letter: "A" | "A−" | "B+" | "B" | "C+" | "C" | "F";
  gpa: number;
}

export const FOUR_POINT_GRADE_SCALE: readonly FourPointGradeBand[] = [
  { min: 70, label: "70–100", letter: "A", gpa: 4.0 },
  { min: 65, label: "65–69.99", letter: "A−", gpa: 3.7 },
  { min: 60, label: "60–64.99", letter: "B+", gpa: 3.3 },
  { min: 50, label: "50–59.99", letter: "B", gpa: 3.0 },
  { min: 45, label: "45–49.99", letter: "C+", gpa: 2.3 },
  { min: 40, label: "40–44.99", letter: "C", gpa: 2.0 },
  { min: 0, label: "低于 40", letter: "F", gpa: 0 },
];

const QUALITATIVE_GPA: Readonly<Record<string, number>> = {
  优秀: 4.0,
  优: 4.0,
  良好: 3.7,
  良: 3.7,
  中等: 3.0,
  中: 3.0,
  及格: 2.0,
  合格: 2.0,
  通过: 2.0,
  不及格: 0,
  不合格: 0,
  不通过: 0,
  未通过: 0,
};

export function parseScoreValue(score: string | number | null | undefined) {
  const value = typeof score === "number" ? score : Number.parseFloat(String(score ?? "").trim());
  if (!Number.isFinite(value)) return undefined;
  return Math.min(100, Math.max(0, value));
}

export function scoreToFourPointGpa(score: string | number | null | undefined) {
  const normalized = String(score ?? "").replace(/\s+/g, "");
  if (Object.prototype.hasOwnProperty.call(QUALITATIVE_GPA, normalized)) return QUALITATIVE_GPA[normalized];
  const value = parseScoreValue(score);
  if (value === undefined) return undefined;
  return FOUR_POINT_GRADE_SCALE.find((item) => value >= item.min)!.gpa;
}

export function scoreColor(score: string | number | null | undefined) {
  const value = parseScoreValue(score);
  if (value === undefined) return "var(--cpu-text-muted)";
  if (value < 40) return "#d13438";
  if (value < 50) return "#e65f00";
  if (value < 60) return "#9c6f00";
  if (value < 70) return "#7c3aed";
  if (value < 80) return "#2456d3";
  if (value < 90) return "#007f8b";
  return "#16875b";
}

export function gpaColor(gpa: number | null | undefined) {
  if (typeof gpa !== "number" || !Number.isFinite(gpa)) return "var(--cpu-text-muted)";
  if (gpa >= 4.0) return "#16875b";
  if (gpa >= 3.7) return "#007f8b";
  if (gpa >= 3.3) return "#2456d3";
  if (gpa >= 3.0) return "#7c3aed";
  if (gpa >= 2.3) return "#9c6f00";
  if (gpa >= 2.0) return "#e65f00";
  return "#d13438";
}

export function calculateWeightedFourPointGpa(rows: ReadonlyArray<{
  score?: string | number | null;
  gpa?: number | null;
  credits?: string | number | null;
}>) {
  let weightedPoints = 0;
  let credits = 0;
  let courseCount = 0;
  for (const row of rows) {
    const credit = typeof row.credits === "number" ? row.credits : Number.parseFloat(String(row.credits ?? ""));
    const converted = scoreToFourPointGpa(row.score);
    const gpa = converted ?? (typeof row.gpa === "number" && Number.isFinite(row.gpa) ? row.gpa : undefined);
    if (!Number.isFinite(credit) || credit <= 0 || gpa === undefined) continue;
    weightedPoints += gpa * credit;
    credits += credit;
    courseCount += 1;
  }
  return {
    gpa: credits ? Math.round((weightedPoints / credits) * 100) / 100 : null,
    credits: Math.round(credits * 100) / 100,
    courseCount,
  };
}
