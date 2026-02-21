import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TARGET_DIRS = ["app", "lib"];
const FILE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const BLOCKED = ["supabase.co/storage", "/storage/v1/object", "/storage/v1/render/image", "/render/image"];
const ALLOWLIST = new Set([
  "app/i/[...slug]/route.ts",
  "lib/images.ts",
  "app/api/posts/route.ts",
  "app/api/posts/[id]/route.ts",
]);

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
      continue;
    }
    if (!FILE_EXTS.has(path.extname(entry.name))) continue;
    files.push(full);
  }
  return files;
}

async function main() {
  const violations = [];
  for (const dir of TARGET_DIRS) {
    const abs = path.join(ROOT, dir);
    const files = await walk(abs);
    for (const file of files) {
      const rel = path.relative(ROOT, file).replace(/\\/g, "/");
      if (ALLOWLIST.has(rel)) continue;
      const text = await fs.readFile(file, "utf8");
      for (const token of BLOCKED) {
        if (text.includes(token)) {
          violations.push(`${rel}: contains "${token}"`);
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error("[check-no-direct-supabase-image-urls] failed");
    for (const violation of violations) console.error(`- ${violation}`);
    process.exit(1);
  }

  console.log("[check-no-direct-supabase-image-urls] ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
