const PROVINCE_ALIASES: Record<string, string> = {
  "\uC11C\uC6B8": "\uC11C\uC6B8",
  "\uC11C\uC6B8\uC2DC": "\uC11C\uC6B8",
  "\uC11C\uC6B8\uD2B9\uBCC4\uC2DC": "\uC11C\uC6B8",
  "\uBD80\uC0B0": "\uBD80\uC0B0",
  "\uBD80\uC0B0\uC2DC": "\uBD80\uC0B0",
  "\uBD80\uC0B0\uAD11\uC5ED\uC2DC": "\uBD80\uC0B0",
  "\uB300\uAD6C": "\uB300\uAD6C",
  "\uB300\uAD6C\uC2DC": "\uB300\uAD6C",
  "\uB300\uAD6C\uAD11\uC5ED\uC2DC": "\uB300\uAD6C",
  "\uC778\uCC9C": "\uC778\uCC9C",
  "\uC778\uCC9C\uC2DC": "\uC778\uCC9C",
  "\uC778\uCC9C\uAD11\uC5ED\uC2DC": "\uC778\uCC9C",
  "\uAD11\uC8FC": "\uAD11\uC8FC",
  "\uAD11\uC8FC\uC2DC": "\uAD11\uC8FC",
  "\uAD11\uC8FC\uAD11\uC5ED\uC2DC": "\uAD11\uC8FC",
  "\uB300\uC804": "\uB300\uC804",
  "\uB300\uC804\uC2DC": "\uB300\uC804",
  "\uB300\uC804\uAD11\uC5ED\uC2DC": "\uB300\uC804",
  "\uC6B8\uC0B0": "\uC6B8\uC0B0",
  "\uC6B8\uC0B0\uC2DC": "\uC6B8\uC0B0",
  "\uC6B8\uC0B0\uAD11\uC5ED\uC2DC": "\uC6B8\uC0B0",
  "\uC138\uC885": "\uC138\uC885",
  "\uC138\uC885\uC2DC": "\uC138\uC885",
  "\uC138\uC885\uD2B9\uBCC4\uC790\uCE58\uC2DC": "\uC138\uC885",
  "\uACBD\uAE30": "\uACBD\uAE30",
  "\uACBD\uAE30\uB3C4": "\uACBD\uAE30",
  "\uAC15\uC6D0": "\uAC15\uC6D0",
  "\uAC15\uC6D0\uB3C4": "\uAC15\uC6D0",
  "\uCDA9\uBD81": "\uCDA9\uBD81",
  "\uCDA9\uCCAD\uBD81\uB3C4": "\uCDA9\uBD81",
  "\uCDA9\uB0A8": "\uCDA9\uB0A8",
  "\uCDA9\uCCAD\uB0A8\uB3C4": "\uCDA9\uB0A8",
  "\uC804\uBD81": "\uC804\uBD81",
  "\uC804\uB77C\uBD81\uB3C4": "\uC804\uBD81",
  "\uC804\uB0A8": "\uC804\uB0A8",
  "\uC804\uB77C\uB0A8\uB3C4": "\uC804\uB0A8",
  "\uACBD\uBD81": "\uACBD\uBD81",
  "\uACBD\uC0C1\uBD81\uB3C4": "\uACBD\uBD81",
  "\uACBD\uB0A8": "\uACBD\uB0A8",
  "\uACBD\uC0C1\uB0A8\uB3C4": "\uACBD\uB0A8",
  "\uC81C\uC8FC": "\uC81C\uC8FC",
  "\uC81C\uC8FC\uB3C4": "\uC81C\uC8FC",
  "\uC81C\uC8FC\uD2B9\uBCC4\uC790\uCE58\uB3C4": "\uC81C\uC8FC",
};

const METRO_PROVINCES = new Set([
  "\uC11C\uC6B8",
  "\uBD80\uC0B0",
  "\uB300\uAD6C",
  "\uC778\uCC9C",
  "\uAD11\uC8FC",
  "\uB300\uC804",
  "\uC6B8\uC0B0",
  "\uC138\uC885",
  "\uC81C\uC8FC",
]);

const CITY_ALIASES: Record<string, string> = {
  "\uB3D9\uD0C4": "\uD654\uC131",
  "\uC77C\uC0B0": "\uACE0\uC591",
  "\uBD84\uB2F9": "\uC131\uB0A8",
  "\uD310\uAD50": "\uC131\uB0A8",
  "\uC704\uB840": "\uC131\uB0A8",
  "\uC1A1\uB3C4": "\uC778\uCC9C",
  "\uC601\uC885": "\uC778\uCC9C",
  "\uAC80\uB2E8": "\uC778\uCC9C",
  "\uACBD\uAE30\uBD81\uBD80": "\uACBD\uAE30",
};

const SEOUL_DISTRICTS = new Set([
  "\uAC15\uB0A8",
  "\uAC15\uB3D9",
  "\uAC15\uBD81",
  "\uAC15\uC11C",
  "\uAD00\uC545",
  "\uAD11\uC9C4",
  "\uAD6C\uB85C",
  "\uAE08\uCC9C",
  "\uB178\uC6D0",
  "\uB3C4\uBD09",
  "\uB3D9\uB300\uBB38",
  "\uB3D9\uC791",
  "\uB9C8\uD3EC",
  "\uC11C\uB300\uBB38",
  "\uC11C\uCD08",
  "\uC131\uB3D9",
  "\uC131\uBD81",
  "\uC1A1\uD30C",
  "\uC591\uCC9C",
  "\uC601\uB4F1\uD3EC",
  "\uC6A9\uC0B0",
  "\uC740\uD3C9",
  "\uC885\uB85C",
  "\uC911",
  "\uC911\uB791",
]);

const PROVINCE_KEYS_DESC = Object.keys(PROVINCE_ALIASES).sort((a, b) => b.length - a.length);

function cleanToken(token: string): string {
  return token.trim().replace(/[()]/g, "").replace(/[^0-9A-Za-z\uAC00-\uD7A3]/g, "");
}

function stripAdminSuffix(token: string): string {
  return token.replace(/(\uD2B9\uBCC4\uC790\uCE58\uC2DC|\uD2B9\uBCC4\uC790\uCE58\uB3C4|\uD2B9\uBCC4\uC2DC|\uAD11\uC5ED\uC2DC|\uC790\uCE58\uC2DC|\uC790\uCE58\uB3C4|\uC2DC|\uAD70|\uAD6C|\uC74D|\uBA74|\uB3D9|\uB9AC)$/u, "");
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

function normalizeCityToken(token: string, raw: string, provinceHint: string | null): string | null {
  const cleaned = cleanToken(token);
  if (!cleaned) return null;

  if (PROVINCE_ALIASES[cleaned]) return PROVINCE_ALIASES[cleaned];
  if (CITY_ALIASES[cleaned]) return CITY_ALIASES[cleaned];

  const base = stripAdminSuffix(cleaned);
  if (!base || base.length < 2) return null;
  if (CITY_ALIASES[base]) return CITY_ALIASES[base];
  if (SEOUL_DISTRICTS.has(base)) return "\uC11C\uC6B8";
  if (base === "\uAC15\uC11C" && /\uBD80\uC0B0|\uBD80\uC0B0\uC2DC|\uBD80\uC0B0\uAD11\uC5ED\uC2DC/u.test(raw)) return "\uBD80\uC0B0";
  if (provinceHint && METRO_PROVINCES.has(provinceHint) && cleaned.endsWith("\uAD6C")) return provinceHint;
  return base;
}

export function extractProvinceFromRegion(region: string | null): string | null {
  const raw = (region ?? "").trim();
  if (!raw) return null;

  const tokens = tokenizeRegion(raw);
  if (tokens.length === 0) return null;

  const provinceHint = findProvinceHint(tokens);
  if (provinceHint) return provinceHint;

  const fallback = normalizeCityToken(tokens[0], raw, null);
  if (!fallback) return null;
  return PROVINCE_ALIASES[fallback] ?? fallback;
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
