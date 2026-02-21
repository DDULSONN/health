type MemoryValue = {
  value: string;
  expiresAtEpochMs: number;
};

type MemoryCounter = {
  count: number;
  resetAtEpochMs: number;
};

const memValues = new Map<string, MemoryValue>();
const memCounters = new Map<string, MemoryCounter>();
let warnedMemoryFallbackValue = false;
let warnedMemoryFallbackCounter = false;

function getUpstashConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return { url, token };
}

async function upstashCommand(command: string[]) {
  const cfg = getUpstashConfig();
  if (!cfg) return null;
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { result?: unknown } | null;
    return body?.result ?? null;
  } catch {
    return null;
  }
}

function warnMemoryFallback(kind: "values" | "counters") {
  if (kind === "values") {
    if (warnedMemoryFallbackValue) return;
    warnedMemoryFallbackValue = true;
  } else {
    if (warnedMemoryFallbackCounter) return;
    warnedMemoryFallbackCounter = true;
  }
  console.warn(
    `[edge-kv] provider=memory reason=missing_or_unavailable_upstash warning=serverless_restart_can_reduce_cache_hit_rate kind=${kind}`
  );
}

export async function kvGetString(key: string): Promise<string | null> {
  const remote = await upstashCommand(["GET", key]);
  if (typeof remote === "string") return remote;

  const now = Date.now();
  const local = memValues.get(key);
  if (!local) return null;
  if (local.expiresAtEpochMs <= now) {
    memValues.delete(key);
    return null;
  }
  return local.value;
}

export async function kvSetString(key: string, value: string, ttlSec: number): Promise<void> {
  const safeTtl = Math.max(1, Math.floor(ttlSec));
  const remote = await upstashCommand(["SET", key, value, "EX", String(safeTtl)]);
  if (remote !== null) return;

  warnMemoryFallback("values");
  memValues.set(key, {
    value,
    expiresAtEpochMs: Date.now() + safeTtl * 1000,
  });
}

export async function kvGetJson<T>(key: string): Promise<T | null> {
  const raw = await kvGetString(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function kvSetJson(key: string, value: unknown, ttlSec: number): Promise<void> {
  await kvSetString(key, JSON.stringify(value), ttlSec);
}

export async function kvIncrWindow(
  key: string,
  windowSec: number
): Promise<{ count: number; ttlRemainingSec: number; provider: "upstash" | "memory" }> {
  const safeWindow = Math.max(1, Math.floor(windowSec));

  const incrRes = await upstashCommand(["INCR", key]);
  if (typeof incrRes === "number") {
    if (incrRes === 1) {
      await upstashCommand(["EXPIRE", key, String(safeWindow)]);
    }
    const ttlRes = await upstashCommand(["TTL", key]);
    const ttlRemainingSec = typeof ttlRes === "number" && ttlRes > 0 ? ttlRes : safeWindow;
    return { count: incrRes, ttlRemainingSec, provider: "upstash" };
  }

  const now = Date.now();
  warnMemoryFallback("counters");
  const current = memCounters.get(key);
  if (!current || current.resetAtEpochMs <= now) {
    memCounters.set(key, { count: 1, resetAtEpochMs: now + safeWindow * 1000 });
    return { count: 1, ttlRemainingSec: safeWindow, provider: "memory" };
  }
  current.count += 1;
  const ttlRemainingSec = Math.max(1, Math.ceil((current.resetAtEpochMs - now) / 1000));
  return { count: current.count, ttlRemainingSec, provider: "memory" };
}
