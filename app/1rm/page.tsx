"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import {
  calculate1RM,
  getPercentageTable,
  kgToLb,
  lbToKg,
  build1RMShareUrl,
  LIFT_LABELS,
  type Formula,
  type WeightUnit,
  type LiftType,
} from "@/lib/oneRm";

const STORAGE_KEY = "gymtools_1rm";

function OneRmContent() {
  const searchParams = useSearchParams();

  const [lift, setLift] = useState<LiftType>("bench");
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [unit, setUnit] = useState<WeightUnit>("kg");
  const [formula, setFormula] = useState<Formula>("epley");
  const [mounted, setMounted] = useState(false);
  const [shareStatus, setShareStatus] = useState<"idle" | "copied">("idle");

  // URL 쿼리 또는 localStorage에서 복원
  useEffect(() => {
    const qW = searchParams.get("w");
    const qR = searchParams.get("reps");
    const qUnit = searchParams.get("unit") as WeightUnit | null;
    const qFormula = searchParams.get("formula") as Formula | null;
    const qLift = searchParams.get("lift") as LiftType | null;

    if (qW && qR) {
      setWeight(qW);
      setReps(qR);
      if (qUnit === "kg" || qUnit === "lb") setUnit(qUnit);
      if (qFormula === "epley" || qFormula === "brzycki") setFormula(qFormula);
      if (qLift && qLift in LIFT_LABELS) setLift(qLift);
    } else {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const data = JSON.parse(saved);
          if (data.weight) setWeight(String(data.weight));
          if (data.reps) setReps(String(data.reps));
          if (data.unit) setUnit(data.unit);
          if (data.formula) setFormula(data.formula);
          if (data.lift) setLift(data.lift);
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
        JSON.stringify({ weight: Number(weight), reps: Number(reps), unit, formula, lift })
      );
    } catch { /* ignore */ }
  }, [weight, reps, unit, formula, lift, mounted]);

  const w = Number(weight) || 0;
  const r = Number(reps) || 0;
  const weightKg = unit === "kg" ? w : lbToKg(w);

  const oneRmKg = useMemo(() => calculate1RM(weightKg, r, formula), [weightKg, r, formula]);
  const oneRmLb = useMemo(() => kgToLb(oneRmKg), [oneRmKg]);
  const percentTable = useMemo(() => getPercentageTable(oneRmKg), [oneRmKg]);

  const hasResult = w > 0 && r > 0 && r <= 12 && oneRmKg > 0;

  const handleShare = useCallback(async () => {
    const url =
      window.location.origin +
      build1RMShareUrl({ weight: w, reps: r, unit, formula, lift });
    try {
      await navigator.clipboard.writeText(url);
      setShareStatus("copied");
      setTimeout(() => setShareStatus("idle"), 2000);
    } catch { /* ignore */ }
  }, [w, r, unit, formula, lift]);

  if (!mounted) {
    return (
      <main className="max-w-md mx-auto px-4 py-10">
        <p className="text-neutral-400 text-center">로딩 중...</p>
      </main>
    );
  }

  return (
    <main className="max-w-md mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-neutral-900 mb-1">1RM 계산기</h1>
      <p className="text-sm text-neutral-500 mb-6">
        사용 중량과 반복 횟수로 1RM(1회 최대 중량)을 추정합니다.
      </p>

      {/* 입력 폼 */}
      <div className="space-y-4 mb-6">
        {/* 운동 선택 */}
        <div>
          <label htmlFor="lift" className="block text-sm font-medium text-neutral-700 mb-1">
            운동 종류
          </label>
          <select
            id="lift"
            value={lift}
            onChange={(e) => setLift(e.target.value as LiftType)}
            className="w-full h-12 rounded-xl border border-neutral-300 bg-white px-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {Object.entries(LIFT_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {/* 중량 + 단위 */}
        <div>
          <label htmlFor="weight" className="block text-sm font-medium text-neutral-700 mb-1">
            사용 중량
          </label>
          <div className="flex gap-2">
            <input
              id="weight"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="0"
              className="flex-1 h-12 rounded-xl border border-neutral-300 bg-white px-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <div className="flex rounded-xl border border-neutral-300 overflow-hidden">
              <button
                type="button"
                onClick={() => setUnit("kg")}
                className={`px-4 h-12 text-sm font-medium transition-colors ${
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
                className={`px-4 h-12 text-sm font-medium transition-colors ${
                  unit === "lb"
                    ? "bg-emerald-600 text-white"
                    : "bg-white text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                lb
              </button>
            </div>
          </div>
        </div>

        {/* 반복 횟수 */}
        <div>
          <label htmlFor="reps" className="block text-sm font-medium text-neutral-700 mb-1">
            반복 횟수 (1~12)
          </label>
          <input
            id="reps"
            type="number"
            inputMode="numeric"
            min="1"
            max="12"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            placeholder="5"
            className="w-full h-12 rounded-xl border border-neutral-300 bg-white px-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        {/* 공식 선택 */}
        <div>
          <span className="block text-sm font-medium text-neutral-700 mb-1">추정 공식</span>
          <div className="flex rounded-xl border border-neutral-300 overflow-hidden">
            <button
              type="button"
              onClick={() => setFormula("epley")}
              className={`flex-1 h-10 text-sm font-medium transition-colors ${
                formula === "epley"
                  ? "bg-emerald-600 text-white"
                  : "bg-white text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              Epley
            </button>
            <button
              type="button"
              onClick={() => setFormula("brzycki")}
              className={`flex-1 h-10 text-sm font-medium transition-colors ${
                formula === "brzycki"
                  ? "bg-emerald-600 text-white"
                  : "bg-white text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              Brzycki
            </button>
          </div>
          <p className="text-xs text-neutral-400 mt-1">
            {formula === "epley"
              ? "Epley: 1RM = W × (1 + reps/30)"
              : "Brzycki: 1RM = W × 36/(37 - reps)"}
          </p>
        </div>
      </div>

      {/* 결과 */}
      {hasResult && (
        <div className="space-y-4">
          {/* 1RM 결과 카드 */}
          <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 p-6 text-center">
            <p className="text-sm text-emerald-700 mb-1">
              {LIFT_LABELS[lift]} 추정 1RM ({formula === "epley" ? "Epley" : "Brzycki"})
            </p>
            <p className="text-4xl font-bold text-emerald-800">
              {Math.round(oneRmKg * 10) / 10}
              <span className="text-lg font-normal ml-1">kg</span>
            </p>
            <p className="text-lg text-emerald-600 mt-1">
              {Math.round(oneRmLb * 10) / 10} lb
            </p>
          </div>

          {/* 퍼센트 표 */}
          <div className="rounded-2xl bg-white border border-neutral-200 overflow-hidden">
            <div className="px-4 py-3 bg-neutral-50 border-b border-neutral-200">
              <h2 className="text-sm font-semibold text-neutral-700">추천 작업 중량표</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-neutral-500">
                  <th className="py-2 px-4 text-left font-medium">%1RM</th>
                  <th className="py-2 px-4 text-right font-medium">kg</th>
                  <th className="py-2 px-4 text-right font-medium">lb</th>
                </tr>
              </thead>
              <tbody>
                {percentTable.map((row) => (
                  <tr key={row.percent} className="border-b border-neutral-50 hover:bg-neutral-50">
                    <td className="py-2.5 px-4 font-medium text-neutral-700">{row.percent}%</td>
                    <td className="py-2.5 px-4 text-right text-neutral-800">{row.kg}</td>
                    <td className="py-2.5 px-4 text-right text-neutral-500">{row.lb}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 공유 + 3대 이동 */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={handleShare}
              className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 active:scale-[0.98] transition-all text-sm"
            >
              {shareStatus === "copied" ? "링크가 복사되었습니다!" : "결과 링크 복사하기"}
            </button>
            <Link
              href="/lifts"
              className="block text-center py-3 rounded-xl bg-neutral-100 text-neutral-700 font-medium text-sm hover:bg-neutral-200 transition-colors"
            >
              💪 3대 합계 계산기로 이동
            </Link>
          </div>

          <AdSlot slotId="1rm-result" className="mt-4" />
        </div>
      )}

      {/* 입력이 비정상일 때 안내 */}
      {w > 0 && r > 0 && r > 12 && (
        <p className="text-sm text-amber-600 bg-amber-50 rounded-xl p-3 mt-4">
          반복 횟수는 1~12 범위에서 가장 정확합니다. 12회 이하로 입력해 주세요.
        </p>
      )}
    </main>
  );
}

export default function OneRmPage() {
  return (
    <Suspense
      fallback={
        <main className="max-w-md mx-auto px-4 py-10">
          <p className="text-neutral-400 text-center">로딩 중...</p>
        </main>
      }
    >
      <OneRmContent />
    </Suspense>
  );
}
