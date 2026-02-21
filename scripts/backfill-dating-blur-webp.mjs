#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const CARD_BUCKET = "dating-card-photos";
const LEGACY_BUCKET = "dating-photos";
const PUBLIC_BUCKET = "dating-card-lite";
const PAGE_SIZE = 300;
const MARKER_TTL_SEC = 365 * 24 * 60 * 60;
const BLUR_WIDTH = 560;
const BLUR_QUALITY = 68;

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

async function setLitePublicMarker(blurPath) {
  const result = await upstashCommand(["SET", `litepublic:${blurPath}`, "1", "EX", String(MARKER_TTL_SEC)]);
  return result !== null;
}

function extractFromToken(raw, token) {
  const idx = raw.indexOf(token);
  if (idx < 0) return null;
  const tail = raw.slice(idx + token.length).split("?")[0] ?? "";
  return tail || null;
}

function extractStoragePath(raw) {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  if (!value) return "";

  const bucketTokens = [
    `${CARD_BUCKET}/`,
    `${LEGACY_BUCKET}/`,
    `${PUBLIC_BUCKET}/`,
  ];

  const proxyTokens = ["/i/public-lite/", "/i/signed/"];
  for (const token of proxyTokens) {
    const tail = extractFromToken(value, token);
    if (!tail) continue;
    const decoded = decodeURIComponent(tail);
    for (const bucketToken of bucketTokens) {
      if (decoded.startsWith(bucketToken)) return decoded.slice(bucketToken.length);
    }
    return decoded.replace(/^\/+/, "");
  }

  const directTokens = [
    `/storage/v1/object/public/${CARD_BUCKET}/`,
    `/storage/v1/object/public/${LEGACY_BUCKET}/`,
    `/storage/v1/object/public/${PUBLIC_BUCKET}/`,
    `/storage/v1/object/sign/${CARD_BUCKET}/`,
    `/storage/v1/object/sign/${LEGACY_BUCKET}/`,
    `/storage/v1/render/image/public/${CARD_BUCKET}/`,
    `/storage/v1/render/image/public/${LEGACY_BUCKET}/`,
    `/storage/v1/render/image/sign/${CARD_BUCKET}/`,
    `/storage/v1/render/image/sign/${LEGACY_BUCKET}/`,
  ];
  for (const token of directTokens) {
    const tail = extractFromToken(value, token);
    if (tail) return decodeURIComponent(tail);
  }

  for (const bucketToken of bucketTokens) {
    const idx = value.indexOf(bucketToken);
    if (idx >= 0) return value.slice(idx + bucketToken.length).split("?")[0];
  }
  return value.replace(/^\/+/, "");
}

function toBlurWebpPath(pathValue) {
  if (!pathValue.includes("/blur/")) return pathValue;
  return pathValue.replace(/\.[^.\/]+$/, ".webp");
}

async function ensurePublicBucket(admin) {
  const { error } = await admin.storage.createBucket(PUBLIC_BUCKET, {
    public: true,
    fileSizeLimit: `${5 * 1024 * 1024}`,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  });
  if (!error) return;
  const msg = String(error.message ?? "").toLowerCase();
  if (msg.includes("already") || msg.includes("duplicate")) return;
  throw error;
}

async function createSourceUrl(admin, bucket, sourcePath) {
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(sourcePath, 600);
  if (error || !data?.signedUrl) return "";
  return data.signedUrl;
}

async function fetchWebpBytes(admin, sourcePath) {
  const primary = await createSourceUrl(admin, CARD_BUCKET, sourcePath);
  const legacy = primary ? "" : await createSourceUrl(admin, LEGACY_BUCKET, sourcePath);
  const sourceUrl = primary || legacy;
  if (!sourceUrl) return null;
  const res = await fetch(sourceUrl, { cache: "no-store" }).catch(() => null);
  if (!res || !res.ok) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  return sharp(bytes)
    .rotate()
    .resize({ width: BLUR_WIDTH, withoutEnlargement: true })
    .webp({ quality: BLUR_QUALITY })
    .toBuffer();
}

async function uploadBytes(admin, bucket, targetPath, bytes, cacheControl) {
  const { error } = await admin.storage.from(bucket).upload(targetPath, bytes, {
    contentType: "image/webp",
    upsert: false,
    cacheControl,
  });
  if (!error) return { ok: true, existed: false };
  const msg = String(error.message ?? "").toLowerCase();
  if (msg.includes("duplicate") || msg.includes("exists") || msg.includes("already")) {
    return { ok: true, existed: true };
  }
  return { ok: false, existed: false };
}

async function fetchPaged(admin, table, selectCols, verbose) {
  const rows = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await admin.from(table).select(selectCols).range(from, to);
    if (error) throw new Error(`${table} select failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (verbose) console.log(`[scan] table=${table} from=${from} rows=${data.length} total=${rows.length}`);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

function pushIfString(arr, value) {
  if (typeof value === "string" && value.trim().length > 0) arr.push(value.trim());
}

function buildCardJob(row) {
  const normalizedBlurPaths = Array.isArray(row.blur_paths)
    ? row.blur_paths
        .map((v) => extractStoragePath(v))
        .filter((v) => typeof v === "string" && v.length > 0)
    : [];
  const thumbPath = extractStoragePath(row.blur_thumb_path);
  if (thumbPath) pushIfString(normalizedBlurPaths, thumbPath);
  const uniqueSourcePaths = [...new Set(normalizedBlurPaths)].filter((v) => v.includes("/blur/"));
  if (uniqueSourcePaths.length === 0) return null;
  return {
    table: "dating_cards",
    id: row.id,
    sourcePaths: uniqueSourcePaths,
    currentBlurPaths: Array.isArray(row.blur_paths) ? row.blur_paths : [],
    currentBlurThumbPath: row.blur_thumb_path,
  };
}

function buildPaidJob(row) {
  const thumbPath = extractStoragePath(row.blur_thumb_path);
  if (!thumbPath || !thumbPath.includes("/blur/")) return null;
  return {
    table: "dating_paid_cards",
    id: row.id,
    sourcePaths: [thumbPath],
    currentBlurThumbPath: row.blur_thumb_path,
  };
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
  if (args.apply) await ensurePublicBucket(admin);

  const cards = await fetchPaged(admin, "dating_cards", "id,blur_paths,blur_thumb_path", args.verbose);
  const paid = await fetchPaged(admin, "dating_paid_cards", "id,blur_thumb_path", args.verbose);
  const jobs = [
    ...cards.map(buildCardJob).filter(Boolean),
    ...paid.map(buildPaidJob).filter(Boolean),
  ];
  const targets = args.limit > 0 ? jobs.slice(0, args.limit) : jobs;

  const stats = {
    totalJobs: targets.length,
    doneJobs: 0,
    transformed: 0,
    privateExists: 0,
    publicExists: 0,
    fetchFail: 0,
    uploadFail: 0,
    dbUpdated: 0,
    dbUnchanged: 0,
    markerSet: 0,
    markerSkipped: 0,
  };

  console.log(
    `[backfill-blur-webp] mode=${args.apply ? "apply" : "dry-run"} totalJobs=${stats.totalJobs} concurrency=${args.concurrency}`
  );

  const queue = [...targets];
  const workerFn = async (job) => {
    stats.doneJobs += 1;
    const converted = new Map();

    for (const sourcePath of job.sourcePaths) {
      const targetPath = toBlurWebpPath(sourcePath);
      converted.set(sourcePath, sourcePath);
      if (!sourcePath.includes("/blur/")) continue;

      if (!args.apply) {
        converted.set(sourcePath, targetPath);
        continue;
      }

      const bytes = await fetchWebpBytes(admin, sourcePath);
      if (!bytes) {
        stats.fetchFail += 1;
        if (args.verbose) {
          console.warn(`[backfill-blur-webp] fetch-fail id=${job.id} source=${sourcePath}`);
        }
        continue;
      }

      const privateRes = await uploadBytes(admin, CARD_BUCKET, targetPath, bytes, "3600");
      if (!privateRes.ok) {
        stats.uploadFail += 1;
        if (args.verbose) {
          console.warn(`[backfill-blur-webp] private-upload-fail id=${job.id} target=${targetPath}`);
        }
        continue;
      }
      if (privateRes.existed) stats.privateExists += 1;

      const publicRes = await uploadBytes(admin, PUBLIC_BUCKET, targetPath, bytes, "31536000");
      if (!publicRes.ok) {
        stats.uploadFail += 1;
        if (args.verbose) {
          console.warn(`[backfill-blur-webp] public-upload-fail id=${job.id} target=${targetPath}`);
        }
        continue;
      }
      if (publicRes.existed) stats.publicExists += 1;

      const markerOk = await setLitePublicMarker(targetPath);
      if (markerOk) stats.markerSet += 1;
      else stats.markerSkipped += 1;

      converted.set(sourcePath, targetPath);
      stats.transformed += 1;
    }

    if (!args.apply) return;

    if (job.table === "dating_cards") {
      const prevPaths = Array.isArray(job.currentBlurPaths) ? job.currentBlurPaths : [];
      const nextPaths = prevPaths.map((value) => {
        const normalized = extractStoragePath(value);
        const mapped = converted.get(normalized);
        return mapped && mapped !== normalized ? value.replace(normalized, mapped) : value;
      });
      const prevThumb = typeof job.currentBlurThumbPath === "string" ? job.currentBlurThumbPath : "";
      const normalizedThumb = extractStoragePath(prevThumb);
      const mappedThumb = converted.get(normalizedThumb);
      const nextThumb = mappedThumb && mappedThumb !== normalizedThumb ? prevThumb.replace(normalizedThumb, mappedThumb) : prevThumb;
      const changed = JSON.stringify(prevPaths) !== JSON.stringify(nextPaths) || prevThumb !== nextThumb;
      if (!changed) {
        stats.dbUnchanged += 1;
      } else {
        const { error } = await admin
          .from("dating_cards")
          .update({ blur_paths: nextPaths, blur_thumb_path: nextThumb || null })
          .eq("id", job.id);
        if (error) {
          stats.uploadFail += 1;
          if (args.verbose) console.warn(`[backfill-blur-webp] db-update-fail dating_cards id=${job.id} msg=${error.message}`);
        } else {
          stats.dbUpdated += 1;
        }
      }
      return;
    }

    const prevThumb = typeof job.currentBlurThumbPath === "string" ? job.currentBlurThumbPath : "";
    const normalizedThumb = extractStoragePath(prevThumb);
    const mappedThumb = converted.get(normalizedThumb);
    const nextThumb = mappedThumb && mappedThumb !== normalizedThumb ? prevThumb.replace(normalizedThumb, mappedThumb) : prevThumb;
    if (prevThumb === nextThumb) {
      stats.dbUnchanged += 1;
    } else {
      const { error } = await admin
        .from("dating_paid_cards")
        .update({ blur_thumb_path: nextThumb || null })
        .eq("id", job.id);
      if (error) {
        stats.uploadFail += 1;
        if (args.verbose) console.warn(`[backfill-blur-webp] db-update-fail dating_paid_cards id=${job.id} msg=${error.message}`);
      } else {
        stats.dbUpdated += 1;
      }
    }
  };

  const workers = [];
  for (let i = 0; i < args.concurrency; i += 1) {
    workers.push(runWorker(queue, workerFn));
  }
  await Promise.all(workers);

  console.log(
    `[backfill-blur-webp] finished doneJobs=${stats.doneJobs}/${stats.totalJobs} transformed=${stats.transformed} privateExists=${stats.privateExists} publicExists=${stats.publicExists} fetchFail=${stats.fetchFail} uploadFail=${stats.uploadFail} dbUpdated=${stats.dbUpdated} dbUnchanged=${stats.dbUnchanged} markerSet=${stats.markerSet} markerSkipped=${stats.markerSkipped}`
  );
}

main().catch((err) => {
  console.error(`[backfill-blur-webp] fatal ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
