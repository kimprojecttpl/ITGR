// Language selection for the external API — mirrors index.html's fieldOf()
// fallback rule exactly: a blank `*_th` value falls back to the English
// column, so a partial translation never produces an empty field for a
// caller that asked for Thai.
export const SUPPORTED_LANGS = ["th", "en"];

export function pick(row, field, lang) {
  if (lang === "th") {
    const th = row[`${field}_th`];
    if (th) return th;
  }
  return row[field] || "";
}

// Shapes one checklist_items (+ item_status) row into the public API
// representation — the single place that decides what an external caller
// can see. No file paths, no user records, no internal ids beyond `no`.
export function localizeItem(row, lang) {
  return {
    no: row.no,
    category: {
      no: row.cat_no,
      name: lang === "th" ? row.category_th || row.category : row.category,
      short: lang === "th" ? row.cat_short_th || row.cat_short : row.cat_short,
    },
    name: pick(row, "name", lang),
    content: pick(row, "content", lang),
    standard: pick(row, "standard", lang),
    evidence: pick(row, "evidence", lang),
    article: row.article || "",
    risk: row.risk || "",
    priority: row.priority || "",
    qtype: pick(row, "qtype", lang),
    status: row.status,
    workflow_state: row.workflow_state,
    owner: row.owner || "",
    note: row.note || "",
    clickup_url: row.clickup_url || "",
    updated_at: row.updated_at || null,
  };
}
