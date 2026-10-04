// Optional client-side measurement only. Never used for eligibility, rewards or billing.
// Fixed campaign codes avoid copying arbitrary URL parameters or personal data to events.
export const GROWTH_CAMPAIGNS = {
  ig_reel_a: { source: "instagram", medium: "organic_social" },
  ig_reel_b: { source: "instagram", medium: "organic_social" },
  ig_reel_c: { source: "instagram", medium: "organic_social" },
  ig_creator_01: { source: "instagram", medium: "creator" },
  ig_creator_02: { source: "instagram", medium: "creator" },
  ig_creator_03: { source: "instagram", medium: "creator" },
  naver_guide: { source: "naver", medium: "organic_content" },
  friend_invite: { source: "referral", medium: "share" },
} as const;
type Campaign = keyof typeof GROWTH_CAMPAIGNS;
type Method = "email" | "google" | "apple";
type ProfileKind = "open_card" | "one_on_one";
type GrowthUser = { id: string; created_at?: string; email_confirmed_at?: string | null; confirmed_at?: string | null };
export type InvitePlacement = "mypage" | "profile_complete" | "credits_empty";
const PREFIX = "gymtools:growth:v1:";
export const GROWTH_CHANGED = "gymtools:growth-changed";
const DAY = 86400000;
const memory = new Map<string, unknown>();
let currentUser: GrowthUser | null = null;

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw) return JSON.parse(raw);
  } catch { /* Storage denial cannot affect signup/profile submission. */ }
  return memory.get(key) ?? null;
}
function write(key: string, value: unknown) {
  memory.set(key, value);
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* memory-only fallback */ }
}
function remove(key: string) {
  memory.delete(key);
  try { localStorage.removeItem(PREFIX + key); } catch { /* memory-only fallback */ }
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function fresh(value: unknown, age: number, now = Date.now()): value is number {
  return typeof value === "number" && Number.isFinite(value) && value <= now && now - value < age;
}
function campaign(value: unknown): Campaign | null {
  return typeof value === "string" && Object.hasOwn(GROWTH_CAMPAIGNS, value) ? value as Campaign : null;
}
export function captureGrowthCampaign(search: string, now = Date.now()) {
  try {
    const params = new URLSearchParams(search);
    const code = campaign(params.get("utm_campaign"));
    if (!code) return;
    const entry = GROWTH_CAMPAIGNS[code];
    if (params.get("utm_source") !== entry.source || params.get("utm_medium") !== entry.medium) return;
    const existing = record(read("campaign"));
    // Last tagged external entry, 30 days. A plain return visit does not reset it.
    if (existing.code !== code || !fresh(existing.at, 30 * DAY, now)) write("campaign", { code, at: now });
  } catch { /* diagnostic only */ }
}
function attribution() {
  const stored = record(read("campaign"));
  const code = campaign(stored.code);
  if (!code || !fresh(stored.at, 30 * DAY)) return { growth_campaign: "unattributed" };
  return { growth_campaign: code, growth_source: GROWTH_CAMPAIGNS[code].source, growth_medium: GROWTH_CAMPAIGNS[code].medium };
}
function send(name: string, fields: Record<string, string>) {
  try {
    if (typeof window === "undefined") return false;
    const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
    if (typeof gtag !== "function") return false;
    gtag("event", name, { ...attribution(), ...fields,
      // Never transmit auth callback tokens, email query strings, user/card IDs or form contents.
      page_location: window.location.origin + "/", page_referrer: "", page_title: "짐툴",
    });
    return true;
  } catch { return false; }
}
function once(key: string, name: string, fields: Record<string, string>) {
  const history = record(read("events"));
  if (fresh(history[key], 30 * DAY)) return;
  if (!send(name, fields)) return;
  const entries = Object.entries(history).filter(([, at]) => fresh(at, 30 * DAY)).slice(-127);
  write("events", { ...Object.fromEntries(entries), [key]: Date.now() });
}
export function beginGrowthSignup(method: Method) {
  try {
    captureGrowthCampaign(window.location.search);
    write("signup", { method, at: Date.now(), userId: null });
    send("signup_started", { method });
  } catch { /* never block authentication */ }
}
export function cancelGrowthSignup() { remove("signup"); }
export function recordGrowthEmailSignup(user: GrowthUser | null | undefined) {
  try {
    if (!user?.id) return;
    const pending = record(read("signup"));
    if (pending.method !== "email" || !fresh(pending.at, DAY) || !fresh(Date.parse(user.created_at ?? ""), DAY) || Date.parse(user.created_at ?? "") < Number(pending.at)) return;
    write("signup", { method: "email", at: Date.now(), userId: user.id });
    once("requested:" + user.id, "signup_requested", { method: "email" });
    confirmGrowthSignup(user);
  } catch { /* never block registration */ }
}
export function confirmGrowthSignup(user: GrowthUser) {
  try {
    const pending = record(read("signup"));
    if (!fresh(pending.at, DAY) || !["email", "google", "apple"].includes(String(pending.method))) return;
    if (pending.userId ? pending.userId !== user.id : !fresh(Date.parse(user.created_at ?? ""), DAY) || Date.parse(user.created_at ?? "") < Number(pending.at)) {
      remove("signup"); // Existing social-login account is NOT a new signup.
      return;
    }
    if (!user.email_confirmed_at && !user.confirmed_at) return;
    once("signup:" + user.id, "sign_up", { method: String(pending.method) });
    // Keep the marker briefly if analytics isn't ready; de-duplication handles refreshes.
  } catch { /* never block login */ }
}
export function setGrowthUser(user: GrowthUser | null) {
  currentUser = user;
  if (user) confirmGrowthSignup(user);
}
export function recordGrowthProfileCreated(kind: ProfileKind, userId = currentUser?.id) {
  try {
    if (!userId || (currentUser && currentUser.id !== userId) || !["open_card", "one_on_one"].includes(kind)) return;
    once(`profile:${userId}:${kind}`, "profile_created", { profile_kind: kind });
    // UI state only, account-scoped and short lived; no photos/text/contacts stored.
    write("invite", { userId, at: Date.now() });
    window.dispatchEvent(new Event(GROWTH_CHANGED));
  } catch { /* a successful registration must remain successful */ }
}
export function shouldShowCompletionInvite(userId: string | null) {
  const invite = record(read("invite"));
  return Boolean(userId && invite.userId === userId && fresh(invite.at, DAY));
}
export function dismissCompletionInvite() {
  remove("invite");
  try { window.dispatchEvent(new Event(GROWTH_CHANGED)); } catch { /* optional UI */ }
}
export function trackInviteAction(placement: InvitePlacement, action: "open" | "copy" | "share") {
  send("friend_invite_" + action, { placement });
}
