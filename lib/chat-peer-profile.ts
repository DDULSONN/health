export type ChatPeerProfile = {
  name: string; age: number | null; region: string | null; height_cm: number | null;
  job: string | null; training_years: number | null; intro_text: string | null;
  strengths_text: string | null; ideal_type: string | null; photo_urls: string[];
};

export function isChatPeerProfile(value: unknown): value is ChatPeerProfile {
  if (!value || typeof value !== "object") return false;
  const row = value as ChatPeerProfile;
  return typeof row.name === "string" &&
    [row.region, row.job, row.intro_text, row.strengths_text, row.ideal_type].every(v => v === null || typeof v === "string") &&
    [row.age, row.height_cm, row.training_years].every(v => v === null || (typeof v === "number" && Number.isFinite(v))) &&
    Array.isArray(row.photo_urls) && row.photo_urls.length <= 2 && row.photo_urls.every(v => typeof v === "string" && v.startsWith("/i/signed/"));
}
