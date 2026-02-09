"use client";

import { useEffect, useMemo, useState } from "react";
import AdSlot from "@/components/AdSlot";
import {
  filterProducts,
  sortProducts,
  PROTEIN_TAGS,
  type ProteinProduct,
  type SortOption,
} from "@/lib/protein";

export default function ProteinPage() {
  const [products, setProducts] = useState<ProteinProduct[]>([]);
  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sort, setSort] = useState<SortOption>("latest");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    import("@/data/protein.json").then((mod) => {
      setProducts(mod.default as ProteinProduct[]);
      setMounted(true);
    });
  }, []);

  const filtered = useMemo(() => {
    const f = filterProducts(products, query, selectedTags);
    return sortProducts(f, sort);
  }, [products, query, selectedTags, sort]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  if (!mounted) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-10">
        <p className="text-neutral-400 text-center">로딩 중...</p>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-neutral-900 mb-1">프로틴 추천</h1>
      <p className="text-sm text-neutral-500 mb-6">
        인기 프로틴 보충제 가격 참고 & 추천 목록입니다.
      </p>

      {/* 검색 */}
      <div className="mb-4">
        <label htmlFor="protein-search" className="sr-only">상품 검색</label>
        <input
          id="protein-search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="상품명 또는 브랜드 검색..."
          className="w-full h-12 rounded-xl border border-neutral-300 bg-white px-4 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* 태그 필터 */}
      <div className="flex flex-wrap gap-2 mb-4">
        {PROTEIN_TAGS.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => toggleTag(tag)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              selectedTags.includes(tag)
                ? "bg-blue-600 text-white"
                : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
            }`}
          >
            {tag}
          </button>
        ))}
      </div>

      {/* 정렬 */}
      <div className="flex items-center gap-2 mb-5">
        <label htmlFor="sort" className="text-xs text-neutral-500">정렬:</label>
        <select
          id="sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOption)}
          className="text-xs border border-neutral-200 rounded-lg px-2 py-1 bg-white text-neutral-700 focus:outline-none"
        >
          <option value="latest">최신 업데이트순</option>
          <option value="name">이름순</option>
        </select>
        <span className="text-xs text-neutral-400 ml-auto">
          {filtered.length}개 상품
        </span>
      </div>

      {/* 상품 목록 */}
      {filtered.length === 0 ? (
        <p className="text-neutral-400 text-center py-10">
          조건에 맞는 상품이 없습니다.
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => (
            <div
              key={p.id}
              className="rounded-2xl bg-white border border-neutral-200 p-4 hover:border-neutral-300 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-neutral-900 text-sm">
                    {p.name}
                  </h3>
                  <p className="text-xs text-neutral-500 mt-0.5">{p.brand}</p>
                  <p className="text-sm font-medium text-blue-700 mt-1">
                    {p.priceText}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {p.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-xs"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* 외부 링크 */}
              <div className="flex gap-2 mt-3 pt-3 border-t border-neutral-100">
                {p.links.coupang && (
                  <a
                    href={p.links.coupang}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="flex-1 text-center py-2 rounded-lg bg-red-50 text-red-700 text-xs font-medium hover:bg-red-100 transition-colors"
                  >
                    쿠팡
                  </a>
                )}
                {p.links.naver && (
                  <a
                    href={p.links.naver}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="flex-1 text-center py-2 rounded-lg bg-green-50 text-green-700 text-xs font-medium hover:bg-green-100 transition-colors"
                  >
                    네이버
                  </a>
                )}
                {p.links.official && (
                  <a
                    href={p.links.official}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="flex-1 text-center py-2 rounded-lg bg-neutral-50 text-neutral-700 text-xs font-medium hover:bg-neutral-100 transition-colors"
                  >
                    공식몰
                  </a>
                )}
              </div>

              <p className="text-xs text-neutral-300 mt-2 text-right">
                업데이트: {p.updatedAt}
              </p>
            </div>
          ))}
        </div>
      )}

      <AdSlot slotId="protein-list" className="mt-6" />

      {/* 고지문 */}
      <p className="text-xs text-neutral-400 text-center mt-6 leading-relaxed">
        가격은 참고용이며 실제와 다를 수 있습니다. 본 페이지는 제휴/광고 링크를
        포함할 수 있으며, 이를 통해 일정액의 수수료를 제공받을 수 있습니다.
      </p>
    </main>
  );
}
