import { KOREA_ADMIN_DIVISION_COORDS } from "@/lib/korea-admin-division-coords";
import { extractProvinceFromRegion } from "@/lib/region-city";

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
  return value.replace(/(특별자치시|특별자치도|특별시|광역시|자치시|자치도|시|군|구|읍|면|동|리)$/u, "");
}

const DIVISION_ROWS: DivisionRow[] = KOREA_ADMIN_DIVISION_COORDS.map(([province, city, longitude, latitude]) => ({
  province,
  city,
  longitude,
  latitude,
}));

const DIVISION_LOOKUP = new Map<string, DivisionRow>();
const PROVINCE_CENTROIDS = new Map<string, RegionCoordinate>();

for (const row of DIVISION_ROWS) {
  const rawKey = `${row.province}:${normalizeLookupKey(row.city)}`;
  const strippedKey = `${row.province}:${normalizeLookupKey(stripAdminSuffix(row.city))}`;
  DIVISION_LOOKUP.set(rawKey, row);
  DIVISION_LOOKUP.set(strippedKey, row);
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

function buildCandidateKeys(region: string, province: string | null): string[] {
  const raw = String(region ?? "").trim();
  if (!raw) return [];

  const withoutSpaces = raw.replace(/\s+/g, "");
  const parts = withoutSpaces.split(/[,\-/·]/).filter(Boolean);
  const keys = new Set<string>();

  const pushKey = (value: string) => {
    const normalized = normalizeLookupKey(value);
    if (normalized) keys.add(normalized);
    const stripped = normalizeLookupKey(stripAdminSuffix(value));
    if (stripped) keys.add(stripped);
  };

  pushKey(raw);
  pushKey(withoutSpaces);

  for (const part of parts) {
    pushKey(part);
  }

  if (province) {
    pushKey(raw.replace(province, ""));
    pushKey(withoutSpaces.replace(province, ""));
  }

  return [...keys];
}

export function getRegionCoordinate(region: string | null): RegionCoordinate | null {
  const raw = (region ?? "").trim();
  if (!raw) return null;

  const province = extractProvinceFromRegion(raw);
  if (!province) return null;

  const candidateKeys = buildCandidateKeys(raw, province);
  for (const key of candidateKeys) {
    const row = DIVISION_LOOKUP.get(`${province}:${key}`);
    if (!row) continue;
    return {
      province,
      city: row.city,
      longitude: row.longitude,
      latitude: row.latitude,
      precision: "city",
    };
  }

  return PROVINCE_CENTROIDS.get(province) ?? null;
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
