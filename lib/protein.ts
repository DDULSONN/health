/**
 * 프로틴 데이터 로딩 (JSON 기반 MVP)
 * 나중에 쿠팡 파트너스 API로 교체 가능하도록 인터페이스 분리
 */

export interface ProteinProduct {
  id: string;
  name: string;
  brand: string;
  priceText: string;
  tags: string[];
  imageUrl?: string;
  links: {
    coupang?: string;
    naver?: string;
    official?: string;
  };
  updatedAt: string;
}

/** 태그 목록 (필터용) */
export const PROTEIN_TAGS = [
  "WPC",
  "WPI",
  "게이너",
  "가성비",
  "저당",
  "대용량",
  "식물성",
  "맛있는",
] as const;

/** JSON에서 데이터 로딩 */
export async function loadProteinProducts(): Promise<ProteinProduct[]> {
  // 서버 사이드에서는 직접 import, 클라이언트에서는 fetch
  try {
    const data = await import("@/data/protein.json");
    return data.default as ProteinProduct[];
  } catch {
    return [];
  }
}

/** 검색 필터 */
export function filterProducts(
  products: ProteinProduct[],
  query: string,
  selectedTags: string[]
): ProteinProduct[] {
  let filtered = products;

  if (query.trim()) {
    const q = query.trim().toLowerCase();
    filtered = filtered.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q)
    );
  }

  if (selectedTags.length > 0) {
    filtered = filtered.filter((p) =>
      selectedTags.some((tag) => p.tags.includes(tag))
    );
  }

  return filtered;
}

/** 정렬 */
export type SortOption = "latest" | "name";

export function sortProducts(
  products: ProteinProduct[],
  sort: SortOption
): ProteinProduct[] {
  const sorted = [...products];
  if (sort === "latest") {
    sorted.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  } else if (sort === "name") {
    sorted.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }
  return sorted;
}
