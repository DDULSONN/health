export const REACTION_KINDS = ["reaction", "promotion", "reference", "uncertain"] as const;
export const REACTION_SENTIMENTS = ["positive", "negative", "mixed", "neutral", "unknown"] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];
export type ReactionSentiment = (typeof REACTION_SENTIMENTS)[number];
export type PublicReaction = {
  url: string;
  title: string;
  summary: string;
  kind: ReactionKind;
  sentiment: ReactionSentiment;
  published_date: string | null;
};
export type PublicReactionReport = {
  items: PublicReaction[];
  source_count: number;
  excluded_count: number;
  searched_at: string;
};
export type PublicReactionRun = {
  run_date: string;
  status: "running" | "success" | "failed";
  attempt: number;
  started_at: string;
  completed_at: string | null;
  error_code: string | null;
};

export const REACTION_KIND_LABELS: Record<ReactionKind, string> = {
  reaction: "이용자 반응", promotion: "홍보·소개", reference: "단순 언급", uncertain: "확인 필요",
};
export const REACTION_SENTIMENT_LABELS: Record<ReactionSentiment, string> = {
  positive: "긍정", negative: "불만", mixed: "긍정·불만 혼재", neutral: "중립", unknown: "판단 보류",
};
export const REACTION_ERRORS: Record<string, string> = {
  NOT_CONFIGURED: "자동 검색 설정이 필요합니다. 검색 API 키, 활성화 설정, 예약 실행 키를 확인해 주세요.",
  STORAGE_MISSING: "외부 반응 저장용 SQL을 먼저 적용해 주세요.",
  PROVIDER_AUTH: "검색 API 키 또는 API 사용 권한을 확인해 주세요.",
  PROVIDER_LIMIT: "검색 API의 잔액이나 호출 한도를 확인해 주세요.",
  PROVIDER_FAILED: "검색 서비스에 연결하지 못했습니다. 이전 결과는 유지됩니다.",
  INVALID_RESULT: "검색 결과를 안전하게 확인하지 못했습니다. 이전 결과는 유지됩니다.",
  TIMEOUT: "검색 시간이 초과되었습니다. 이전 결과는 유지됩니다.",
  STORAGE_FAILED: "검색 결과 저장에 실패했습니다. 이전 결과는 유지됩니다.",
};

export function koreanDate(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function canStartReactionScan(run: PublicReactionRun | null, now = new Date()) {
  if (!run || run.run_date !== koreanDate(now)) return true;
  if (run.status === "success" || run.attempt >= 2) return false;
  return now.getTime() - Date.parse(run.started_at) >= 10 * 60 * 1000;
}

export function reactionErrorMessage(code: string | null | undefined) {
  return REACTION_ERRORS[code ?? ""] ?? "외부 반응을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.";
}

// Display-only external links. Never fetch these URLs with application credentials.
export function normalizeReactionUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!host.includes(".") || /[\[\]:]/.test(host) || /^[\d.]+$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)) return null;
    url.hostname = host;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|fbclid|gclid|igshid|igsh|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch { return null; }
}

export function isExcludedReactionSource(url: string) {
  const host = new URL(url).hostname;
  return ["helchang.com", "scamadviser.com", "scam-detector.com", "robtex.com", "who.is", "urlscan.io"]
    .some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function plainText(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, max);
}

export function validateReactionItems(input: unknown, sourceUrls: Set<string>, now = new Date()) {
  if (!Array.isArray(input) || input.length > 30) throw new Error("INVALID_RESULT");
  const items: PublicReaction[] = [];
  const seen = new Set<string>();
  let excluded = 0;
  for (const raw of input) {
    if (!raw || typeof raw !== "object") throw new Error("INVALID_RESULT");
    const item = raw as Record<string, unknown>;
    const url = normalizeReactionUrl(item.url);
    if (!url || !sourceUrls.has(url) || isExcludedReactionSource(url) || seen.has(url)) { excluded++; continue; }
    const title = plainText(item.title, 160);
    const summary = plainText(item.summary, 260);
    if (!title || !summary || !REACTION_KINDS.includes(item.kind as ReactionKind) ||
      !REACTION_SENTIMENTS.includes(item.sentiment as ReactionSentiment)) throw new Error("INVALID_RESULT");
    const date = typeof item.published_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.published_date)
      && Number.isFinite(Date.parse(item.published_date))
      && new Date(item.published_date).toISOString().slice(0, 10) === item.published_date
      && item.published_date <= koreanDate(now) ? item.published_date : null;
    // Old-domain records are not evidence of reactions to the current service.
    const kind = date && date < "2026-01-01" ? "uncertain" : item.kind as ReactionKind;
    items.push({ url, title, summary, kind,
      sentiment: kind === "reaction" ? item.sentiment as ReactionSentiment : "unknown", published_date: date });
    seen.add(url);
  }
  // If every proposed item was invalid, do not publish a false "no reactions" report.
  if (input.length > 0 && items.length === 0) throw new Error("INVALID_RESULT");
  return { items, excluded };
}
