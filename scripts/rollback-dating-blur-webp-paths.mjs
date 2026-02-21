#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PAGE_SIZE = 500;

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    apply: args.has("--apply"),
    verbose: args.has("--verbose"),
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

function toJpg(pathValue) {
  if (typeof pathValue !== "string") return pathValue;
  if (!pathValue.includes("/blur/")) return pathValue;
  return pathValue.replace(/\.webp(\?|$)/i, ".jpg$1");
}

async function fetchPaged(admin, table, cols) {
  const rows = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await admin.from(table).select(cols).range(from, to);
    if (error) throw new Error(`${table} select failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
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

  const cards = await fetchPaged(admin, "dating_cards", "id,blur_paths,blur_thumb_path");
  const paid = await fetchPaged(admin, "dating_paid_cards", "id,blur_thumb_path");

  let changedCards = 0;
  let changedPaid = 0;

  console.log(`[rollback-blur-webp-paths] mode=${args.apply ? "apply" : "dry-run"} cards=${cards.length} paid=${paid.length}`);

  for (const row of cards) {
    const prevPaths = Array.isArray(row.blur_paths) ? row.blur_paths : [];
    const nextPaths = prevPaths.map((v) => toJpg(v));
    const prevThumb = row.blur_thumb_path ?? null;
    const nextThumb = toJpg(prevThumb);
    const changed = JSON.stringify(prevPaths) !== JSON.stringify(nextPaths) || prevThumb !== nextThumb;
    if (!changed) continue;
    changedCards += 1;
    if (args.verbose) {
      console.log(`[cards] id=${row.id} changed=true`);
    }
    if (args.apply) {
      const { error } = await admin
        .from("dating_cards")
        .update({ blur_paths: nextPaths, blur_thumb_path: nextThumb })
        .eq("id", row.id);
      if (error) throw new Error(`dating_cards update failed id=${row.id}: ${error.message}`);
    }
  }

  for (const row of paid) {
    const prevThumb = row.blur_thumb_path ?? null;
    const nextThumb = toJpg(prevThumb);
    if (prevThumb === nextThumb) continue;
    changedPaid += 1;
    if (args.verbose) {
      console.log(`[paid] id=${row.id} changed=true`);
    }
    if (args.apply) {
      const { error } = await admin
        .from("dating_paid_cards")
        .update({ blur_thumb_path: nextThumb })
        .eq("id", row.id);
      if (error) throw new Error(`dating_paid_cards update failed id=${row.id}: ${error.message}`);
    }
  }

  console.log(`[rollback-blur-webp-paths] finished changedCards=${changedCards} changedPaid=${changedPaid}`);
}

main().catch((err) => {
  console.error(`[rollback-blur-webp-paths] fatal ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
