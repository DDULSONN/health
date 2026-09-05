export type ReviewLevel = "clear" | "low" | "medium" | "high";
export type ReviewResult = {
  suspicionLevel: ReviewLevel;
  flags: string[];
  summary: string;
  photoFlags: string[];
  textFlags: string[];
  raw: Record<string, unknown>;
};

export const REVIEW_RANK: Record<ReviewLevel, number> = { clear: 0, low: 1, medium: 2, high: 3 };

export function combineReview(rules: ReviewResult, ai: ReviewResult | null, incomplete: string[], metadata: Record<string, unknown>): ReviewResult {
  const base = ai && REVIEW_RANK[ai.suspicionLevel] > REVIEW_RANK[rules.suspicionLevel] ? ai : rules;
  const suspicionLevel = incomplete.length && REVIEW_RANK[base.suspicionLevel] < 2 ? "medium" : base.suspicionLevel;
  const unique = (values: string[]) => [...new Set(values)];
  return {
    suspicionLevel,
    flags: unique([...incomplete, ...rules.flags, ...(ai?.flags ?? [])]),
    photoFlags: unique([...rules.photoFlags, ...(ai?.photoFlags ?? [])]),
    textFlags: unique([...rules.textFlags, ...(ai?.textFlags ?? [])]),
    summary: incomplete.length ? `검수 미완료: ${incomplete.join(" / ")}. ${base.summary}` : base.summary,
    raw: { ...metadata, incomplete, rulesFlags: rules.flags, result: ai?.raw ?? null },
  };
}
