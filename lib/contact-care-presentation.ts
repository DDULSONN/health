import type { ContactCareMatch } from "@/lib/contact-care";

// Keep an identifier only when equal display names would make a choice ambiguous.
export function contactCareMatchLabel(match: ContactCareMatch, matches: readonly ContactCareMatch[]) {
  const name = match.name?.trim() || "상대";
  const duplicate = matches.some(other => other.id !== match.id && (other.name?.trim() || "상대") === name);
  return duplicate ? `${name} · ${match.id.slice(0, 8)}` : name;
}
