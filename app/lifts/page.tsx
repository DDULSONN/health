"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import ShareToCommBtn from "@/components/ShareToCommBtn";
import { calculateLifts, buildLiftsShareUrl, type LiftInput } from "@/lib/lifts";
import { getClassBasedPercentile, getPercentiles, type Sex } from "@/lib/percentile";
import { kgToLb, type WeightUnit } from "@/lib/oneRm";

const STORAGE_KEY = "gymtools_lifts";

function formatSexLabel(sex: Sex): string {
  return sex === "male" ? "남성" : "여성";
}

function LiftsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [squat, setSquat] = useState("");
  const [bench, setBench] = useState("");
  const [deadlift, setDeadlift] = useState("");
  const [bodyweightKg, setBodyweightKg] = useState("");
  const [unit, setUnit] = useState<WeightUnit>("kg");
  const [sex, setSex] = useState<Sex | "">("");
  const [mounted, setMounted] = useState(false);
  const [shareStatus, setShareStatus] = useState<"idle" | "copied">("idle");
  const [saveRecordStatus, setSaveRecordStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [saveRecordError, setSaveRecordError] = useState("");

  useEffect(() => {
    const qS = searchParams.get("s");
    const qB = searchParams.get("b");
    const qD = searchParams.get("d");
    const qBwKg = searchParams.get("bwkg") ?? searchParams.get("bw");
    const qUnit = searchParams.get("unit") as WeightUnit | null;
    const qSex = searchParams.get("sex");

    if (qS && qB && qD) {
      setSquat(qS);
      setBench(qB);
      setDeadlift(qD);
      if (qBwKg) setBodyweightKg(qBwKg);
      if (qUnit === "kg" || qUnit === "lb") setUnit(qUnit);
      if (qSex === "male" || qSex === "female") setSex(qSex);
    } else {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const data = JSON.parse(saved) as {
            squat?: number;
            bench?: number;
            deadlift?: number;
            bodyweightKg?: number;
            unit?: WeightUnit;
            sex?: Sex;
          };
          if (data.squat) setSquat(String(data.squat));
          if (data.bench) setBench(String(data.bench));
          if (data.deadlift) setDeadlift(String(data.deadlift));
          if (data.bodyweightKg) setBodyweightKg(String(data.bodyweightKg));
          if (data.unit === "kg" || data.unit === "lb") setUnit(data.unit);
          if (data.sex === "male" || data.sex === "female") setSex(data.sex);
        }
      } catch {
        // ignore
      }
    }
    setMounted(true);
  }, [searchParams]);

  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          squat: Number(squat),
          bench: Number(bench),
          deadlift: Number(deadlift),
          bodyweightKg: Number(bodyweightKg),
          unit,
          sex,
        }),
      );
    } catch {
      // ignore
    }
  }, [squat, bench, deadlift, bodyweightKg, unit, sex, mounted]);

  const s = Number(squat) || 0;
  const b = Number(bench) || 0;
  const d = Number(deadlift) || 0;
  const bwKg = Number(bodyweightKg) || 0;
  const bwInUnit = unit === "kg" ? bwKg : kgToLb(bwKg);

  const input: LiftInput = useMemo(
    () => ({ squat: s, bench: b, deadlift: d, bodyweight: bwInUnit, unit }),
    [s, b, d, bwInUnit, unit],
  );
  const result = useMemo(() => calculateLifts(input), [input]);
  const hasResult = s > 0 || b > 0 || d > 0;
  const hasSex = sex === "male" || sex === "female";

  const percentiles = useMemo(() => {
    if (!hasSex) return null;
    return getPercentiles(result.totalKg, sex);
  }, [hasSex, result.totalKg, sex]);

  const classPercentile = useMemo(() => {
    if (!hasSex || bwKg <= 0) return null;
    return getClassBasedPercentile(result.totalKg, sex, bwKg);
  }, [hasSex, result.totalKg, sex, bwKg]);

  const handleShare = useCallback(async () => {
    const url =
      window.location.origin +
      buildLiftsShareUrl(input, { sex: hasSex ? sex : undefined, bodyweightKg: bwKg > 0 ? bwKg : undefined });
    try {
      await navigator.clipboard.writeText(url);
      setShareStatus("copied");
      setTimeout(() => setShareStatus("idle"), 2000);
    } catch {
      // ignore
    }
  }, [input, hasSex, sex, bwKg]);

  const handleSaveRecord = useCallback(async () => {
    if (!hasResult || !hasSex) return;

    setSaveRecordStatus("saving");
    setSaveRecordError("");

    try {
      const response = await fetch("/api/lift-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sex,
          squat: s,
          bench: b,
          deadlift: d,
          total: result.totalKg,
        }),
      });

      if (response.status === 401) {
        router.push(`/login?redirect=${encodeURIComponent("/lifts")}`);
        return;
      }

      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "기록 저장에 실패했습니다.");
      }

      setSaveRecordStatus("done");
      setTimeout(() => setSaveRecordStatus("idle"), 2200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Lifts] record save failed: ${message}`, error);
      setSaveRecordError(message);
      setSaveRecordStatus("error");
    }
  }, [hasResult, hasSex, sex, s, b, d, result.totalKg, router]);

  if (!mounted) {
    return (
      <main className="max-w-md mx-auto px-4 py-10">
        <p className="text-neutral-400 text-center">로딩 중...</p>
      </main>
    );
  }

  return (
    <main className="max-w-md mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-neutral-900 mb-4">3대 합계 계산기</h1>

      <div className="mb-4">
        <p className="block text-sm font-medium text-neutral-700 mb-2">성별 (필수)</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSex("male")}
            className={`flex-1 h-11 rounded-xl border text-sm font-medium ${
              sex === "male" ? "border-emerald-600 bg-emerald-600 text-white" : "border-neutral-300 bg-white text-neutral-700"
            }`}
          >
            남자
          </button>
          <button
            type="button"
            onClick={() => setSex("female")}
            className={`flex-1 h-11 rounded-xl border text-sm font-medium ${
              sex === "female" ? "border-emerald-600 bg-emerald-600 text-white" : "border-neutral-300 bg-white text-neutral-700"
            }`}
          >
            여자
          </button>
        </div>
      </div>

      <div className="flex rounded-xl border border-neutral-300 overflow-hidden mb-4 w-fit">
        <button
          type="button"
          onClick={() => setUnit("kg")}
          className={`px-4 h-10 text-sm font-medium ${unit === "kg" ? "bg-emerald-600 text-white" : "bg-white text-neutral-600"}`}
        >
          kg
        </button>
        <button
          type="button"
          onClick={() => setUnit("lb")}
          className={`px-4 h-10 text-sm font-medium ${unit === "lb" ? "bg-emerald-600 text-white" : "bg-white text-neutral-600"}`}
        >
          lb
        </button>
      </div>

      <div className="space-y-3 mb-6">
        {[
          { id: "squat", label: "스쿼트", value: squat, setter: setSquat, unitLabel: unit },
          { id: "bench", label: "벤치프레스", value: bench, setter: setBench, unitLabel: unit },
          { id: "deadlift", label: "데드리프트", value: deadlift, setter: setDeadlift, unitLabel: unit },
          { id: "bodyweightKg", label: "체중", value: bodyweightKg, setter: setBodyweightKg, unitLabel: "kg" },
        ].map((field) => (
          <div key={field.id}>
            <label htmlFor={field.id} className="block text-sm font-medium text-neutral-700 mb-1">
              {field.label} ({field.unitLabel})
            </label>
            <input
              id={field.id}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={field.value}
              onChange={(event) => field.setter(event.target.value)}
              placeholder="0"
              className="w-full h-12 rounded-xl border border-neutral-300 bg-white px-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        ))}
      </div>

      {hasResult && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-gradient-to-br from-rose-50 to-rose-100 border border-rose-200 p-6 text-center">
            <p className="text-sm text-rose-700 mb-1">3대 합계</p>
            <p className="text-4xl font-bold text-rose-800">
              {result.totalKg}
              <span className="text-lg font-normal ml-1">kg</span>
            </p>
            <p className="text-lg text-rose-600 mt-1">{result.totalLb} lb</p>
          </div>

          {hasSex && percentiles && (
            <div className="rounded-2xl bg-white border border-neutral-200 p-4 space-y-1.5">
              <p className="text-sm text-neutral-800">
                대한민국 전체 {formatSexLabel(sex)} 기준(추정): <strong>상위 {percentiles.allKrTop}%</strong>
              </p>
              <p className="text-sm text-neutral-800">
                대한민국 헬스장 이용자 {formatSexLabel(sex)} 기준(추정): <strong>상위 {percentiles.gymKrTop}%</strong>
              </p>
              <p className="text-sm text-neutral-800">
                {classPercentile
                  ? `${classPercentile.classLabel} ${formatSexLabel(sex)} 기준(추정): 상위 ${classPercentile.topPercent}%`
                  : `체급 기준(추정): 체중 입력 시 표시`}
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={handleSaveRecord}
            disabled={!hasSex || saveRecordStatus === "saving"}
            className="w-full min-h-[48px] rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700 text-sm disabled:opacity-50"
          >
            {saveRecordStatus === "saving"
              ? "기록 저장 중..."
              : saveRecordStatus === "done"
                ? "3대 기록 저장 완료"
                : "내 3대 기록 저장"}
          </button>
          {saveRecordStatus === "error" && <p className="text-xs text-red-600 break-words">저장 실패: {saveRecordError}</p>}

          <button
            type="button"
            onClick={handleShare}
            className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 text-sm"
          >
            {shareStatus === "copied" ? "링크가 복사되었습니다" : "결과 링크 복사하기"}
          </button>

          <Link
            href="/my-records"
            className="block text-center py-3 rounded-xl bg-neutral-100 text-neutral-700 font-medium text-sm hover:bg-neutral-200 transition-colors"
          >
            내 3대 성장 그래프 보기
          </Link>

          <ShareToCommBtn
            type="lifts"
            title={`3대 합계 ${result.totalKg}kg`}
            payload={{
              squat: s,
              bench: b,
              deadlift: d,
              totalKg: result.totalKg,
              sex: hasSex ? sex : null,
              allKrTop: percentiles?.allKrTop ?? null,
              gymKrTop: percentiles?.gymKrTop ?? null,
              classTop: classPercentile?.topPercent ?? null,
              classLabel: classPercentile?.classLabel ?? null,
            }}
          />

          <p className="text-xs text-neutral-500 text-center pt-1">
            짐툴 공식 3대 인증 시스템 준비중 (영상 검증 + QR 인증서 발급 예정)
          </p>

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

