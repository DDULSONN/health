"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import {
  build1RMShareUrl,
  calculate1RM,
  getPercentageTable,
  kgToLb,
  lbToKg,
  LIFT_LABELS,
  type Formula,
  type LiftType,
  type WeightUnit,
} from "@/lib/oneRm";

const STORAGE_KEY = "gymtools_1rm";

function OneRmSearchFallback() {
  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold text-neutral-900">1RM 계산기</h1>
      <p className="mb-6 text-sm leading-relaxed text-neutral-500">
        벤치프레스·스쿼트·데드리프트의 중량과 반복 횟수로 예상 1RM과 추천 작업 중량을 계산하세요.
      </p>
      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="font-semibold text-neutral-900">1RM 계산 방법</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          Epley와 Brzycki 공식을 지원하며, 반복 횟수는 1~12회 범위에서 입력할 수 있습니다. 계산기를 불러오는 중입니다.
        </p>
      </section>
    </main>
  );
}

function OneRmContent() {
  const searchParams = useSearchParams();

  const [lift, setLift] = useState<LiftType>("bench");
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [unit, setUnit] = useState<WeightUnit>("kg");
  const [formula, setFormula] = useState<Formula>("epley");
  const [mounted, setMounted] = useState(false);
  const [shareStatus, setShareStatus] = useState<"idle" | "copied">("idle");
  const [calcStatus, setCalcStatus] = useState<"idle" | "done" | "invalid">("idle");

  /* URL·localStorage의 초기값을 마운트 후 한 번 폼에 반영해야 한다. */
  /* eslint-disable react-hooks/set-state-in-effect */
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
          const data = JSON.parse(saved) as {
            lift?: LiftType;
            weight?: number;
            reps?: number;
            unit?: WeightUnit;
            formula?: Formula;
          };
          if (data.weight) setWeight(String(data.weight));
          if (data.reps) setReps(String(data.reps));
          if (data.unit) setUnit(data.unit);
          if (data.formula) setFormula(data.formula);
          if (data.lift) setLift(data.lift);
        }
      } catch {
        // ignore
      }
    }

    setMounted(true);
  }, [searchParams]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          lift,
          weight: Number(weight),
          reps: Number(reps),
          unit,
          formula,
        }),
      );
    } catch {
      // ignore
    }
  }, [mounted, lift, weight, reps, unit, formula]);

  const w = Number(weight) || 0;
  const r = Number(reps) || 0;
  const weightKg = unit === "kg" ? w : lbToKg(w);

  const oneRmKg = useMemo(() => calculate1RM(weightKg, r, formula), [weightKg, r, formula]);
  const oneRmLb = useMemo(() => kgToLb(oneRmKg), [oneRmKg]);
  const percentTable = useMemo(() => getPercentageTable(oneRmKg), [oneRmKg]);

  const hasResult = w > 0 && r > 0 && r <= 12 && oneRmKg > 0;

  const handleShare = useCallback(async () => {
    const url = window.location.origin + build1RMShareUrl({ weight: w, reps: r, unit, formula, lift });
    try {
      await navigator.clipboard.writeText(url);
      setShareStatus("copied");
      setTimeout(() => setShareStatus("idle"), 2000);
    } catch {
      // ignore
    }
  }, [w, r, unit, formula, lift]);

  const handleCalcMission = useCallback(async () => {
    if (!hasResult) {
      setCalcStatus("invalid");
      setTimeout(() => setCalcStatus("idle"), 1500);
      return;
    }

    try {
      await fetch("/api/daily-missions/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "did_1rm_calc" }),
      });
      setCalcStatus("done");
      setTimeout(() => setCalcStatus("idle"), 1500);
    } catch {
      setCalcStatus("idle");
    }
  }, [hasResult]);

  return (
    <main className="max-w-md mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-neutral-900 mb-1">1RM 계산기</h1>
      <p className="text-sm text-neutral-500 mb-6">운동 종목, 작업 중량, 반복 횟수를 입력해 1RM 추정값을 확인하세요.</p>

      <div className="space-y-4 mb-6">
        <div>
          <label htmlFor="lift" className="block text-sm font-medium text-neutral-700 mb-1">
            운동 종목
          </label>
          <select
            id="lift"
            value={lift}
            onChange={(event) => setLift(event.target.value as LiftType)}
            className="w-full h-12 rounded-xl border border-neutral-300 bg-white px-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {Object.entries(LIFT_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="weight" className="block text-sm font-medium text-neutral-700 mb-1">
            작업 중량
          </label>
          <div className="flex gap-2">
            <input
              id="weight"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={weight}
              onChange={(event) => setWeight(event.target.value)}
              placeholder="0"
              className="flex-1 h-12 rounded-xl border border-neutral-300 bg-white px-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <div className="flex rounded-xl border border-neutral-300 overflow-hidden">
              <button
                type="button"
                onClick={() => setUnit("kg")}
                className={`px-4 h-12 text-sm font-medium ${unit === "kg" ? "bg-emerald-600 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}
              >
                kg
              </button>
              <button
                type="button"
                onClick={() => setUnit("lb")}
                className={`px-4 h-12 text-sm font-medium ${unit === "lb" ? "bg-emerald-600 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}
              >
                lb
              </button>
            </div>
          </div>
        </div>

        <div>
          <label htmlFor="reps" className="block text-sm font-medium text-neutral-700 mb-1">
            반복 횟수(1~12)
          </label>
          <input
            id="reps"
            type="number"
            inputMode="numeric"
            min="1"
            max="12"
            value={reps}
            onChange={(event) => setReps(event.target.value)}
            placeholder="5"
            className="w-full h-12 rounded-xl border border-neutral-300 bg-white px-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div>
          <span className="block text-sm font-medium text-neutral-700 mb-1">계산식 선택</span>
          <div className="flex rounded-xl border border-neutral-300 overflow-hidden">
            <button
              type="button"
              onClick={() => setFormula("epley")}
              className={`flex-1 h-10 text-sm font-medium ${formula === "epley" ? "bg-emerald-600 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}
            >
              Epley
            </button>
            <button
              type="button"
              onClick={() => setFormula("brzycki")}
              className={`flex-1 h-10 text-sm font-medium ${formula === "brzycki" ? "bg-emerald-600 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}
            >
              Brzycki
            </button>
          </div>
          <p className="text-xs text-neutral-400 mt-1">
            {formula === "epley" ? "Epley: 1RM = W × (1 + reps/30)" : "Brzycki: 1RM = W × 36 / (37 - reps)"}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={handleCalcMission}
        className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 active:scale-[0.98] transition-all text-sm mb-4"
      >
        {calcStatus === "done" ? "오늘의 미션 반영 완료" : calcStatus === "invalid" ? "입력값을 먼저 확인해 주세요" : "1RM 계산하기"}
      </button>

      {hasResult && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 p-6 text-center">
            <p className="text-sm text-emerald-700 mb-1">
              {LIFT_LABELS[lift]} 1RM 추정값 ({formula === "epley" ? "Epley" : "Brzycki"})
            </p>
            <p className="text-4xl font-bold text-emerald-800">
              {Math.round(oneRmKg * 10) / 10}
              <span className="text-lg font-normal ml-1">kg</span>
            </p>
            <p className="text-lg text-emerald-600 mt-1">{Math.round(oneRmLb * 10) / 10} lb</p>
          </div>

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

          <div className="space-y-2">
            <button
              type="button"
              onClick={handleShare}
              className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 active:scale-[0.98] transition-all text-sm"
            >
              {shareStatus === "copied" ? "링크가 복사되었습니다" : "결과 링크 복사하기"}
            </button>

            <Link
              href="/lifts"
              className="block text-center py-3 rounded-xl bg-neutral-100 text-neutral-700 font-medium text-sm hover:bg-neutral-200 transition-colors"
            >
              3대 합계 계산기로 이동
            </Link>
          </div>

          <AdSlot slotId="1rm-result" className="mt-4" />
        </div>
      )}

      {w > 0 && r > 12 && (
        <p className="text-sm text-amber-600 bg-amber-50 rounded-xl p-3 mt-4">
          반복 횟수는 1~12 범위에서 가장 정확합니다. 12 이하로 입력해 주세요.
        </p>
      )}

      <section className="mt-8 space-y-3 border-t border-neutral-200 pt-6 text-sm leading-relaxed text-neutral-600">
        <h2 className="text-lg font-bold text-neutral-900">1RM이란?</h2>
        <p>
          1RM은 정확한 자세로 한 번 들어 올릴 수 있는 최대 중량입니다. 직접 최대 중량에 도전하지 않아도 작업 중량과 반복
          횟수로 예상치를 구해 운동 강도를 정할 수 있습니다.
        </p>
        <p>
          계산 결과는 컨디션과 자세에 따라 실제 기록과 다를 수 있습니다. 무리한 중량 증량보다 안전한 자세와 점진적인 증가를
          우선하세요.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Link href="/lifts" className="rounded-full bg-neutral-100 px-3 py-2 font-medium text-neutral-700">
            3대 합계 계산기
          </Link>
          <Link href="/protein" className="rounded-full bg-neutral-100 px-3 py-2 font-medium text-neutral-700">
            프로틴 추천
          </Link>
        </div>
      </section>
    </main>
  );
}

export default function OneRmPage() {
  return (
    <Suspense
      fallback={<OneRmSearchFallback />}
    >
      <OneRmContent />
    </Suspense>
  );
}
