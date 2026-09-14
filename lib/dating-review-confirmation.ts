import { createHash } from "node:crypto";

// Admin review snapshots only: never use these to change card visibility or matching.
type ReviewContent = {
  sourceType: string;
  cardId: string;
  userId: string | null;
  displayName: string;
  age: number | null;
  region: string | null;
  texts: Record<string, string>;
  photoPaths: string[];
  bucket: string;
  createdAt: string | null;
};
type ReviewFindings = {
  suspicionLevel: string;
  flags: string[];
  textFlags: string[];
  photoFlags: string[];
  raw: Record<string, unknown>;
};
export type ReviewSnapshot = { contentFingerprint: string; findingsFingerprint: string };
export type ReviewConfirmation = {
  id: string;
  source_type: string;
  card_id: string;
  content_fingerprint: string;
  findings_fingerprint: string;
  confirmed_at: string;
};

const AUTHOR_FIELDS = ["name", "job", "intro", "strengths", "ideal", "idealType", "preferredPartner", "instagramId", "height", "trainingYears", "sourceCardId"];
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function reviewContentFingerprint(card: ReviewContent) {
  return hash({
    schema: 1, source: card.sourceType, id: card.cardId, author: card.userId,
    name: card.displayName, age: card.age, region: card.region, created: card.createdAt,
    texts: AUTHOR_FIELDS.map((key) => [key, card.texts[key] ?? ""]),
    bucket: card.bucket, photos: card.photoPaths,
    // Do not hash signed URLs, publication status, scan times, locks or recipient metadata.
  });
}

export function reviewFindingsFingerprint(review: ReviewFindings, rulesVersion: string) {
  const stable = (values: string[]) => [...new Set(values)].sort();
  return hash({
    schema: 1, rulesVersion, mode: review.raw.provider === "gemini" ? "ai" : "rules",
    level: review.suspicionLevel, flags: stable(review.flags),
    text: stable(review.textFlags), photos: stable(review.photoFlags),
  });
}

export function readReviewSnapshot(raw: unknown): ReviewSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const value = (raw as Record<string, unknown>).confirmationSnapshot;
  if (!value || typeof value !== "object") return null;
  const { contentFingerprint, findingsFingerprint } = value as Record<string, unknown>;
  return typeof contentFingerprint === "string" && /^[a-f0-9]{64}$/.test(contentFingerprint)
    && typeof findingsFingerprint === "string" && /^[a-f0-9]{64}$/.test(findingsFingerprint)
    ? { contentFingerprint, findingsFingerprint } : null;
}

export function isReviewConfirmed(snapshot: ReviewSnapshot | null, confirmation?: ReviewConfirmation) {
  return Boolean(snapshot && confirmation
    && snapshot.contentFingerprint === confirmation.content_fingerprint
    && snapshot.findingsFingerprint === confirmation.findings_fingerprint);
}

export const reviewConfirmationKey = (source: string, id: string) => `${source}:${id}`;
