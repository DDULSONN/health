import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const PATTERN = /(\/render\/image\/|\/storage\/v1\/render\/|supabase\.co\/storage)/i;

const targets = [
  { table: "dating_cards", id: "id", cols: ["photo_paths", "blur_paths", "blur_thumb_path"] },
  { table: "dating_paid_cards", id: "id", cols: ["photo_paths", "blur_thumb_path"] },
  { table: "dating_card_applications", id: "id", cols: ["photo_paths"] },
  { table: "dating_paid_applications", id: "id", cols: ["photo_paths"] },
  { table: "posts", id: "id", cols: ["images", "thumb_images"] },
];

function valuesFrom(v) {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
  if (typeof v === "string") return [v];
  return [];
}

for (const t of targets) {
  let activeCols = [...t.cols];
  let data = null;
  let error = null;

  while (activeCols.length > 0) {
    const cols = [t.id, ...activeCols].join(",");
    const res = await supabase.from(t.table).select(cols).limit(5000);
    data = res.data;
    error = res.error;
    if (!error) break;

    const missingCol = activeCols.find((c) => String(error.message).includes(c));
    if (missingCol) {
      activeCols = activeCols.filter((c) => c !== missingCol);
      continue;
    }
    console.log(`- ${t.table}: query failed (${error.message})`);
    activeCols = [];
    data = null;
    break;
  }

  if (!activeCols.length || !data) continue;

  let hitRows = 0;
  let hitValues = 0;
  const samples = [];
  for (const row of data ?? []) {
    let rowHit = false;
    for (const col of t.cols) {
      for (const val of valuesFrom(row[col])) {
        if (PATTERN.test(val)) {
          hitValues += 1;
          rowHit = true;
          if (samples.length < 5) samples.push({ id: row[t.id], col, val: val.slice(0, 180) });
        }
      }
    }
    if (rowHit) hitRows += 1;
  }

  console.log(`- ${t.table}: rows=${(data ?? []).length}, hitRows=${hitRows}, hitValues=${hitValues}`);
  for (const s of samples) {
    console.log(`  sample id=${s.id} col=${s.col} val=${s.val}`);
  }
}
