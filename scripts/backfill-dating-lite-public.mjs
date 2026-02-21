#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SOURCE_PRIMARY_BUCKET = "dating-card-photos";
const SOURCE_LEGACY_BUCKET = "dating-photos";
const TARGET_BUCKET = "dating-card-lite";
const PAGE_SIZE = 500;
const MARKER_TTL_SEC = 365 * 24 * 60 * 60;

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  const kv = new Map();
  for (const token of argv.slice(2)) {
    const eq = token.indexOf("=");
    if (eq > 0) kv.set(token.slice(0, eq), token.slice(eq + 1));
  }
  return {
    apply: args.has("--apply"),
    verbose: args.has("--verbose"),
    limit: Number(kv.get("--limit") ?? "0") || 0,
    concurrency: Math.max(1, Number(kv.get("--concurrency") ?? "4") || 4),
  };
}

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function toLitePath(rawPath) {
  return rawPath.replace("/raw/", "/lite/").replace(/\.[^.\/]+$/, ".webp");
}

function extractPaths(rows) {
  const out = [];
  for (const row of rows ?? []) {
    const arr = row?.photo_paths;
    if (!Array.isArray(arr)) continue;
    for (const p of arr) {
      if (typeof p === "string" && p.length > 0) out.push(p);
    }
  }
  return out;
}

async function fetchAllRawPaths(admin, table, verbose) {
  const paths = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await admin
      .from(table)
      .select("photo_paths")
      .range(from, to);
    if (error) throw new Error(`${table} select failed: ${error.message}`);
    if (!data || data.length === 0) break;
    paths.push(...extractPaths(data));
    if (verbose) console.log(`[scan] table=${table} from=${from} rows=${data.length} paths=${paths.length}`);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return paths;
}

function getUpstashConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return { url, token };
}

async function upstashCommand(command) {
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
    const body = await res.json().catch(() => null);
    return body?.result ?? null;
  } catch {
    return null;
  }
}

async function setLitePublicMarker(litePath) {
  const result = await upstashCommand(["SET", `litepublic:${litePath}`, "1", "EX", String(MARKER_TTL_SEC)]);
  return result !== null;
}

async function createSourceUrl(admin, bucket, litePath) {
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(litePath, 600);
  if (error || !data?.signedUrl) return "";
  return data.signedUrl;
}

async function uploadTarget(admin, litePath, bytes) {
  const { error } = await admin.storage.from(TARGET_BUCKET).upload(litePath, bytes, {
    contentType: "image/webp",
    upsert: false,
    cacheControl: "31536000",
  });
  return error;
}

async function ensureTargetBucket(admin) {
  const { error } = await admin.storage.createBucket(TARGET_BUCKET, {
    public: true,
    fileSizeLimit: `${5 * 1024 * 1024}`,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  });
  if (!error) return;
  const msg = String(error.message ?? "").toLowerCase();
  if (msg.includes("already") || msg.includes("duplicate")) return;
  throw error;
}

async function runWorker(queue, workerFn) {
  while (true) {
    const item = queue.shift();
    if (!item) return;
    await workerFn(item);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  loadEnvLocal();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const hasUpstash = Boolean(getUpstashConfig());
  if (!hasUpstash) {
    console.warn("[backfill-lite-public] warning: UPSTASH config missing. copy can run but marker write will be skipped.");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (args.apply) {
    await ensureTargetBucket(admin);
  }

  const raw1 = await fetchAllRawPaths(admin, "dating_cards", args.verbose);
  const raw2 = await fetchAllRawPaths(admin, "dating_paid_cards", args.verbose);
  const dedupedLite = [...new Set([...raw1, ...raw2])]
    .filter((p) => typeof p === "string" && p.includes("/raw/"))
    .map(toLitePath);
  const targets = args.limit > 0 ? dedupedLite.slice(0, args.limit) : dedupedLite;

  const stats = {
    total: targets.length,
    scanned: dedupedLite.length,
    done: 0,
    copied: 0,
    exists: 0,
    markerSet: 0,
    markerSkipped: 0,
    signFail: 0,
    fetchFail: 0,
    failed: 0,
  };

  console.log(
    `[backfill-lite-public] mode=${args.apply ? "apply" : "dry-run"} total=${stats.total} scanned=${stats.scanned} concurrency=${args.concurrency}`
  );

  const queue = [...targets];
  const workerFn = async (litePath) => {
    stats.done += 1;
    if (!args.apply) {
      if (args.verbose) console.log(`[dry-run] lite=${litePath}`);
      return;
    }

    const sourcePrimary = await createSourceUrl(admin, SOURCE_PRIMARY_BUCKET, litePath);
    const sourceLegacy = sourcePrimary ? "" : await createSourceUrl(admin, SOURCE_LEGACY_BUCKET, litePath);
    const sourceUrl = sourcePrimary || sourceLegacy;
    if (!sourceUrl) {
      stats.signFail += 1;
      stats.failed += 1;
      if (args.verbose) console.warn(`[backfill-lite-public] sign-fail lite=${litePath}`);
      return;
    }

    const res = await fetch(sourceUrl, { cache: "no-store" }).catch(() => null);
    if (!res || !res.ok) {
      stats.fetchFail += 1;
      stats.failed += 1;
      if (args.verbose) console.warn(`[backfill-lite-public] fetch-fail lite=${litePath} status=${res?.status ?? "ERR"}`);
      return;
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    const uploadError = await uploadTarget(admin, litePath, bytes);
    if (!uploadError) {
      stats.copied += 1;
    } else {
      const msg = String(uploadError.message ?? "").toLowerCase();
      if (msg.includes("duplicate") || msg.includes("already exists") || msg.includes("exists")) {
        stats.exists += 1;
      } else {
        stats.failed += 1;
        if (args.verbose) console.warn(`[backfill-lite-public] upload-fail lite=${litePath} message=${uploadError.message ?? "unknown"}`);
        return;
      }
    }

    const markerOk = await setLitePublicMarker(litePath);
    if (markerOk) stats.markerSet += 1;
    else stats.markerSkipped += 1;
  };

  const workers = [];
  for (let i = 0; i < args.concurrency; i += 1) workers.push(runWorker(queue, workerFn));
  await Promise.all(workers);

  console.log(
    `[backfill-lite-public] finished done=${stats.done}/${stats.total} copied=${stats.copied} exists=${stats.exists} markerSet=${stats.markerSet} markerSkipped=${stats.markerSkipped} failed=${stats.failed} signFail=${stats.signFail} fetchFail=${stats.fetchFail}`
  );
}

main().catch((err) => {
  console.error(`[backfill-lite-public] fatal ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

