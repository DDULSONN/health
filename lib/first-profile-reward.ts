import { isReturnProfileReward, type ReturnProfileReward } from "@/lib/return-profile-reward";

export const FIRST_PROFILE_CAMPAIGN = "first-profile-2026-10";
export type FirstProfileReward = {
  campaignKey: typeof FIRST_PROFILE_CAMPAIGN;
  credits: 1;
  state: "eligible" | "ready" | "rewarded";
};
export type ProfileReward = ReturnProfileReward | FirstProfileReward;
export function isFirstProfileReward(value: unknown): value is FirstProfileReward {
  if (!value || typeof value !== "object") return false;
  const data = value as FirstProfileReward;
  return data.campaignKey === FIRST_PROFILE_CAMPAIGN && data.credits === 1 &&
    ["eligible", "ready", "rewarded"].includes(data.state);
}
export function isProfileReward(value: unknown): value is ProfileReward {
  return isReturnProfileReward(value) || isFirstProfileReward(value);
}
