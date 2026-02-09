"use client";

import { useEffect, useMemo, useState } from "react";
import AdSlot from "@/components/AdSlot";
import CoupangNotice from "@/components/CoupangNotice";
import {
  getItems,
  filterByCategory,
  sortItems,
  getRankBadge,
  type SnackItem,
  type SnackCategory,
  type SnackSortKey,
} from "@/lib/snacks";

const TABS: { key: SnackCategory; label: string }[] = [
  { key: "snack", label: "간식" },
  { key: "protein", label: "프로틴" },
];

export default function SnacksPage() {
  const [allItems, setAllItems] = useState<SnackItem[]>([]);
  const [tab, setTab] = useState<SnackCategory>("snack");
  const [sort, setSort] = useState<SnackSortKey>("taste");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    getItems().then((items) => {
      setAllItems(items);
      setMounted(true);
    });
  }, []);

  const displayed = useMemo(() => {
    const filtered = filterByCategory(allItems, tab);
    return sortItems(filtered, sort);
  }, [allItems, tab, sort]);

  if (!mounted) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-10">
        <p className="text-neutral-400 text-center">로딩 중...</p>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-neutral-900 mb-1">
        다이어트 간식
      </h1>
      <p className="text-sm text-neutral-500 mb-6">
        프로틴바 맛있는 순 랭킹 & 프로틴 보충제 추천 목록
      </p>

      {/* 탭 */}
      <div className="flex rounded-xl border border-neutral-300 overflow-hidden mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex-1 h-11 text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-emerald-600 text-white"
                : "bg-white text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 정렬 */}
      <div className="flex items-center gap-2 mb-5">
        <label htmlFor="snack-sort" className="text-xs text-neutral-500">
          정렬:
        </label>
        <select
          id="snack-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as SnackSortKey)}
          className="text-xs border border-neutral-200 rounded-lg px-2 py-1 bg-white text-neutral-700 focus:outline-none"
        >
          <option value="taste">맛있는 순</option>
          <option value="price">가격순</option>
        </select>
        <span className="text-xs text-neutral-400 ml-auto">
          {displayed.length}개 상품
        </span>
      </div>

      {/* 상품 목록 */}
      {displayed.length === 0 ? (
        <p className="text-neutral-400 text-center py-10">
          등록된 상품이 없습니다.
        </p>
      ) : (
        <div className="space-y-3">
          {displayed.map((item) => {
            const badge = getRankBadge(item.tasteRank);
            return (
              <div
                key={item.id}
                className="rounded-2xl bg-white border border-neutral-200 p-4 hover:border-neutral-300 transition-colors relative"
              >
                {/* 랭킹 뱃지 */}
                {badge && (
                  <span className="absolute -top-2 -right-2 bg-amber-100 text-amber-800 text-xs font-bold px-2.5 py-1 rounded-full border border-amber-200 shadow-sm">
                    {badge}
                  </span>
                )}

                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-neutral-900 text-sm pr-8">
                      {item.name}
                    </h3>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      {item.brand}
                    </p>
                    <p className="text-sm font-medium text-blue-700 mt-1">
                      {item.price > 0 ? item.priceText : "가격 확인"}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {item.tags.map((tag) => (
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
                  {item.links.coupang && (
                    <a
                      href={item.links.coupang}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-center py-2 rounded-lg bg-red-50 text-red-700 text-xs font-medium hover:bg-red-100 transition-colors"
                    >
                      쿠팡에서 보기
                    </a>
                  )}
                  {item.links.naver && (
                    <a
                      href={item.links.naver}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-center py-2 rounded-lg bg-green-50 text-green-700 text-xs font-medium hover:bg-green-100 transition-colors"
                    >
                      네이버
                    </a>
                  )}
                  {item.links.official && (
                    <a
                      href={item.links.official}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-center py-2 rounded-lg bg-neutral-50 text-neutral-700 text-xs font-medium hover:bg-neutral-100 transition-colors"
                    >
                      공식몰
                    </a>
                  )}
                </div>

                <p className="text-xs text-neutral-300 mt-2 text-right">
                  업데이트: {item.updatedAt}
                </p>
              </div>
            );
          })}
        </div>
      )}

      <AdSlot slotId="snacks-list" className="mt-6" />

      {/* 쿠팡 파트너스 고지문 */}
      <CoupangNotice className="mt-6" />
    </main>
  );
}
