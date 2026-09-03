// Single source of truth for the checklist's fixed vocabularies — statuses,
// risk levels, question types, grading — shared by every server-side
// consumer (the /api/v1/* external API, and the existing /api/items/[no]
// PATCH validation).
//
// index.html duplicates these same literal arrays in its own inline
// <script> (it is not an ES module, so it cannot import this file) — that
// duplication predates this file and is a known gap, not something this
// file claims to fix. Anything server-side has no excuse to duplicate them
// a second time, though, which is what this file is for.

// "Not Applicable" is distinct from "Not Compliant": v1.3 merged the two, but
// the FY2026 workbook marks 8 requirements N/A and Marubeni's scoring drops
// them from the denominator instead of failing them, so v1.7 split them again.
export const STATUSES = [
  "Not Started", "In Progress", "Compliant", "Partial", "Not Compliant", "Not Applicable",
];

// Risk weights from the FY2026 workbook's "Assessment Calculation" sheet.
// Low-risk requirements carry zero weight on BOTH sides of the fraction, so
// implementing one cannot move the official score.
export const RISK_WEIGHT = { "Very High": 7, "High": 5, "Middle": 3, "Low": 0, "": 0 };

// Category letter -> points, for rolling the 8 category grades into one
// overall rating (mean of the eight, cut at 4.4 / 3.4 / 2.4 / 1.4).
export const GRADE_SCORE = { A: 5, B: 4, C: 3, D: 2, E: 0 };

export const RISK_LEVELS = ["Very High", "High", "Middle", "Low"];

export const PRIORITY_MARKS = ["◎", "〇", ""];

export const QUESTION_TYPES = [
  "① System-related",
  "②-1 Operations-related (significant)",
  "②-2 Operations-related (other)",
  "ー",
];

// Same thresholds as index.html's gradeFor() — kept here so server-side
// aggregates (e.g. /api/v1/summary) can never drift from what the
// dashboard shows.
export function gradeFor(pct) {
  if (pct >= 80) return "A";
  if (pct >= 60) return "B";
  if (pct >= 40) return "C";
  if (pct >= 20) return "D";
  return "E";
}

export const GRADE_THRESHOLDS = [
  { grade: "A", min_pct: 80 },
  { grade: "B", min_pct: 60 },
  { grade: "C", min_pct: 40 },
  { grade: "D", min_pct: 20 },
  { grade: "E", min_pct: 0 },
];
