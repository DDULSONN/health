export function normalizeCityToken(token: string): string {
  const t = token.trim().replace(/[()]/g, "");
  return t.replace(/(특별자치도|특별자치시|특별시|광역시|자치시|자치도|시|군|구)$/u, "");
}

const PROVINCE_TOKENS = new Set([
  "서울",
  "서울시",
  "서울특별시",
  "경기",
  "경기도",
  "인천",
  "인천시",
  "인천광역시",
  "부산",
  "부산시",
  "부산광역시",
  "대구",
  "대구시",
  "대구광역시",
  "광주",
  "광주시",
  "광주광역시",
  "대전",
  "대전시",
  "대전광역시",
  "울산",
  "울산시",
  "울산광역시",
  "세종",
  "세종시",
  "세종특별자치시",
  "강원",
  "강원도",
  "충북",
  "충청북도",
  "충남",
  "충청남도",
  "전북",
  "전라북도",
  "전남",
  "전라남도",
  "경북",
  "경상북도",
  "경남",
  "경상남도",
  "제주",
  "제주시",
  "제주도",
  "제주특별자치도",
]);

export function extractCityFromRegion(region: string | null): string | null {
  const raw = (region ?? "").trim();
  if (!raw) return null;

  const tokens = raw
    .replace(/[,-]/g, " ")
    .split(/\s+/)
    .map((v) => v.trim())
    .filter(Boolean);

  if (tokens.length === 0) return null;

  const first = tokens[0];
  const cityToken = PROVINCE_TOKENS.has(first) ? tokens[1] ?? "" : first;
  const city = normalizeCityToken(cityToken);
  if (!city || city.length < 2) return null;
  return city;
}
