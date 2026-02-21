#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PRIMARY_BUCKET = "dating-card-photos";
const LEGACY_BUCKET = "dating-photos";
const TRANSFORM = { width: 1200, quality: 78 };
const PAGE_SIZE = 500;

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
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

async function createSourceUrl(admin, bucket, rawPath) {
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(rawPath, 600, { transform: TRANSFORM });
  if (error || !data?.signedUrl) return "";
  const joiner = data.signedUrl.includes("?") ? "&" : "?";
  return `${data.signedUrl}${joiner}format=webp`;
}

async function uploadLite(admin, bucket, litePath, bytes) {
  const { error } = await admin.storage.from(bucket).upload(litePath, bytes, {
    contentType: "image/webp",
    upsert: false,
    cacheControl: "31536000",
  });
  return error;
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

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const raw1 = await fetchAllRawPaths(admin, "dating_cards", args.verbose);
  const raw2 = await fetchAllRawPaths(admin, "dating_paid_cards", args.verbose);
  const deduped = [...new Set([...raw1, ...raw2])].filter((p) => p.includes("/raw/"));
  const targets = args.limit > 0 ? deduped.slice(0, args.limit) : deduped;

  const stats = {
    total: targets.length,
    scanned: deduped.length,
    done: 0,
    created: 0,
    skippedExists: 0,
    failed: 0,
    fetchFail: 0,
    signFail: 0,
  };

  console.log(
    `[backfill-lite] mode=${args.apply ? "apply" : "dry-run"} total=${stats.total} scanned=${stats.scanned} concurrency=${args.concurrency}`
  );

  const queue = [...targets];
  const workerFn = async (rawPath) => {
    stats.done += 1;
    const litePath = toLitePath(rawPath);
    if (!args.apply) {
      if (args.verbose) console.log(`[dry-run] raw=${rawPath} lite=${litePath}`);
      return;
    }

    const sourcePrimary = await createSourceUrl(admin, PRIMARY_BUCKET, rawPath);
    const sourceLegacy = sourcePrimary ? "" : await createSourceUrl(admin, LEGACY_BUCKET, rawPath);
    const sourceUrl = sourcePrimary || sourceLegacy;
    const sourceBucket = sourcePrimary ? PRIMARY_BUCKET : sourceLegacy ? LEGACY_BUCKET : "";
    if (!sourceUrl || !sourceBucket) {
      stats.signFail += 1;
      stats.failed += 1;
      console.warn(`[backfill-lite] sign-fail raw=${rawPath}`);
      return;
    }

    const res = await fetch(sourceUrl, { cache: "no-store" }).catch(() => null);
    if (!res || !res.ok) {
      stats.fetchFail += 1;
      stats.failed += 1;
      console.warn(`[backfill-lite] fetch-fail raw=${rawPath} status=${res?.status ?? "ERR"}`);
      return;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    const uploadError = await uploadLite(admin, sourceBucket, litePath, bytes);
    if (!uploadError) {
      stats.created += 1;
      return;
    }

    const msg = String(uploadError.message ?? "").toLowerCase();
    if (msg.includes("duplicate") || msg.includes("already exists") || msg.includes("exists")) {
      stats.skippedExists += 1;
      return;
    }
    stats.failed += 1;
    console.warn(`[backfill-lite] upload-fail lite=${litePath} message=${uploadError.message ?? "unknown"}`);
  };

  const workers = [];
  for (let i = 0; i < args.concurrency; i += 1) workers.push(runWorker(queue, workerFn));
  await Promise.all(workers);

  console.log(
    `[backfill-lite] finished done=${stats.done}/${stats.total} created=${stats.created} skippedExists=${stats.skippedExists} failed=${stats.failed} signFail=${stats.signFail} fetchFail=${stats.fetchFail}`
  );
}

main().catch((err) => {
  console.error(`[backfill-lite] fatal ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
