import { KOREA_ADMIN_DIVISION_COORDS } from "@/lib/korea-admin-division-coords";
import { extractProvinceFromRegion, readRegionProvincePrefix } from "@/lib/region-city";

type RegionCoordinate = {
  province: string;
  city: string | null;
  longitude: number;
  latitude: number;
  precision: "city" | "province";
};

type RegionDistanceMeta = {
  sameRegion: boolean;
  sameProvince: boolean;
  distanceKm: number | null;
  source: RegionCoordinate | null;
  candidate: RegionCoordinate | null;
};

type DivisionRow = {
  province: string;
  city: string;
  longitude: number;
  latitude: number;
};

function normalizeLookupKey(value: string | null): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[()]/g, "")
    .replace(/[^0-9A-Za-z가-힣]/g, "")
    .toLowerCase();
}

function stripAdminSuffix(value: string): string {
  return value.replace(/(특별자치시|특별자치도|특별시|광역시|자치시|자치도|시|도|군|구|읍|면|동|리)$/u, "");
}

function normalizeDivisionProvince(province: string, city: string): string {
  // The legacy dataset groups both 경북/경남 under 경상. Do not overwrite 강원 고성군.
  if (province === "경상" && city === "고성군") return "경남";
  return extractProvinceFromRegion(province) ?? extractProvinceFromRegion(city) ?? province;
}

const DIVISION_ROWS: DivisionRow[] = KOREA_ADMIN_DIVISION_COORDS
  // Invalid legacy duplicate: 전라/광주시 has 경기 coordinates. Both real regions already have valid rows.
  .filter(([province, city]) => !(province === "전라" && city === "광주시"))
  .map(([province, city, longitude, latitude]) => ({
    province: normalizeDivisionProvince(province, city),
    city,
    longitude,
    latitude,
  }));

const DIVISION_LOOKUP = new Map<string, DivisionRow>();
const DIVISION_PROVINCES = new Map<string, Set<string>>();
const PROVINCE_CENTROIDS = new Map<string, RegionCoordinate>();
const PROVINCE_REFERENCE_COORDS: Record<string, [number, number]> = {
  서울: [126.978, 37.5665],
  부산: [129.0756, 35.1796],
  대구: [128.6014, 35.8714],
  인천: [126.7052, 37.4563],
  광주: [126.8526, 35.1595],
  대전: [127.3845, 36.3504],
  울산: [129.3114, 35.5384],
  세종: [127.289, 36.48],
  경기: [127.0095, 37.2749],
  강원: [127.7298, 37.8854],
  충북: [127.4913, 36.6357],
  충남: [126.6728, 36.6588],
  전북: [127.1088, 35.8202],
  전남: [126.4629, 34.8161],
  경북: [128.5058, 36.576],
  경남: [128.6918, 35.2383],
  제주: [126.4983, 33.4889],
};

for (const row of DIVISION_ROWS) {
  if (!PROVINCE_REFERENCE_COORDS[row.province]) continue;
  const rawKey = `${row.province}:${normalizeLookupKey(row.city)}`;
  const strippedKey = `${row.province}:${normalizeLookupKey(stripAdminSuffix(row.city))}`;
  DIVISION_LOOKUP.set(rawKey, row);
  DIVISION_LOOKUP.set(strippedKey, row);
  for (const key of [normalizeLookupKey(row.city), normalizeLookupKey(stripAdminSuffix(row.city))]) {
    const provinces = DIVISION_PROVINCES.get(key) ?? new Set<string>();
    provinces.add(row.province);
    DIVISION_PROVINCES.set(key, provinces);
  }
}

for (const province of [...new Set(DIVISION_ROWS.map((row) => row.province))]) {
  const rows = DIVISION_ROWS.filter((row) => row.province === province);
  const longitude = rows.reduce((sum, row) => sum + row.longitude, 0) / rows.length;
  const latitude = rows.reduce((sum, row) => sum + row.latitude, 0) / rows.length;
  PROVINCE_CENTROIDS.set(province, {
    province,
    city: null,
    longitude,
    latitude,
    precision: "province",
  });
}

// These district/new-town names resolve only to their existing parent city coordinate.
// Do not infer a precise coordinate for broad or overlapping areas such as 수도권/위례.
const CITY_COORDINATE_ALIASES: Record<string, string> = {
  분당: "성남시", 분당구: "성남시", 판교: "성남시", 동탄: "화성시", 일산: "고양시",
};

const UNIQUE_DIVISIONS = [...new Set(DIVISION_LOOKUP.values())];

function findDivision(value: string, province: string | null): DivisionRow | null {
  const key = normalizeLookupKey(value);
  if (!key) return null;
  const cityKey = CITY_COORDINATE_ALIASES[key] ?? key;
  if (province) {
    // 부산 진구 / 부산광역시 진구 are common shorthand for 부산진구.
    const exact = DIVISION_LOOKUP.get(`${province}:${cityKey}`) ?? DIVISION_LOOKUP.get(`${province}:${province}${cityKey}`);
    if (exact) return exact;
  } else {
    const provinces = DIVISION_PROVINCES.get(cityKey);
    if (provinces?.size === 1) return DIVISION_LOOKUP.get(`${[...provinces][0]}:${cityKey}`) ?? null;
  }
  // Support 성남시분당구 / 서울강남구역삼동, without substring matches such as 광주 in 광주시민.
  const matches = UNIQUE_DIVISIONS.filter((row) => (!province || row.province === province)
    && key.startsWith(row.city) && /^[가-힣]+(?:구|읍|면|동|리)$/u.test(key.slice(row.city.length)));
  return matches.length === 1 ? matches[0] : null;
}

// Do not silently change the recommendation policy for existing free-form/multi-
// location profiles. Until a primary/multiple-location policy is chosen, retain
// their previous lookup/fallback instead of newly demoting them to unknown areas.
function getLegacyRegionCoordinate(raw: string): RegionCoordinate | null {
  const province = extractProvinceFromRegion(raw);
  if (!province) return null;
  const compact = raw.replace(/\s+/g, "");
  const values = [raw, compact, ...compact.split(/[,\-/·]/).filter(Boolean), raw.replace(province, ""), compact.replace(province, "")];
  for (const value of values) {
    for (const key of [normalizeLookupKey(value), normalizeLookupKey(stripAdminSuffix(value))]) {
      const row = DIVISION_LOOKUP.get(`${province}:${key}`);
      if (row) return { ...row, precision: "city" };
    }
  }
  return PROVINCE_CENTROIDS.get(province) ?? null;
}

export function getRegionCoordinate(region: string | null): RegionCoordinate | null {
  const raw = (region ?? "").trim();
  if (!raw) return null;

  const prefix = readRegionProvincePrefix(raw);
  const reference = prefix && !prefix.rest ? PROVINCE_REFERENCE_COORDS[prefix.province] : null;
  if (prefix && reference) {
    return {
      province: prefix.province,
      city: null,
      longitude: reference[0],
      latitude: reference[1],
      precision: "province",
    };
  }

  const provinces = new Set<string>();
  const cities = new Map<string, DivisionRow>();
  let context: string | null = null;
  const addCity = (row: DivisionRow) => {
    provinces.add(row.province);
    cities.set(`${row.province}:${row.city}`, row);
    context = row.province;
  };
  const parts = raw.replace(/[()]/g, " ").split(/[\s,\\/·&|\-]+/u).filter(Boolean);
  for (const part of parts) {
    // An explicit province disambiguates 경기 광주시 / 광주광역시 and both 고성군s.
    const local = context ? findDivision(part, context) : null;
    if (local) { addCity(local); continue; }
    const partPrefix = readRegionProvincePrefix(part);
    const standalone = !partPrefix || (partPrefix.rest && DIVISION_PROVINCES.has(normalizeLookupKey(part)))
      ? findDivision(part, null) : null;
    if (standalone) { addCity(standalone); continue; }
    if (partPrefix) {
      context = partPrefix.province;
      provinces.add(context);
      if (partPrefix.rest) {
        const row = findDivision(partPrefix.rest, context);
        if (row) addCity(row);
      }
    }
  }
  if (provinces.size !== 1 || cities.size > 1) return getLegacyRegionCoordinate(raw);
  const province = [...provinces][0];
  if (cities.size === 1) {
    const row = [...cities.values()][0];
    return {
      province,
      city: row.city,
      longitude: row.longitude,
      latitude: row.latitude,
      precision: "city",
    };
  }

  return getLegacyRegionCoordinate(raw);
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function haversineKm(a: RegionCoordinate, b: RegionCoordinate): number {
  const earthRadiusKm = 6371;
  const latDiff = toRadians(b.latitude - a.latitude);
  const lonDiff = toRadians(b.longitude - a.longitude);
  const sinLat = Math.sin(latDiff / 2);
  const sinLon = Math.sin(lonDiff / 2);
  const aa =
    sinLat * sinLat +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * sinLon * sinLon;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return earthRadiusKm * c;
}

export function getRegionDistanceMeta(sourceRegion: string | null, candidateRegion: string | null): RegionDistanceMeta {
  const sourceKey = normalizeLookupKey(sourceRegion);
  const candidateKey = normalizeLookupKey(candidateRegion);
  const source = getRegionCoordinate(sourceRegion);
  const candidate = getRegionCoordinate(candidateRegion);
  const sameProvince = Boolean(source?.province && candidate?.province && source.province === candidate.province);

  return {
    sameRegion: sourceKey.length > 0 && sourceKey === candidateKey,
    sameProvince,
    distanceKm: source && candidate ? haversineKm(source, candidate) : null,
    source,
    candidate,
  };
}

export function compareRegionsByDistance(sourceRegion: string | null, aRegion: string | null, bRegion: string | null): number {
  const aMeta = getRegionDistanceMeta(sourceRegion, aRegion);
  const bMeta = getRegionDistanceMeta(sourceRegion, bRegion);

  if (aMeta.sameRegion !== bMeta.sameRegion) {
    return aMeta.sameRegion ? -1 : 1;
  }
  if (aMeta.sameProvince !== bMeta.sameProvince) {
    return aMeta.sameProvince ? -1 : 1;
  }
  if (aMeta.distanceKm != null && bMeta.distanceKm != null && aMeta.distanceKm !== bMeta.distanceKm) {
    return aMeta.distanceKm - bMeta.distanceKm;
  }
  if (aMeta.distanceKm != null && bMeta.distanceKm == null) return -1;
  if (aMeta.distanceKm == null && bMeta.distanceKm != null) return 1;
  return 0;
}
