// GET /api/v1/items — search and filter the 96 checklist items.
// See docs/PRD-external-api.md §5 R4. Read-only; scope: items:read.
import { getSupabase } from "../../../lib/supabase.js";
import { requireApiToken, respond, respondError, methodNotAllowed } from "../../../lib/apiAuth.js";
import { STATUSES, RISK_LEVELS, PRIORITY_MARKS, SELF_ASSESSMENT_MARKS } from "../../../lib/checklistEnums.js";
import { WORKFLOW_STATES } from "../../../lib/workflow.js";
import { SUPPORTED_LANGS, localizeItem } from "../../../lib/apiLocalize.js";
import { queryWithItemStatusFallback } from "../../../lib/itemStatusColumns.js";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

function enumError(param, value, allowed) {
  return {
    code: "invalid_filter",
    message: `"${param}=${value}" is not a valid value for ${param}.`,
    extra: { param, allowed_values: allowed },
  };
}

export default async function handler(req, res) {
  const startedAt = Date.now();
  if (req.method !== "GET") {
    methodNotAllowed(res);
    return;
  }
  const token = await requireApiToken(req, res, ["items:read"], startedAt);
  if (!token) return;

  // Validation is collected into a single `validationError`, checked once
  // at the end, so there is exactly one place that sends the 400 response
  // (and therefore exactly one place that has to remember to log it) no
  // matter which filter was the one that failed.
  const q = req.query || {};
  const lang = q.lang ? String(q.lang) : "th";
  let validationError = null;
  let catFilter, limit = DEFAULT_LIMIT, limitCapped = false, offset = 0, updatedSince;

  if (!SUPPORTED_LANGS.includes(lang)) {
    validationError = enumError("lang", lang, SUPPORTED_LANGS);
  } else if (q.risk && !RISK_LEVELS.includes(q.risk)) {
    validationError = enumError("risk", q.risk, RISK_LEVELS);
  } else if (q.priority && !PRIORITY_MARKS.includes(q.priority)) {
    validationError = enumError("priority", q.priority, PRIORITY_MARKS);
  } else if (q.status && !STATUSES.includes(q.status)) {
    validationError = enumError("status", q.status, STATUSES);
  } else if (q.workflow_state && !WORKFLOW_STATES.includes(q.workflow_state)) {
    validationError = enumError("workflow_state", q.workflow_state, WORKFLOW_STATES);
  } else if (q.self_assessment && !SELF_ASSESSMENT_MARKS.includes(q.self_assessment)) {
    validationError = enumError("self_assessment", q.self_assessment, SELF_ASSESSMENT_MARKS);
  } else if (q.cat !== undefined) {
    catFilter = Number(q.cat);
    if (!Number.isInteger(catFilter) || catFilter < 1 || catFilter > 8) {
      validationError = {
        code: "invalid_filter",
        message: `"cat=${q.cat}" is not a valid category number.`,
        extra: { param: "cat", allowed_values: [1, 2, 3, 4, 5, 6, 7, 8] },
      };
    }
  }

  if (!validationError && q.limit !== undefined) {
    const parsed = Number(q.limit);
    if (!Number.isInteger(parsed) || parsed < 1) {
      validationError = { code: "invalid_filter", message: `"limit=${q.limit}" must be a positive integer.`, extra: { param: "limit" } };
    } else {
      limit = parsed;
    }
  }
  if (limit > MAX_LIMIT) {
    limit = MAX_LIMIT;
    limitCapped = true;
  }

  if (!validationError && q.offset !== undefined) {
    const parsed = Number(q.offset);
    if (!Number.isInteger(parsed) || parsed < 0) {
      validationError = { code: "invalid_filter", message: `"offset=${q.offset}" must be a non-negative integer.`, extra: { param: "offset" } };
    } else {
      offset = parsed;
    }
  }

  if (!validationError && q.updated_since) {
    const parsed = new Date(q.updated_since);
    if (Number.isNaN(parsed.getTime())) {
      validationError = {
        code: "invalid_filter",
        message: `"updated_since=${q.updated_since}" is not a valid ISO 8601 datetime.`,
        extra: { param: "updated_since" },
      };
    } else {
      updatedSince = parsed.toISOString();
    }
  }

  if (validationError) {
    await respondError(req, res, token.id, startedAt, 400, validationError.code, validationError.message, validationError.extra);
    return;
  }

  const supabase = getSupabase();
  const { data: rows, error } = await queryWithItemStatusFallback((cols) => {
    let query = supabase
      .from("checklist_items")
      .select(`*, item_status(${cols})`)
      .order("no", { ascending: true });

    if (catFilter !== undefined) query = query.eq("cat_no", catFilter);
    if (q.risk) query = query.eq("risk", q.risk);
    if (q.priority !== undefined) query = query.eq("priority", q.priority);
    if (q.article) query = query.ilike("article", `%${q.article}%`);
    // Search spans both languages regardless of `lang` — the same rule the
    // dashboard's own search box uses, so an English query still finds an
    // item whose Thai translation is what's blank, and vice versa.
    if (q.q) {
      const term = String(q.q).replace(/[%_]/g, "\\$&");
      const searchCols = ["name", "content", "standard", "evidence", "name_th", "content_th", "standard_th", "evidence_th"];
      query = query.or(searchCols.map((c) => `${c}.ilike.%${term}%`).join(","));
    }
    return query;
  });
  if (error) {
    await respondError(req, res, token.id, startedAt, 500, "internal_error", "Failed to load items");
    return;
  }

  let items = rows.map((row) => {
    const status = Array.isArray(row.item_status) ? row.item_status[0] : row.item_status;
    return localizeItem(
      {
        ...row,
        status: status?.status ?? "Not Started",
        owner: status?.owner ?? "",
        note: status?.note ?? "",
        clickup_url: status?.clickup_url ?? "",
        workflow_state: status?.workflow_state ?? "Not Started",
        self_assessment: status?.self_assessment ?? null,
        self_assessment_note: status?.self_assessment_note ?? "",
        updated_at: status?.updated_at ?? null,
      },
      lang
    );
  });

  // status/workflow_state/self_assessment/owner/updated_since filter
  // post-fetch: they live on the joined item_status row, and Supabase's
  // embedded-resource filters can't combine cleanly with the OR() text
  // search above.
  if (q.status) items = items.filter((it) => it.status === q.status);
  if (q.workflow_state) items = items.filter((it) => it.workflow_state === q.workflow_state);
  if (q.self_assessment) items = items.filter((it) => it.self_assessment === q.self_assessment);
  if (q.owner) {
    const needle = String(q.owner).toLowerCase();
    items = items.filter((it) => it.owner.toLowerCase().includes(needle));
  }
  if (updatedSince) items = items.filter((it) => it.updated_at && it.updated_at >= updatedSince);

  const total = items.length;
  const page = items.slice(offset, offset + limit);

  const responseBody = {
    total,
    limit,
    offset,
    has_more: offset + page.length < total,
    items: page,
  };
  if (limitCapped) responseBody.limit_capped = true;

  await respond(req, res, token.id, startedAt, 200, responseBody);
}
