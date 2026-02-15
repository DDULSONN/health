const BLOCKED_WORDS = ["admin", "운영자", "관리자", "fuck", "shit", "sex", "섹스"];

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 12;

export function normalizeNickname(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function validateNickname(nicknameRaw: string): string | null {
  const nickname = normalizeNickname(nicknameRaw);

  if (nickname.length < NICKNAME_MIN || nickname.length > NICKNAME_MAX) {
    return `닉네임은 ${NICKNAME_MIN}~${NICKNAME_MAX}자로 입력해 주세요.`;
  }

  if (nickname.includes(" ")) {
    return "닉네임에는 공백을 사용할 수 없습니다.";
  }

  if (!/^[0-9A-Za-z가-힣_]+$/.test(nickname)) {
    return "닉네임은 한글/영문/숫자/_만 사용할 수 있습니다.";
  }

  const lower = nickname.toLowerCase();
  if (BLOCKED_WORDS.some((word) => lower.includes(word.toLowerCase()))) {
    return "사용할 수 없는 닉네임입니다.";
  }

  return null;
}
