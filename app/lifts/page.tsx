"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import {
  calculateLifts,
  buildLiftsShareUrl,
  type LiftInput,
} from "@/lib/lifts";
import type { WeightUnit } from "@/lib/oneRm";

const STORAGE_KEY = "gymtools_lifts";

function LiftsContent() {
  const searchParams = useSearchParams();

  const [squat, setSquat] = useState("");
  const [bench, setBench] = useState("");
  const [deadlift, setDeadlift] = useState("");
  const [bodyweight, setBodyweight] = useState("");
  const [unit, setUnit] = useState<WeightUnit>("kg");
  const [mounted, setMounted] = useState(false);
  const [shareStatus, setShareStatus] = useState<"idle" | "copied">("idle");

  // URL 쿼리 또는 localStorage에서 복원
  useEffect(() => {
    const qS = searchParams.get("s");
    const qB = searchParams.get("b");
    const qD = searchParams.get("d");
    const qBw = searchParams.get("bw");
    const qUnit = searchParams.get("unit") as WeightUnit | null;

    if (qS && qB && qD) {
      setSquat(qS);
      setBench(qB);
      setDeadlift(qD);
      if (qBw) setBodyweight(qBw);
      if (qUnit === "kg" || qUnit === "lb") setUnit(qUnit);
    } else {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const data = JSON.parse(saved);
          if (data.squat) setSquat(String(data.squat));
          if (data.bench) setBench(String(data.bench));
          if (data.deadlift) setDeadlift(String(data.deadlift));
          if (data.bodyweight) setBodyweight(String(data.bodyweight));
          if (data.unit) setUnit(data.unit);
        }
      } catch { /* ignore */ }
    }
    setMounted(true);
  }, [searchParams]);

  // localStorage 저장
  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          squat: Number(squat),
          bench: Number(bench),
          deadlift: Number(deadlift),
          bodyweight: Number(bodyweight),
          unit,
        })
      );
    } catch { /* ignore */ }
  }, [squat, bench, deadlift, bodyweight, unit, mounted]);

  const s = Number(squat) || 0;
  const b = Number(bench) || 0;
  const d = Number(deadlift) || 0;
  const bw = Number(bodyweight) || 0;

  const input: LiftInput = useMemo(
    () => ({ squat: s, bench: b, deadlift: d, bodyweight: bw, unit }),
    [s, b, d, bw, unit]
  );
  const result = useMemo(() => calculateLifts(input), [input]);

  const hasResult = s > 0 || b > 0 || d > 0;

  const handleShare = useCallback(async () => {
    const url = window.location.origin + buildLiftsShareUrl(input);
    try {
      await navigator.clipboard.writeText(url);
      setShareStatus("copied");
      setTimeout(() => setShareStatus("idle"), 2000);
    } catch { /* ignore */ }
  }, [input]);

  if (!mounted) {
    return (
      <main className="max-w-md mx-auto px-4 py-10">
        <p className="text-neutral-400 text-center">로딩 중...</p>
      </main>
    );
  }

  return (
    <main className="max-w-md mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-neutral-900 mb-1">3대 합계 계산기</h1>
      <p className="text-sm text-neutral-500 mb-6">
        스쿼트·벤치·데드 1RM을 입력하고 합계와 체중 대비 등급을 확인하세요.
      </p>

      {/* 단위 토글 */}
      <div className="flex rounded-xl border border-neutral-300 overflow-hidden mb-4 w-fit">
        <button
          type="button"
          onClick={() => setUnit("kg")}
          className={`px-4 h-10 text-sm font-medium transition-colors ${
            unit === "kg"
              ? "bg-emerald-600 text-white"
              : "bg-white text-neutral-600 hover:bg-neutral-50"
          }`}
        >
          kg
        </button>
        <button
          type="button"
          onClick={() => setUnit("lb")}
          className={`px-4 h-10 text-sm font-medium transition-colors ${
            unit === "lb"
              ? "bg-emerald-600 text-white"
              : "bg-white text-neutral-600 hover:bg-neutral-50"
          }`}
        >
          lb
        </button>
      </div>

      {/* 입력 */}
      <div className="space-y-3 mb-6">
        {[
          { id: "squat", label: "스쿼트", value: squat, setter: setSquat },
          { id: "bench", label: "벤치프레스", value: bench, setter: setBench },
          { id: "deadlift", label: "데드리프트", value: deadlift, setter: setDeadlift },
          { id: "bodyweight", label: "체중 (선택)", value: bodyweight, setter: setBodyweight },
        ].map((field) => (
          <div key={field.id}>
            <label htmlFor={field.id} className="block text-sm font-medium text-neutral-700 mb-1">
              {field.label} ({unit})
            </label>
            <input
              id={field.id}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={field.value}
              onChange={(e) => field.setter(e.target.value)}
              placeholder="0"
              className="w-full h-12 rounded-xl border border-neutral-300 bg-white px-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        ))}
      </div>

      {/* 결과 */}
      {hasResult && (
        <div className="space-y-4">
          {/* 합계 */}
          <div className="rounded-2xl bg-gradient-to-br from-rose-50 to-rose-100 border border-rose-200 p-6 text-center">
            <p className="text-sm text-rose-700 mb-1">3대 합계</p>
            <p className="text-4xl font-bold text-rose-800">
              {result.totalKg}
              <span className="text-lg font-normal ml-1">kg</span>
            </p>
            <p className="text-lg text-rose-600 mt-1">{result.totalLb} lb</p>
          </div>

          {/* 체중 대비 */}
          {bw > 0 && (
            <div className="rounded-2xl bg-white border border-neutral-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-neutral-600">체중 대비 비율</span>
                <span className="text-2xl font-bold text-neutral-900">{result.ratio}x</span>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`text-lg font-bold ${result.grade.color}`}
                >
                  {result.grade.label}
                </span>
                <span className="text-sm text-neutral-500">
                  {result.grade.description}
                </span>
              </div>
            </div>
          )}

          {/* 개별 수치 */}
          <div className="rounded-2xl bg-white border border-neutral-200 overflow-hidden">
            <div className="px-4 py-3 bg-neutral-50 border-b border-neutral-200">
              <h2 className="text-sm font-semibold text-neutral-700">종목별 수치</h2>
            </div>
            <div className="divide-y divide-neutral-50">
              {[
                { label: "스쿼트", value: s },
                { label: "벤치프레스", value: b },
                { label: "데드리프트", value: d },
              ].map((item) => (
                <div key={item.label} className="flex justify-between py-3 px-4">
                  <span className="text-sm text-neutral-600">{item.label}</span>
                  <span className="text-sm font-medium text-neutral-900">
                    {item.value} {unit}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 공유 */}
          <button
            type="button"
            onClick={handleShare}
            className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 active:scale-[0.98] transition-all text-sm"
          >
            {shareStatus === "copied" ? "링크가 복사되었습니다!" : "결과 링크 복사하기"}
          </button>

          <Link
            href="/1rm"
            className="block text-center py-3 rounded-xl bg-neutral-100 text-neutral-700 font-medium text-sm hover:bg-neutral-200 transition-colors"
          >
            🏋️ 1RM 계산기로 이동
          </Link>

          <AdSlot slotId="lifts-result" className="mt-2" />
        </div>
      )}
    </main>
  );
}

export default function LiftsPage() {
  return (
    <Suspense
      fallback={
        <main className="max-w-md mx-auto px-4 py-10">
          <p className="text-neutral-400 text-center">로딩 중...</p>
        </main>
      }
    >
      <LiftsContent />
    </Suspense>
  );
}
