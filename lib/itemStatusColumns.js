// Shared select-with-fallback for item_status's v1.7 self-assessment
// columns (self_assessment, self_assessment_note).
//
// Vercel ships code and Supabase migrations independently — the same
// concern api/items/index.js already handles for the internal dashboard
// API. This is the shared version for /api/v1/items* so the external API
// degrades gracefully (self-assessment fields simply come back null)
// instead of hard-failing every request if it's ever live before the
// v1.7 SQL has run.
export const ITEM_STATUS_COLS = "status, owner, note, clickup_url, workflow_state, updated_at";
export const ITEM_STATUS_COLS_V17 = `${ITEM_STATUS_COLS}, self_assessment, self_assessment_note`;
const UNDEFINED_COLUMN = "42703";

// Calls `buildQuery(cols)` — which must construct and return the full
// Supabase query (filters included) using the given item_status column
// list — with the v1.7 columns first. If those columns don't exist yet,
// retries once with the pre-v1.7 set instead of failing the request.
export async function queryWithItemStatusFallback(buildQuery) {
  let { data, error } = await buildQuery(ITEM_STATUS_COLS_V17);
  if (error?.code === UNDEFINED_COLUMN) {
    ({ data, error } = await buildQuery(ITEM_STATUS_COLS));
  }
  return { data, error };
}
