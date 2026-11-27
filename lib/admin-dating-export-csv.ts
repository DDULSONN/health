const REDACTED_FIELDS = new Set([
  "phone", "instagram_id", "email", "nickname", "name", "display_name",
  "job", "strengths_text", "ideal_type", "ideal_text", "intro_text",
  "preferred_partner_text", "admin_note", "admin_tags", "self_intro_or_strengths",
  "ideal_preference_text", "note",
]);

function escapeCsvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  // Quoting a CSV cell does not prevent a spreadsheet from evaluating it.
  if (typeof value === "string" && /^[\p{White_Space}\uFEFF]*[=+@\-＝＋＠－]|^[\t\r\n]/u.test(text)) text = "'" + text;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildMaskedDatingCsv(headers: string[], rows: unknown[][]) {
  const omitted = headers.map((name) => REDACTED_FIELDS.has(name));
  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const row of rows) lines.push(headers.map((_, i) => omitted[i] ? "" : escapeCsvCell(row[i])).join(","));
  return `\uFEFF${lines.join("\r\n")}`;
}
