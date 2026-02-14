"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import ShareToCommBtn from "@/components/ShareToCommBtn";
import { calculateLifts, buildLiftsShareUrl, type LiftInput } from "@/lib/lifts";
import { getPercentiles, type Sex } from "@/lib/percentile";
import type { WeightUnit } from "@/lib/oneRm";

const STORAGE_KEY = "gymtools_lifts";
const ESTIMATE_TOOLTIP =
  "국가 공식 통계가 없어 공개 기록 및 가정 기반으로 만든 추정 모델입니다. 짐툴 사용자 데이터가 쌓이면 보정될 수 있습니다.";

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatSexLabel(sex: Sex): string {
  return sex === "male" ? "남성" : "여성";
}

async function captureCardImage(element: HTMLElement): Promise<{ dataUrl: string; method: string }> {
  try {
    const { toPng } = await import("html-to-image");
    const dataUrl = await toPng(element, {
      cacheBust: true,
      pixelRatio: Math.max(2, window.devicePixelRatio || 1),
      backgroundColor: "#ffffff",
      style: { backgroundColor: "#ffffff" },
    });
    return { dataUrl, method: "html-to-image" };
  } catch (firstError) {
    console.error(`[Lifts] html-to-image capture failed: ${getErrorMessage(firstError)}`, firstError);
  }

  const html2canvas = (await import("html2canvas")).default;
  const canvas = await html2canvas(element, {
    scale: Math.max(2, window.devicePixelRatio || 1),
    backgroundColor: "#ffffff",
    useCORS: true,
    allowTaint: false,
    logging: false,
  });
  return { dataUrl: canvas.toDataURL("image/png"), method: "html2canvas" };
}

function triggerDesktopDownload(dataUrl: string, fileName: string): void {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  link.rel = "noopener";
  link.click();
}

async function shareOrOpenOnMobile(dataUrl: string, fileName: string): Promise<void> {
  if (navigator.share) {
    try {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const file = new File([blob], fileName, { type: "image/png" });
      const shareData: ShareData = {
        title: "짐툴 3대 인증 카드",
        text: "짐툴 3대 합계 인증 카드",
        files: [file],
      };
      if (!navigator.canShare || navigator.canShare(shareData)) {
        await navigator.share(shareData);
        return;
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        console.error(`[Lifts] mobile share failed: ${getErrorMessage(error)}`, error);
      }
    }
  }

  const opened = window.open(dataUrl, "_blank", "noopener,noreferrer");
  if (!opened) {
    throw new Error("모바일에서 이미지를 열지 못했습니다. 팝업 차단을 해제해 주세요.");
  }
}

function EstimateLine({ label, topPercent }: { label: string; topPercent: number }) {
  return (
    <p className="text-sm text-neutral-700">
      {label}: <strong>상위 {topPercent}%</strong>{" "}
      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-neutral-200 text-[10px] font-semibold text-neutral-700 align-middle" title={ESTIMATE_TOOLTIP} aria-label={ESTIMATE_TOOLTIP}>
        ?
      </span>
    </p>
  );
}

function LiftsContent() {
  const searchParams = useSearchParams();
  const cardRef = useRef<HTMLDivElement>(null);

  const [squat, setSquat] = useState("");
  const [bench, setBench] = useState("");
  const [deadlift, setDeadlift] = useState("");
  const [bodyweight, setBodyweight] = useState("");
  const [unit, setUnit] = useState<WeightUnit>("kg");
  const [sex, setSex] = useState<Sex | "">("");
  const [mounted, setMounted] = useState(false);
  const [shareStatus, setShareStatus] = useState<"idle" | "copied">("idle");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    const qS = searchParams.get("s");
    const qB = searchParams.get("b");
    const qD = searchParams.get("d");
    const qBw = searchParams.get("bw");
    const qUnit = searchParams.get("unit") as WeightUnit | null;
    const qSex = searchParams.get("sex");

    if (qS && qB && qD) {
      setSquat(qS);
      setBench(qB);
      setDeadlift(qD);
      if (qBw) setBodyweight(qBw);
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
            bodyweight?: number;
            unit?: WeightUnit;
            sex?: Sex;
          };
          if (data.squat) setSquat(String(data.squat));
          if (data.bench) setBench(String(data.bench));
          if (data.deadlift) setDeadlift(String(data.deadlift));
          if (data.bodyweight) setBodyweight(String(data.bodyweight));
          if (data.unit === "kg" || data.unit === "lb") setUnit(data.unit);
          if (data.sex === "male" || data.sex === "female") setSex(data.sex);
        }
      } catch {
        // ignore localStorage parse errors
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
          bodyweight: Number(bodyweight),
          unit,
          sex,
        }),
      );
    } catch {
      // ignore localStorage write errors
    }
  }, [squat, bench, deadlift, bodyweight, unit, sex, mounted]);

  const s = Number(squat) || 0;
  const b = Number(bench) || 0;
  const d = Number(deadlift) || 0;
  const bw = Number(bodyweight) || 0;

  const input: LiftInput = useMemo(
    () => ({ squat: s, bench: b, deadlift: d, bodyweight: bw, unit }),
    [s, b, d, bw, unit],
  );
  const result = useMemo(() => calculateLifts(input), [input]);
  const hasResult = s > 0 || b > 0 || d > 0;
  const hasSex = sex === "male" || sex === "female";

  const percentiles = useMemo(() => {
    if (!hasSex) return null;
    return getPercentiles(result.totalKg, sex);
  }, [hasSex, result.totalKg, sex]);

  const shareTitle = useMemo(() => {
    if (!hasSex || !percentiles) {
      return `3대 합계 ${result.totalKg}kg${bw > 0 ? ` (${result.ratio}x)` : ""}`;
    }
    const sexLabel = formatSexLabel(sex);
    return `3대 합계 ${result.totalKg}kg · 전체 ${sexLabel} 상위 ${percentiles.allKrTop}% · 헬스장 ${sexLabel} 상위 ${percentiles.gymKrTop}%`;
  }, [hasSex, percentiles, result.totalKg, result.ratio, bw, sex]);

  const handleShare = useCallback(async () => {
    const url = window.location.origin + buildLiftsShareUrl(input, { sex: hasSex ? sex : undefined });
    try {
      await navigator.clipboard.writeText(url);
      setShareStatus("copied");
      setTimeout(() => setShareStatus("idle"), 2000);
    } catch {
      // ignore clipboard failure
    }
  }, [input, hasSex, sex]);

  const handleSaveCard = useCallback(async () => {
    if (!cardRef.current || !hasResult || !hasSex) return;

    setSaveStatus("saving");
    setSaveError("");

    try {
      if ("fonts" in document) {
        await document.fonts.ready;
      }
      const { dataUrl, method } = await captureCardImage(cardRef.current);
      const fileName = `gymtools-lifts-${result.totalKg}kg.png`;

      if (isMobileDevice()) {
        await shareOrOpenOnMobile(dataUrl, fileName);
      } else {
        triggerDesktopDownload(dataUrl, fileName);
      }

      console.info(`[Lifts] card saved with ${method}`);
      setSaveStatus("done");
      setTimeout(() => setSaveStatus("idle"), 2200);
    } catch (error) {
      const message = getErrorMessage(error);
      console.error(`[Lifts] card save failed: ${message}`, error);
      setSaveError(message);
      setSaveStatus("error");
    }
  }, [hasResult, hasSex, result.totalKg]);

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
      <p className="text-sm text-neutral-500 mb-6">스쿼트, 벤치프레스, 데드리프트 1RM을 입력하고 합계와 추정 상위 퍼센트를 확인하세요.</p>

      <div className="mb-4">
        <p className="block text-sm font-medium text-neutral-700 mb-2">성별 (필수)</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSex("male")}
            className={`flex-1 h-11 rounded-xl border text-sm font-medium transition-colors ${
              sex === "male" ? "border-emerald-600 bg-emerald-600 text-white" : "border-neutral-300 bg-white text-neutral-700"
            }`}
          >
            남자
          </button>
          <button
            type="button"
            onClick={() => setSex("female")}
            className={`flex-1 h-11 rounded-xl border text-sm font-medium transition-colors ${
              sex === "female" ? "border-emerald-600 bg-emerald-600 text-white" : "border-neutral-300 bg-white text-neutral-700"
            }`}
          >
            여자
          </button>
        </div>
        {!hasSex && <p className="text-xs text-amber-700 mt-2">상위 퍼센트 추정을 위해 성별 선택이 필요합니다.</p>}
      </div>

      <div className="flex rounded-xl border border-neutral-300 overflow-hidden mb-4 w-fit">
        <button
          type="button"
          onClick={() => setUnit("kg")}
          className={`px-4 h-10 text-sm font-medium transition-colors ${
            unit === "kg" ? "bg-emerald-600 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"
          }`}
        >
          kg
        </button>
        <button
          type="button"
          onClick={() => setUnit("lb")}
          className={`px-4 h-10 text-sm font-medium transition-colors ${
            unit === "lb" ? "bg-emerald-600 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"
          }`}
        >
          lb
        </button>
      </div>

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

          {bw > 0 && (
            <div className="rounded-2xl bg-white border border-neutral-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-neutral-600">체중 대비 비율</span>
                <span className="text-2xl font-bold text-neutral-900">{result.ratio}x</span>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-lg font-bold ${result.grade.color}`}>{result.grade.label}</span>
                <span className="text-sm text-neutral-500">{result.grade.description}</span>
              </div>
            </div>
          )}

          {hasSex && percentiles && (
            <div className="rounded-2xl bg-white border border-neutral-200 p-4 space-y-2">
              <EstimateLine
                label={`대한민국 전체 ${formatSexLabel(sex)} 기준(추정)`}
                topPercent={percentiles.allKrTop}
              />
              <EstimateLine
                label={`대한민국 헬스장 이용자 ${formatSexLabel(sex)} 기준(추정)`}
                topPercent={percentiles.gymKrTop}
              />
              <p className="text-xs text-neutral-500 pt-1">{ESTIMATE_TOOLTIP}</p>
            </div>
          )}

          <div ref={cardRef} className="rounded-2xl bg-white border border-neutral-200 p-4">
            <p className="text-xs text-neutral-500 mb-2">3대 인증 카드 (저장용)</p>
            <p className="text-xl font-bold text-neutral-900">짐툴 (GymTools) 3대 합계 인증</p>
            <p className="text-3xl font-extrabold text-rose-700 mt-2">{result.totalKg}kg</p>
            {hasSex && percentiles ? (
              <div className="mt-3 text-xs text-neutral-600 space-y-1">
                <p>성별: {sex === "male" ? "남자" : "여자"}</p>
                <p>
                  전체 {formatSexLabel(sex)} 추정 상위 {percentiles.allKrTop}% / 헬스장 {formatSexLabel(sex)} 추정 상위{" "}
                  {percentiles.gymKrTop}%
                </p>
                <p>국가 공식 통계가 없어 공개 기록 및 가정 기반 추정치입니다.</p>
              </div>
            ) : (
              <p className="mt-3 text-xs text-amber-700">성별을 선택하면 추정 상위 퍼센트가 카드에 표시됩니다.</p>
            )}
          </div>

          <button
            type="button"
            onClick={handleSaveCard}
            disabled={!hasSex || saveStatus === "saving"}
            className="w-full min-h-[48px] rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 active:scale-[0.98] transition-all text-sm disabled:opacity-50"
          >
            {saveStatus === "saving"
              ? "카드 생성 중..."
              : saveStatus === "done"
                ? "3대 인증 카드 저장 완료"
                : "3대 인증 카드 저장"}
          </button>
          {saveStatus === "error" && <p className="text-xs text-red-600 break-words">저장 실패: {saveError}</p>}

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

          <button
            type="button"
            onClick={handleShare}
            className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 active:scale-[0.98] transition-all text-sm"
          >
            {shareStatus === "copied" ? "링크가 복사되었습니다" : "결과 링크 복사하기"}
          </button>

          <Link
            href="/1rm"
            className="block text-center py-3 rounded-xl bg-neutral-100 text-neutral-700 font-medium text-sm hover:bg-neutral-200 transition-colors"
          >
            단일 1RM 계산기로 이동
          </Link>

          <ShareToCommBtn
            type="lifts"
            title={shareTitle}
            payload={{
              squat: s,
              bench: b,
              deadlift: d,
              totalKg: result.totalKg,
              ratio: result.ratio,
              grade: result.grade.label,
              sex: hasSex ? sex : null,
              allKrTop: percentiles?.allKrTop ?? null,
              gymKrTop: percentiles?.gymKrTop ?? null,
              percentileModel: "estimated-normal-v1",
            }}
          />

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

