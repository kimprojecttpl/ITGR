// v1.9 (proposed) — Box.com Remark Sync. No Box Custom App has been
// authorized yet (PRD.md § 13.6, § 9 — blocking open question), so there is
// no real Box connection to make. This file is the seam where the actual
// Box API calls land once that happens. Until then, every entry point fails
// loudly and explicitly rather than silently pretending to succeed.
export function isBoxConfigured() {
  return Boolean(
    process.env.BOX_CLIENT_ID && process.env.BOX_CLIENT_SECRET && process.env.BOX_ENTERPRISE_ID
  );
}

// Would push a `[ITGR] ...` comment to the item's configured Box folder
// (§ 13.6). Not implemented — there is nothing to call yet.
export async function pushStatusComment(/* boxUrl, text */) {
  throw new Error(
    "Box integration is not connected yet — BOX_CLIENT_ID/BOX_CLIENT_SECRET/BOX_ENTERPRISE_ID are not set. See PRD.md § 13.6."
  );
}
