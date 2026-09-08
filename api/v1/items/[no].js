// GET /api/v1/items/{no} — single checklist item. See PRD §5 R6.
// Read-only; scope: items:read.
import { getSupabase } from "../../../lib/supabase.js";
import { requireApiToken, respond, respondError, methodNotAllowed } from "../../../lib/apiAuth.js";
import { SUPPORTED_LANGS, localizeItem } from "../../../lib/apiLocalize.js";
import { queryWithItemStatusFallback } from "../../../lib/itemStatusColumns.js";

export default async function handler(req, res) {
  const startedAt = Date.now();
  if (req.method !== "GET") {
    methodNotAllowed(res);
    return;
  }
  const token = await requireApiToken(req, res, ["items:read"], startedAt);
  if (!token) return;

  const itemNo = Number(req.query.no);
  if (!Number.isInteger(itemNo)) {
    await respondError(req, res, token.id, startedAt, 400, "invalid_item_no", "Item number must be an integer.");
    return;
  }
  const lang = req.query.lang ? String(req.query.lang) : "th";
  if (!SUPPORTED_LANGS.includes(lang)) {
    await respondError(req, res, token.id, startedAt, 400, "invalid_filter", `"lang=${lang}" is not a valid value for lang.`, {
      param: "lang",
      allowed_values: SUPPORTED_LANGS,
    });
    return;
  }

  const supabase = getSupabase();
  const { data: row, error } = await queryWithItemStatusFallback((cols) =>
    supabase
      .from("checklist_items")
      .select(`*, item_status(${cols})`)
      .eq("no", itemNo)
      .maybeSingle()
  );
  if (error) {
    await respondError(req, res, token.id, startedAt, 500, "internal_error", "Failed to load item");
    return;
  }
  if (!row) {
    await respondError(req, res, token.id, startedAt, 404, "item_not_found", `No checklist item numbered ${itemNo}.`);
    return;
  }

  const status = Array.isArray(row.item_status) ? row.item_status[0] : row.item_status;
  await respond(
    req, res, token.id, startedAt, 200,
    localizeItem(
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
    )
  );
}
