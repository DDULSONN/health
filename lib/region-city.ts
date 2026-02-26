const PROVINCE_ALIASES: Record<string, string> = {
  서울: "서울",
  서울시: "서울",
  서울특별시: "서울",
  부산: "부산",
  부산시: "부산",
  부산광역시: "부산",
  대구: "대구",
  대구시: "대구",
  대구광역시: "대구",
  인천: "인천",
  인천시: "인천",
  인천광역시: "인천",
  광주: "광주",
  광주시: "광주",
  광주광역시: "광주",
  대전: "대전",
  대전시: "대전",
  대전광역시: "대전",
  울산: "울산",
  울산시: "울산",
  울산광역시: "울산",
  세종: "세종",
  세종시: "세종",
  세종특별자치시: "세종",
  경기: "경기",
  경기도: "경기",
  강원: "강원",
  강원도: "강원",
  충북: "충북",
  충청북도: "충북",
  충남: "충남",
  충청남도: "충남",
  전북: "전북",
  전라북도: "전북",
  전남: "전남",
  전라남도: "전남",
  경북: "경북",
  경상북도: "경북",
  경남: "경남",
  경상남도: "경남",
  제주: "제주",
  제주도: "제주",
  제주특별자치도: "제주",
};

export const PROVINCE_ORDER = [
  "서울",
  "부산",
  "대구",
  "인천",
  "광주",
  "대전",
  "울산",
  "세종",
  "경기",
  "강원",
  "충북",
  "충남",
  "전북",
  "전남",
  "경북",
  "경남",
  "제주",
] as const;

const CANONICAL_PROVINCES = new Set<string>(PROVINCE_ORDER);

const METRO_PROVINCES = new Set(["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "제주"]);

const CITY_ALIASES: Record<string, string> = {
  동탄: "화성",
  일산: "고양",
  분당: "성남",
  판교: "성남",
  위례: "성남",
  송도: "인천",
  영종: "인천",
  검단: "인천",
  경기북부: "경기",
};

const SEOUL_DISTRICTS = new Set([
  "강남",
  "강동",
  "강북",
  "강서",
  "관악",
  "광진",
  "구로",
  "금천",
  "노원",
  "도봉",
  "동대문",
  "동작",
  "마포",
  "서대문",
  "서초",
  "성동",
  "성북",
  "송파",
  "양천",
  "영등포",
  "용산",
  "은평",
  "종로",
  "중",
  "중랑",
]);

const PROVINCE_BY_CITY: Record<string, string> = {
  // 서울
  강남: "서울",
  강동: "서울",
  강북: "서울",
  강서: "서울",
  관악: "서울",
  광진: "서울",
  구로: "서울",
  금천: "서울",
  노원: "서울",
  도봉: "서울",
  동대문: "서울",
  동작: "서울",
  마포: "서울",
  서대문: "서울",
  서초: "서울",
  성동: "서울",
  성북: "서울",
  송파: "서울",
  양천: "서울",
  영등포: "서울",
  용산: "서울",
  은평: "서울",
  종로: "서울",
  중랑: "서울",

  // 부산
  부산진: "부산",
  동래: "부산",
  남: "부산",
  북: "부산",
  해운대: "부산",
  사하: "부산",
  금정: "부산",
  강서구부산: "부산",
  연제: "부산",
  수영: "부산",
  사상: "부산",
  기장: "부산",
  영도: "부산",
  중부산: "부산",
  서부산: "부산",
  동부산: "부산",

  // 대구
  수성: "대구",
  달서: "대구",
  달성: "대구",
  군위: "대구",

  // 인천
  미추홀: "인천",
  연수: "인천",
  남동: "인천",
  부평: "인천",
  계양: "인천",
  서구인천: "인천",
  강화: "인천",
  옹진: "인천",
  중인천: "인천",
  동인천: "인천",

  // 광주
  동광주: "광주",
  서광주: "광주",
  남광주: "광주",
  북광주: "광주",
  광산: "광주",

  // 대전
  동대전: "대전",
  서대전: "대전",
  유성: "대전",
  대덕: "대전",
  중대전: "대전",

  // 울산
  중울산: "울산",
  남울산: "울산",
  동울산: "울산",
  북울산: "울산",
  울주: "울산",

  // 경기
  수원: "경기",
  성남: "경기",
  고양: "경기",
  용인: "경기",
  부천: "경기",
  안산: "경기",
  안양: "경기",
  남양주: "경기",
  화성: "경기",
  평택: "경기",
  의정부: "경기",
  시흥: "경기",
  파주: "경기",
  광명: "경기",
  김포: "경기",
  군포: "경기",
  광주경기: "경기",
  이천: "경기",
  양주: "경기",
  오산: "경기",
  구리: "경기",
  안성: "경기",
  포천: "경기",
  의왕: "경기",
  하남: "경기",
  여주: "경기",
  양평: "경기",
  동두천: "경기",
  과천: "경기",
  가평: "경기",
  연천: "경기",

  // 강원
  춘천: "강원",
  원주: "강원",
  강릉: "강원",
  동해: "강원",
  태백: "강원",
  속초: "강원",
  삼척: "강원",
  홍천: "강원",
  횡성: "강원",
  영월: "강원",
  평창: "강원",
  정선: "강원",
  철원: "강원",
  화천: "강원",
  양구: "강원",
  인제: "강원",
  고성강원: "강원",
  양양: "강원",

  // 충북
  청주: "충북",
  충주: "충북",
  제천: "충북",
  보은: "충북",
  옥천: "충북",
  영동: "충북",
  증평: "충북",
  진천: "충북",
  괴산: "충북",
  음성: "충북",
  단양: "충북",

  // 충남
  천안: "충남",
  공주: "충남",
  보령: "충남",
  아산: "충남",
  서산: "충남",
  논산: "충남",
  계룡: "충남",
  당진: "충남",
  금산: "충남",
  부여: "충남",
  서천: "충남",
  청양: "충남",
  홍성: "충남",
  예산: "충남",
  태안: "충남",

  // 전북
  전주: "전북",
  군산: "전북",
  익산: "전북",
  정읍: "전북",
  남원: "전북",
  김제: "전북",
  완주: "전북",
  진안: "전북",
  무주: "전북",
  장수: "전북",
  임실: "전북",
  순창: "전북",
  고창전북: "전북",
  부안: "전북",

  // 전남
  목포: "전남",
  여수: "전남",
  순천: "전남",
  나주: "전남",
  광양: "전남",
  담양: "전남",
  곡성: "전남",
  구례: "전남",
  고흥: "전남",
  보성: "전남",
  화순: "전남",
  장흥: "전남",
  강진: "전남",
  해남: "전남",
  영암: "전남",
  무안: "전남",
  함평: "전남",
  영광: "전남",
  장성: "전남",
  완도: "전남",
  진도: "전남",
  신안: "전남",

  // 경북
  포항: "경북",
  경주: "경북",
  김천: "경북",
  안동: "경북",
  구미: "경북",
  영주: "경북",
  영천: "경북",
  상주: "경북",
  문경: "경북",
  경산: "경북",
  의성: "경북",
  청송: "경북",
  영양: "경북",
  영덕: "경북",
  청도: "경북",
  고령: "경북",
  성주: "경북",
  칠곡: "경북",
  예천: "경북",
  봉화: "경북",
  울진: "경북",
  울릉: "경북",

  // 경남
  창원: "경남",
  진주: "경남",
  통영: "경남",
  사천: "경남",
  김해: "경남",
  밀양: "경남",
  거제: "경남",
  양산: "경남",
  의령: "경남",
  함안: "경남",
  창녕: "경남",
  고성경남: "경남",
  남해: "경남",
  하동: "경남",
  산청: "경남",
  함양: "경남",
  거창: "경남",
  합천: "경남",

  // 제주
  제주시: "제주",
  서귀포: "제주",
};

const PROVINCE_KEYS_DESC = Object.keys(PROVINCE_ALIASES).sort((a, b) => b.length - a.length);

function cleanToken(token: string): string {
  return token.trim().replace(/[()]/g, "").replace(/[^0-9A-Za-z가-힣]/g, "");
}

function stripAdminSuffix(token: string): string {
  return token.replace(/(특별자치시|특별자치도|특별시|광역시|자치시|자치도|시|군|구|읍|면|동|리)$/u, "");
}

function splitByProvincePrefix(token: string): string[] {
  const cleaned = cleanToken(token);
  if (!cleaned) return [];
  for (const provinceKey of PROVINCE_KEYS_DESC) {
    if (!cleaned.startsWith(provinceKey) || cleaned.length <= provinceKey.length) continue;
    return [provinceKey, cleaned.slice(provinceKey.length)];
  }
  return [cleaned];
}

function tokenizeRegion(region: string): string[] {
  return region
    .replace(/[,\-|/|·]/g, " ")
    .split(/\s+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .flatMap((token) => splitByProvincePrefix(token))
    .filter(Boolean);
}

function findProvinceHint(tokens: string[]): string | null {
  for (const token of tokens) {
    const province = PROVINCE_ALIASES[cleanToken(token)];
    if (province) return province;
  }
  return null;
}

function provinceByCityToken(base: string, raw: string): string | null {
  if (!base) return null;

  if (base === "강서" && /부산|부산시|부산광역시/u.test(raw)) return "부산";
  if (base === "강서") return "서울";
  if (base === "중" && /서울/u.test(raw)) return "서울";

  const compositeCandidates = [
    `${base}구부산`,
    `${base}구인천`,
    `${base}구광주`,
    `${base}구대전`,
    `${base}구울산`,
    `${base}부산`,
    `${base}인천`,
    `${base}광주`,
    `${base}대전`,
    `${base}울산`,
    `${base}경기`,
    `${base}강원`,
    `${base}충북`,
    `${base}충남`,
    `${base}전북`,
    `${base}전남`,
    `${base}경북`,
    `${base}경남`,
  ];

  for (const key of compositeCandidates) {
    if (PROVINCE_BY_CITY[key]) return PROVINCE_BY_CITY[key];
  }

  return PROVINCE_BY_CITY[base] ?? null;
}

function normalizeCityToken(token: string, raw: string, provinceHint: string | null): string | null {
  const cleaned = cleanToken(token);
  if (!cleaned) return null;

  if (PROVINCE_ALIASES[cleaned]) return PROVINCE_ALIASES[cleaned];
  if (CITY_ALIASES[cleaned]) return CITY_ALIASES[cleaned];

  const base = stripAdminSuffix(cleaned);
  if (!base || base.length < 2) return null;

  if (CITY_ALIASES[base]) return CITY_ALIASES[base];
  if (SEOUL_DISTRICTS.has(base)) return "서울";
  if (provinceHint && METRO_PROVINCES.has(provinceHint) && cleaned.endsWith("구")) return provinceHint;

  return base;
}

export function extractProvinceFromRegion(region: string | null): string | null {
  const raw = (region ?? "").trim();
  if (!raw) return null;

  const tokens = tokenizeRegion(raw);
  if (tokens.length === 0) return null;

  const provinceHint = findProvinceHint(tokens);
  if (provinceHint) return CANONICAL_PROVINCES.has(provinceHint) ? provinceHint : null;

  for (const token of tokens) {
    const city = normalizeCityToken(token, raw, null);
    if (!city) continue;
    const byCity = provinceByCityToken(city, raw);
    if (byCity) return CANONICAL_PROVINCES.has(byCity) ? byCity : null;
    if (PROVINCE_ALIASES[city]) {
      const normalized = PROVINCE_ALIASES[city];
      return CANONICAL_PROVINCES.has(normalized) ? normalized : null;
    }
  }

  return null;
}

export function extractCityFromRegion(region: string | null): string | null {
  const raw = (region ?? "").trim();
  if (!raw) return null;

  const tokens = tokenizeRegion(raw);
  if (tokens.length === 0) return null;

  const provinceHint = findProvinceHint(tokens);
  if (provinceHint && METRO_PROVINCES.has(provinceHint)) return provinceHint;

  if (provinceHint) {
    const provinceTokenIdx = tokens.findIndex((token) => PROVINCE_ALIASES[cleanToken(token)] === provinceHint);
    if (provinceTokenIdx >= 0) {
      const nextToken = tokens[provinceTokenIdx + 1];
      const normalized = normalizeCityToken(nextToken ?? "", raw, provinceHint);
      if (normalized) return normalized;
    }
  }

  for (const token of tokens) {
    const normalized = normalizeCityToken(token, raw, provinceHint);
    if (!normalized) continue;
    if (PROVINCE_ALIASES[normalized]) continue;
    return normalized;
  }

  return provinceHint;
}


