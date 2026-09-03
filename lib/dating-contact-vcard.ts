import { isLikelyKoreanMobileE164, isLikelyValidE164, normalizePhoneToE164 } from "@/lib/phone-verification";

export const MAX_CONTACT_VCARD_BYTES = 20 * 1024 * 1024;
export const MAX_CONTACT_VCARD_PHONE_COUNT = 5_000;

export type ParsedContactVCard = {
  phones: string[];
  invalidCount: number;
  telephoneEntryCount: number;
  exceededLimit: boolean;
};

export function normalizeImportedContactPhone(raw: string) {
  const decoded = raw
    .trim()
    .replace(/^tel:/i, "")
    .replace(/\\([,;\\])/g, "$1")
    .split(/[;?]/, 1)[0]
    .trim();
  const normalized = normalizePhoneToE164(decoded);
  if (!normalized || !isLikelyValidE164(normalized)) return "";
  if (normalized.startsWith("+82") && !isLikelyKoreanMobileE164(normalized)) return "";
  return normalized;
}

export function parseContactVCardPhones(
  source: string,
  limit = MAX_CONTACT_VCARD_PHONE_COUNT
): ParsedContactVCard {
  if (!/BEGIN:VCARD/i.test(source)) {
    return { phones: [], invalidCount: 0, telephoneEntryCount: 0, exceededLimit: false };
  }

  const unfolded = source.replace(/\r\n[ \t]|\n[ \t]|\r[ \t]/g, "");
  const lines = unfolded.split(/\r\n|\n|\r/);
  const phones = new Set<string>();
  let invalidCount = 0;
  let telephoneEntryCount = 0;

  for (const line of lines) {
    const match = line.match(/^(?:item\d+\.)?TEL(?:;[^:]*)?:(.*)$/i);
    if (!match) continue;
    telephoneEntryCount += 1;
    const phone = normalizeImportedContactPhone(match[1] ?? "");
    if (!phone) {
      invalidCount += 1;
      continue;
    }
    phones.add(phone);
    if (phones.size > limit) {
      return {
        phones: [...phones].slice(0, limit),
        invalidCount,
        telephoneEntryCount,
        exceededLimit: true,
      };
    }
  }

  return {
    phones: [...phones],
    invalidCount,
    telephoneEntryCount,
    exceededLimit: false,
  };
}
