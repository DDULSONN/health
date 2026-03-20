import { kvGetString, kvSetString } from "@/lib/edge-kv";

export async function shouldRunAtMostEvery(key: string, intervalSec: number) {
  const safeInterval = Math.max(1, Math.floor(intervalSec));
  const existing = await kvGetString(key);
  if (existing) return false;
  await kvSetString(key, "1", safeInterval);
  return true;
}
