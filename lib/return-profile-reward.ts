export const RETURN_PROFILE_CAMPAIGN = "return-profile-2026-10";
export type ReturnProfileReward = {
  campaignKey: typeof RETURN_PROFILE_CAMPAIGN;
  credits: 5;
  state: "eligible" | "ready" | "rewarded";
};
export function isReturnProfileReward(value: unknown): value is ReturnProfileReward {
  if (!value || typeof value !== "object") return false;
  const data = value as ReturnProfileReward;
  return data.campaignKey === RETURN_PROFILE_CAMPAIGN && data.credits === 5 &&
    ["eligible", "ready", "rewarded"].includes(data.state);
}
export function showReturnRewardOnPath(path: string) {
  return path === "/" || ["/community/dating", "/dating", "/mypage", "/onboarding/dating"]
    .some(prefix => path === prefix || path.startsWith(prefix + "/"));
}
