import sharp from "sharp";

export const CARE_EVIDENCE_BUCKET = "contact-care-evidence";
const MAX_BODY = 3_500_000;

// Bound actual bytes, not the caller-controlled Content-Length header.
export async function readCareForm(req: Request) {
  if (!req.body) throw new Error("CARE_UPLOAD");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); throw new Error("CARE_UPLOAD"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new Response(Buffer.concat(chunks), { headers: { "Content-Type": req.headers.get("content-type") || "" } }).formData();
}

export async function prepareCareEvidence(form: FormData) {
  const files = form.getAll("evidence");
  if (files.length < 1 || files.length > 3) throw new Error("CARE_UPLOAD");
  const output: Buffer[] = [];
  // Sequential decoding bounds memory. Decode/re-encode strips EXIF and rejects SVG/HTML, polyglots and corrupt images.
  for (const file of files) {
    if (!(file instanceof File) || !file.size || file.size > 3_000_000 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("CARE_UPLOAD");
    const bytes = Buffer.from(await file.arrayBuffer());
    const image = sharp(bytes, { limitInputPixels: 25_000_000, animated: false });
    const meta = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format || "") || (meta.pages ?? 1) !== 1) throw new Error("CARE_UPLOAD");
    const encoded = await image.rotate().resize({ width: 1600, height: 6000, fit: "inside", withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
    if (encoded.byteLength > 1_500_000) throw new Error("CARE_UPLOAD");
    output.push(encoded);
  }
  return output;
}
