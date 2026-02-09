/**
 * 다이어트 간식 데이터 로딩, 필터링, 정렬 로직
 * JSON 기반 MVP — 나중에 API 교체 가능하도록 인터페이스 분리
 */

export type SnackCategory = "snack" | "protein";
export type SnackSortKey = "taste" | "price";

export interface SnackItem {
  id: string;
  name: string;
  brand: string;
  price: number;         // KRW 정렬용 (0이면 가격 미정)
  priceText: string;     // 표시용
  tasteRank: number;     // 1이 1위, 9999이면 미지정
  tags: string[];
  category: SnackCategory;
  imageUrl?: string;
  links: {
    coupang?: string;
    naver?: string;
    official?: string;
  };
  updatedAt: string;
}

/** raw JSON → SnackItem 변환 (하위호환) */
function normalize(raw: Record<string, unknown>): SnackItem {
  const priceText = (raw.priceText as string) ?? "가격 확인";

  // price가 없으면 priceText에서 파싱 시도
  let price = typeof raw.price === "number" ? (raw.price as number) : 0;
  if (price === 0 && priceText) {
    const match = priceText.replace(/,/g, "").match(/(\d{3,})/);
    if (match) price = parseInt(match[1], 10);
  }

  return {
    id: raw.id as string,
    name: raw.name as string,
    brand: raw.brand as string,
    price,
    priceText,
    tasteRank: typeof raw.tasteRank === "number" ? (raw.tasteRank as number) : 9999,
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
    category: (raw.category as SnackCategory) ?? "protein",
    imageUrl: raw.imageUrl as string | undefined,
    links: (raw.links as SnackItem["links"]) ?? {},
    updatedAt: (raw.updatedAt as string) ?? "",
  };
}

/** JSON 로드 + 정규화 */
export async function getItems(): Promise<SnackItem[]> {
  try {
    const mod = await import("@/data/snacks.json");
    const arr = mod.default as Record<string, unknown>[];
    return arr.map(normalize);
  } catch {
    return [];
  }
}

/** 카테고리 필터 */
export function filterByCategory(
  items: SnackItem[],
  category: SnackCategory
): SnackItem[] {
  return items.filter((i) => i.category === category);
}

/**
 * 정렬
 * - taste: tasteRank 오름차순 (9999는 맨 뒤)
 * - price: price 오름차순 (0은 "가격 미정"으로 맨 뒤), tie-breaker tasteRank
 */
export function sortItems(
  items: SnackItem[],
  sortKey: SnackSortKey
): SnackItem[] {
  const sorted = [...items];

  if (sortKey === "taste") {
    sorted.sort((a, b) => a.tasteRank - b.tasteRank);
  } else {
    // price 오름차순, price=0은 맨 뒤
    sorted.sort((a, b) => {
      const pa = a.price || Number.MAX_SAFE_INTEGER;
      const pb = b.price || Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      return a.tasteRank - b.tasteRank;
    });
  }

  return sorted;
}

/** 랭킹 뱃지 텍스트 */
export function getRankBadge(rank: number): string | null {
  if (rank >= 9999) return null;
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `#${rank}`;
}
