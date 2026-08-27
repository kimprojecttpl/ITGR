// GET /api/v1/meta — machine-readable description of everything a caller
// needs to construct a request on its own: enums, filters, and worked
// examples pairing a plain-language question with the request that answers
// it. This is what lets an external LLM (n8n, a GPT, Claude) turn "หมวดไหน
// ยังแดงอยู่บ้าง" into a correct query without ITGR running any NL model of
// its own — see docs/PRD-external-api.md §5 R3.
//
// No scope required beyond a valid token — this is discovery, not data.
import { getSupabase } from "../../lib/supabase.js";
import { requireApiToken, apiError, logApiRequest } from "../../lib/apiAuth.js";
import { STATUSES, RISK_LEVELS, PRIORITY_MARKS, QUESTION_TYPES, GRADE_THRESHOLDS } from "../../lib/checklistEnums.js";
import { WORKFLOW_STATES } from "../../lib/workflow.js";
import { API_SCOPES } from "../../lib/apiToken.js";
import { SUPPORTED_LANGS } from "../../lib/apiLocalize.js";

const PRIORITY_LABELS = { "◎": "Top Priority", "〇": "Priority", "": "Standard" };

export default async function handler(req, res) {
  const startedAt = Date.now();
  if (req.method !== "GET") {
    apiError(res, 405, "method_not_allowed", "Method not allowed");
    return;
  }
  const token = await requireApiToken(req, res, [], startedAt);
  if (!token) return;

  try {
    const supabase = getSupabase();
    const { data: rows, error } = await supabase
      .from("checklist_items")
      .select("cat_no, category, category_th, cat_short, cat_short_th")
      .order("cat_no", { ascending: true });
    if (error) {
      apiError(res, 500, "internal_error", "Failed to load categories");
      return;
    }

    const seen = new Set();
    const categories = [];
    for (const r of rows) {
      if (seen.has(r.cat_no)) continue;
      seen.add(r.cat_no);
      categories.push({
        no: r.cat_no,
        name_th: r.category_th || r.category,
        name_en: r.category,
        short_th: r.cat_short_th || r.cat_short,
        short_en: r.cat_short,
      });
    }

    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(200).json({
      version: "1.0",
      languages: SUPPORTED_LANGS,
      scopes: API_SCOPES,
      categories,
      statuses: STATUSES,
      workflow_states: WORKFLOW_STATES,
      risk_levels: RISK_LEVELS,
      priority_marks: PRIORITY_MARKS.map((mark) => ({ mark, label: PRIORITY_LABELS[mark] })),
      question_types: QUESTION_TYPES,
      grade_thresholds: GRADE_THRESHOLDS,
      filters: {
        cat: { type: "integer", values: categories.map((c) => c.no), description: "หมวดข้อกำหนด 1-8 / requirement category 1-8" },
        risk: { type: "enum", values: RISK_LEVELS },
        priority: { type: "enum", values: PRIORITY_MARKS },
        status: { type: "enum", values: STATUSES },
        workflow_state: { type: "enum", values: WORKFLOW_STATES },
        owner: { type: "string", description: "partial match, case-insensitive" },
        article: { type: "string", description: "partial match on the ITGR article/paragraph reference" },
        q: { type: "string", description: "full-text search across name/content/standard/evidence in both languages" },
        updated_since: { type: "ISO 8601 datetime", description: "only items whose tracker status changed at/after this time" },
        lang: { type: "enum", values: SUPPORTED_LANGS, default: "th" },
        limit: { type: "integer", default: 25, max: 100 },
        offset: { type: "integer", default: 0 },
      },
      endpoints: {
        items: { method: "GET", path: "/api/v1/items", scope: "items:read" },
        item: { method: "GET", path: "/api/v1/items/{no}", scope: "items:read" },
        item_history: { method: "GET", path: "/api/v1/items/{no}/history", scope: "items:read + history:read" },
        summary: { method: "GET", path: "/api/v1/summary", scope: "summary:read" },
      },
      example_questions: [
        { question_th: "หมวดไหนยังแดงอยู่บ้าง", question_en: "Which categories are still red?", request: "GET /api/v1/items?risk=Very High&status=Not Started" },
        { question_th: "มีกี่ข้อที่รอผมอนุมัติ", question_en: "How many items are waiting on my approval?", request: "GET /api/v1/items?workflow_state=Pending Approval" },
        { question_th: "ข้อที่ความเสี่ยงสูงมากยังไม่เริ่มมีอะไรบ้าง", question_en: "Which Very High risk items haven't started?", request: "GET /api/v1/items?risk=Very High&status=Not Started" },
        { question_th: "ความคืบหน้ารวมตอนนี้เท่าไหร่", question_en: "What's the overall progress right now?", request: "GET /api/v1/summary" },
        { question_th: "หมวดการจัดการบัญชีผู้ใช้คืบหน้าไปเท่าไหร่", question_en: "How far along is Account Management?", request: "GET /api/v1/summary?cat=2" },
        { question_th: "ใครรับผิดชอบข้อ 15", question_en: "Who owns item 15?", request: "GET /api/v1/items/15" },
        { question_th: "ข้อ 15 มีความเป็นมายังไงบ้าง", question_en: "What's the history on item 15?", request: "GET /api/v1/items/15/history (needs history:read)" },
        { question_th: "ค้นหาข้อที่พูดถึง MFA", question_en: "Search for items mentioning MFA", request: "GET /api/v1/items?q=multi-factor" },
      ],
    });
  } finally {
    await logApiRequest(req, token.id, res.statusCode, startedAt);
  }
}
