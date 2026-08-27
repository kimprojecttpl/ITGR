// GET /api/v1/items/{no} — single checklist item. See PRD §5 R6.
// Read-only; scope: items:read.
import { getSupabase } from "../../../lib/supabase.js";
import { requireApiToken, apiError, logApiRequest } from "../../../lib/apiAuth.js";
import { SUPPORTED_LANGS, localizeItem } from "../../../lib/apiLocalize.js";

export default async function handler(req, res) {
  const startedAt = Date.now();
  if (req.method !== "GET") {
    apiError(res, 405, "method_not_allowed", "Method not allowed");
    return;
  }
  const token = await requireApiToken(req, res, ["items:read"], startedAt);
  if (!token) return;

  try {
    const itemNo = Number(req.query.no);
    if (!Number.isInteger(itemNo)) {
      apiError(res, 400, "invalid_item_no", "Item number must be an integer.");
      return;
    }
    const lang = req.query.lang ? String(req.query.lang) : "th";
    if (!SUPPORTED_LANGS.includes(lang)) {
      apiError(res, 400, "invalid_filter", `"lang=${lang}" is not a valid value for lang.`, {
        param: "lang",
        allowed_values: SUPPORTED_LANGS,
      });
      return;
    }

    const supabase = getSupabase();
    const { data: row, error } = await supabase
      .from("checklist_items")
      .select("*, item_status(status, owner, note, clickup_url, workflow_state, updated_at)")
      .eq("no", itemNo)
      .maybeSingle();
    if (error) {
      apiError(res, 500, "internal_error", "Failed to load item");
      return;
    }
    if (!row) {
      apiError(res, 404, "item_not_found", `No checklist item numbered ${itemNo}.`);
      return;
    }

    const status = Array.isArray(row.item_status) ? row.item_status[0] : row.item_status;
    res.status(200).json(
      localizeItem(
        {
          ...row,
          status: status?.status ?? "Not Started",
          owner: status?.owner ?? "",
          note: status?.note ?? "",
          clickup_url: status?.clickup_url ?? "",
          workflow_state: status?.workflow_state ?? "Not Started",
          updated_at: status?.updated_at ?? null,
        },
        lang
      )
    );
  } finally {
    await logApiRequest(req, token.id, res.statusCode, startedAt);
  }
}
