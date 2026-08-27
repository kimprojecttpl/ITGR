// GET /api/v1/summary — the numbers that back the Overview tab, in one
// call, so a caller never has to fetch all 96 items just to get a
// percentage. See PRD §5 R5. Read-only; scope: summary:read.
//
// progressPct/gradeFor here MUST match index.html's identically-named
// logic: Compliant counts full credit, Partial counts half, everything
// else (including Not Compliant) counts zero. If this ever disagrees with
// the dashboard's own Overview tab, that is a bug in this file, not a
// difference in "how you could reasonably compute it."
import { getSupabase } from "../../lib/supabase.js";
import { requireApiToken, apiError, logApiRequest } from "../../lib/apiAuth.js";
import { STATUSES, RISK_LEVELS, gradeFor } from "../../lib/checklistEnums.js";
import { WORKFLOW_STATES } from "../../lib/workflow.js";

function progressPct(items) {
  if (!items.length) return 0;
  let done = 0;
  for (const it of items) {
    if (it.status === "Compliant") done += 1;
    else if (it.status === "Partial") done += 0.5;
  }
  return Math.round((done / items.length) * 100);
}

function countBy(items, field, values) {
  const counts = Object.fromEntries(values.map((v) => [v, 0]));
  for (const it of items) {
    if (it[field] in counts) counts[it[field]] += 1;
  }
  return counts;
}

export default async function handler(req, res) {
  const startedAt = Date.now();
  if (req.method !== "GET") {
    apiError(res, 405, "method_not_allowed", "Method not allowed");
    return;
  }
  const token = await requireApiToken(req, res, ["summary:read"], startedAt);
  if (!token) return;

  try {
    let catFilter;
    if (req.query.cat !== undefined) {
      catFilter = Number(req.query.cat);
      if (!Number.isInteger(catFilter) || catFilter < 1 || catFilter > 8) {
        apiError(res, 400, "invalid_filter", `"cat=${req.query.cat}" is not a valid category number.`, {
          param: "cat",
          allowed_values: [1, 2, 3, 4, 5, 6, 7, 8],
        });
        return;
      }
    }

    const supabase = getSupabase();
    const { data: rows, error } = await supabase
      .from("checklist_items")
      .select("no, cat_no, category, category_th, cat_short, cat_short_th, risk, priority, item_status(status, workflow_state)");
    if (error) {
      apiError(res, 500, "internal_error", "Failed to load items");
      return;
    }

    const all = rows.map((r) => {
      const st = Array.isArray(r.item_status) ? r.item_status[0] : r.item_status;
      return {
        no: r.no,
        cat_no: r.cat_no,
        category_th: r.category_th || r.category,
        category_en: r.category,
        cat_short_th: r.cat_short_th || r.cat_short,
        cat_short_en: r.cat_short,
        risk: r.risk || "",
        priority: r.priority || "",
        status: st?.status ?? "Not Started",
        workflow_state: st?.workflow_state ?? "Not Started",
      };
    });

    const scoped = catFilter !== undefined ? all.filter((it) => it.cat_no === catFilter) : all;
    const overallPct = progressPct(scoped);

    const byCategory = [];
    if (catFilter === undefined) {
      const catNos = [...new Set(all.map((it) => it.cat_no))].sort((a, b) => a - b);
      for (const no of catNos) {
        const items = all.filter((it) => it.cat_no === no);
        const pct = progressPct(items);
        byCategory.push({
          no,
          name_th: items[0].category_th,
          name_en: items[0].category_en,
          short_th: items[0].cat_short_th,
          short_en: items[0].cat_short_en,
          item_count: items.length,
          progress_pct: pct,
          grade: gradeFor(pct),
        });
      }
    }

    const veryHighRiskNotStarted = scoped.filter((it) => it.risk === "Very High" && it.status === "Not Started").length;

    res.status(200).json({
      overall: {
        progress_pct: overallPct,
        grade: gradeFor(overallPct),
        item_count: scoped.length,
      },
      by_category: byCategory,
      by_status: countBy(scoped, "status", STATUSES),
      by_risk: countBy(scoped, "risk", RISK_LEVELS),
      by_workflow_state: countBy(scoped, "workflow_state", WORKFLOW_STATES),
      very_high_risk_not_started: veryHighRiskNotStarted,
    });
  } finally {
    await logApiRequest(req, token.id, res.statusCode, startedAt);
  }
}
