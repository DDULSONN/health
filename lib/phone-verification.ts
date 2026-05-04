export function normalizePhoneToE164(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";

  const compact = value.replace(/[^\d+]/g, "");
  if (compact.startsWith("+")) {
    const digits = compact.slice(1).replace(/\D/g, "");
    return digits ? `+${digits}` : "";
  }

  const digits = compact.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("0")) return `+82${digits.slice(1)}`;
  if (digits.startsWith("82")) return `+${digits}`;
  if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
  return `+${digits}`;
}

export function isLikelyValidE164(phone: string): boolean {
  return /^\+[1-9][0-9]{7,14}$/.test(phone);
}

export function isLikelyKoreanMobileE164(phone: string): boolean {
  return /^\+821(0|1|6|7|8|9)[0-9]{7,8}$/.test(phone);
}

export function getPhoneValidationMessage(phoneE164: string): string | null {
  if (!phoneE164 || !isLikelyValidE164(phoneE164)) {
    return "휴대폰 번호를 올바르게 입력해주세요. 예: 01012345678";
  }
  if (phoneE164.startsWith("+82") && !isLikelyKoreanMobileE164(phoneE164)) {
    return "국내 휴대폰 번호 형식을 확인해주세요. 010 번호를 권장합니다.";
  }
  return null;
}

export function hashForOperationalLog(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
