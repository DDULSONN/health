"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import ShareToCommBtn from "@/components/ShareToCommBtn";
import { createClient } from "@/lib/supabase/client";
import { calculateLifts, buildLiftsShareUrl, type LiftInput } from "@/lib/lifts";
import { getClassBasedPercentile, getPercentiles, type Sex } from "@/lib/percentile";
import { kgToLb, type WeightUnit } from "@/lib/oneRm";

const STORAGE_KEY = "gymtools_lifts";

type ShareStatus = "idle" | "copied";
type SaveRecordStatus = "idle" | "saving" | "done" | "error";
type ShareCardPayload = {
  blob: Blob;
  objectUrl: string;
};

function formatSexLabel(sex: Sex): string {
  return sex === "male" ? "남성" : "여성";
}

function validateNickname(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "닉네임을 입력해 주세요.";
  if (value.length < 2 || value.length > 12) return "닉네임은 2~12자여야 합니다.";
  if (!/^[0-9A-Za-z가-힣_]+$/.test(value)) return "한글/영문/숫자/_만 사용할 수 있습니다.";
  return null;
}

function makePngFilename(nickname: string): string {
  const safe = nickname.trim().replace(/[^0-9A-Za-z가-힣_]/g, "_").slice(0, 12) || "user";
  return `gymtools_percentile_${safe}.png`;
}

async function fetchShareCardBlob(url: string): Promise<ShareCardPayload> {
  const res = await fetch(url, { cache: "no-store" });
  const contentType = res.headers.get("content-type") || "";
  const buffer = await res.arrayBuffer();
  const byteLength = buffer.byteLength;
  const blob = new Blob([buffer], { type: contentType || "application/octet-stream" });
  const bytes = new Uint8Array(buffer);
  const firstBytes = Array.from(bytes.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");

  console.info("[share-card] response check", {
    ok: res.ok,
    status: res.status,
    contentType,
    byteLength,
    firstBytes,
  });

  if (!res.ok || !contentType.includes("image/png") || byteLength < 5000) {
    let textSnippet = "";
    try {
      textSnippet = new TextDecoder().decode(buffer).slice(0, 500);
    } catch {
      textSnippet = "";
    }
    console.error("Share card API failed", {
      status: res.status,
      contentType,
      byteLength,
      text: textSnippet,
    });
    throw new Error(`이미지 생성 실패: status=${res.status}, content-type=${contentType || "none"}, size=${byteLength}`);
  }

  const objectUrl = URL.createObjectURL(blob);
  return {
    blob,
    objectUrl,
  };
}

function openCardObjectUrl(objectUrl: string) {
  window.open(objectUrl, "_blank", "noopener,noreferrer");
}

function downloadBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

function getTierMessage(percentAll: number): string {
  if (percentAll <= 1) return "전국 상위 1% 괴물";
  if (percentAll <= 5) return "상위 5% 엘리트";
  if (percentAll <= 15) return "상위 15% 헬창";
  if (percentAll <= 30) return "상위 30% 상위권";
  return "성장 중";
}

function LiftsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);

  const [squat, setSquat] = useState("");
  const [bench, setBench] = useState("");
  const [deadlift, setDeadlift] = useState("");
  const [bodyweightKg, setBodyweightKg] = useState("");
  const [unit, setUnit] = useState<WeightUnit>("kg");
  const [sex, setSex] = useState<Sex | "">("");
  const [mounted, setMounted] = useState(false);

  const [shareStatus, setShareStatus] = useState<ShareStatus>("idle");
  const [saveRecordStatus, setSaveRecordStatus] = useState<SaveRecordStatus>("idle");
  const [saveRecordError, setSaveRecordError] = useState("");

  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareNickname, setShareNickname] = useState("");
  const [shareCardUrl, setShareCardUrl] = useState("");
  const [shareCardBlob, setShareCardBlob] = useState<Blob | null>(null);
  const [shareCardObjectUrl, setShareCardObjectUrl] = useState("");
  const [shareError, setShareError] = useState("");
  const [shareNotice, setShareNotice] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);

  const [rankingModalOpen, setRankingModalOpen] = useState(false);

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
        })
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
    [s, b, d, bwInUnit, unit]
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

  const handleCopyShareLink = useCallback(async () => {
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
        router.push(`/login?next=${encodeURIComponent("/rank/register")}`);
        return;
      }

      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "기록 저장에 실패했습니다.");
      }

      setSaveRecordStatus("done");
      setRankingModalOpen(false);
      setTimeout(() => setSaveRecordStatus("idle"), 2200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSaveRecordError(message);
      setSaveRecordStatus("error");
    }
  }, [hasResult, hasSex, sex, s, b, d, result.totalKg, router]);

  const createShareCardAndPreview = useCallback(async () => {
    if (!hasResult || !hasSex || !percentiles) {
      setShareError("성별과 체중을 입력해 퍼센트 결과를 먼저 계산해 주세요.");
      return;
    }

    const normalized = shareNickname.trim();
    const invalid = validateNickname(normalized);
    if (invalid) {
      setShareError(invalid);
      return;
    }

    const params = new URLSearchParams({
      total: String(Math.round(result.totalKg)),
      percentAll: String(percentiles.allKrTop),
      nickname: normalized,
      squat: s > 0 ? String(Math.round(s)) : "",
      bench: b > 0 ? String(Math.round(b)) : "",
      dead: d > 0 ? String(Math.round(d)) : "",
      sex: sex === "male" || sex === "female" ? sex : "",
    });

    const url = `/api/share-card?${params.toString()}`;
    setShareCardUrl(url);

    try {
      const payload = await fetchShareCardBlob(url);

      if (shareCardObjectUrl) URL.revokeObjectURL(shareCardObjectUrl);
      setShareCardObjectUrl(payload.objectUrl);
      setShareCardBlob(payload.blob);
      setShareError("");
      setShareNotice("카드가 생성됐어요");
    } catch (e) {
      setShareCardObjectUrl("");
      setShareCardBlob(null);
      setShareNotice("");
      setShareError(e instanceof Error ? e.message : "이미지 생성 실패");
    }
  }, [hasResult, hasSex, percentiles, result.totalKg, s, b, d, shareNickname, shareCardObjectUrl]);

  useEffect(() => {
    return () => {
      if (shareCardObjectUrl) URL.revokeObjectURL(shareCardObjectUrl);
    };
  }, [shareCardObjectUrl]);

  const handleDownloadCard = useCallback(async () => {
    if (!shareCardBlob) {
      setShareError("먼저 카드를 생성해 주세요.");
      return;
    }
    setIsDownloading(true);

    try {
      downloadBlob(shareCardBlob, makePngFilename(shareNickname));
      setShareError("");
    } catch (e) {
      setShareError(e instanceof Error ? e.message : "이미지 생성 실패");
    } finally {
      setIsDownloading(false);
    }
  }, [shareNickname, shareCardBlob]);

  const handleOpenCard = useCallback(async () => {
    if (!shareCardObjectUrl) {
      setShareError("먼저 카드를 생성해 주세요.");
      return;
    }
    try {
      openCardObjectUrl(shareCardObjectUrl);
      setShareError("");
    } catch (e) {
      setShareError(e instanceof Error ? e.message : "이미지 열기 실패");
    }
  }, [shareCardObjectUrl]);

  const handleShareCard = useCallback(async () => {
    if (!shareCardBlob) {
      setShareError("먼저 카드를 생성해 주세요.");
      return;
    }
    const filename = makePngFilename(shareNickname);
    if (navigator.share) {
      try {
        const file = new File([shareCardBlob], filename, { type: "image/png" });
        await navigator.share({
          title: "GYMTOOLS 3대 퍼센트 결과",
          text: "내 3대 퍼센트 결과를 공유합니다.",
          files: [file],
        });
        return;
      } catch {
        // ignore
      }
    }

    try {
      if (shareCardObjectUrl) {
        window.open(shareCardObjectUrl, "_blank", "noopener,noreferrer");
        setShareNotice("이미지를 열었습니다. 저장 후 공유해 주세요.");
      } else {
        setShareError("이미지 공유를 지원하지 않는 브라우저입니다.");
      }
    } catch {
      setShareError("SNS 공유에 실패했습니다.");
    }
  }, [shareCardBlob, shareCardObjectUrl, shareNickname]);

  const handleOpenRanking = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push(`/login?next=${encodeURIComponent("/rank/register")}`);
      return;
    }

    setRankingModalOpen(true);
  }, [router, supabase]);

  const tierMessage = percentiles ? getTierMessage(percentiles.allKrTop) : "";

  if (!mounted) {
    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <p className="text-center text-neutral-400">로딩 중...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-8 pb-40">
      <h1 className="mb-4 text-2xl font-bold text-neutral-900">3대 합계 계산기</h1>

      <div className="mb-4">
        <p className="mb-2 block text-sm font-medium text-neutral-700">성별 (필수)</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSex("male")}
            className={`h-11 flex-1 rounded-xl border text-sm font-medium ${
              sex === "male"
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-neutral-300 bg-white text-neutral-700"
            }`}
          >
            남자
          </button>
          <button
            type="button"
            onClick={() => setSex("female")}
            className={`h-11 flex-1 rounded-xl border text-sm font-medium ${
              sex === "female"
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-neutral-300 bg-white text-neutral-700"
            }`}
          >
            여자
          </button>
        </div>
      </div>

      <div className="mb-4 flex w-fit overflow-hidden rounded-xl border border-neutral-300">
        <button
          type="button"
          onClick={() => setUnit("kg")}
          className={`h-10 px-4 text-sm font-medium ${unit === "kg" ? "bg-emerald-600 text-white" : "bg-white text-neutral-600"}`}
        >
          kg
        </button>
        <button
          type="button"
          onClick={() => setUnit("lb")}
          className={`h-10 px-4 text-sm font-medium ${unit === "lb" ? "bg-emerald-600 text-white" : "bg-white text-neutral-600"}`}
        >
          lb
        </button>
      </div>

      <div className="mb-6 space-y-3">
        {[
          { id: "squat", label: "스쿼트", value: squat, setter: setSquat, unitLabel: unit },
          { id: "bench", label: "벤치프레스", value: bench, setter: setBench, unitLabel: unit },
          { id: "deadlift", label: "데드리프트", value: deadlift, setter: setDeadlift, unitLabel: unit },
          { id: "bodyweightKg", label: "체중", value: bodyweightKg, setter: setBodyweightKg, unitLabel: "kg" },
        ].map((field) => (
          <div key={field.id}>
            <label htmlFor={field.id} className="mb-1 block text-sm font-medium text-neutral-700">
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
              className="h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        ))}
      </div>

      {hasResult && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 to-rose-100 p-6 text-center">
            <p className="mb-1 text-sm text-rose-700">3대 합계</p>
            <p className="text-4xl font-bold text-rose-800">
              {result.totalKg}
              <span className="ml-1 text-lg font-normal">kg</span>
            </p>
            <p className="mt-1 text-lg text-rose-600">{result.totalLb} lb</p>
          </div>

          {hasSex && percentiles && (
            <div className="space-y-1.5 rounded-2xl border border-neutral-200 bg-white p-4">
              <p className="text-sm text-neutral-800">
                대한민국 전체 {formatSexLabel(sex)} 기준(추정): <strong>상위 {percentiles.allKrTop}%</strong>
              </p>
              <p className="text-sm text-neutral-800">
                대한민국 헬스장 이용자 {formatSexLabel(sex)} 기준(추정): <strong>상위 {percentiles.gymKrTop}%</strong>
              </p>
              <p className="text-sm text-neutral-800">
                {classPercentile
                  ? `${classPercentile.classLabel} 체급 상위 ${classPercentile.topPercent}%`
                  : "체급 퍼센트는 체중 입력 후 계산됩니다."}
              </p>
              {tierMessage && <p className="pt-1 text-xs font-semibold text-emerald-700">{tierMessage}</p>}
            </div>
          )}

          {saveRecordStatus === "error" && (
            <p className="break-words text-xs text-red-600">저장 실패: {saveRecordError}</p>
          )}

          <button
            type="button"
            onClick={handleCopyShareLink}
            className="min-h-[48px] w-full rounded-xl bg-emerald-600 text-sm font-medium text-white hover:bg-emerald-700"
          >
            {shareStatus === "copied" ? "결과 링크가 복사되었습니다" : "결과 링크 복사"}
          </button>

          <Link
            href="/my-records"
            className="block rounded-xl bg-neutral-100 py-3 text-center text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-200"
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

          <p className="pt-1 text-center text-xs text-neutral-500">
            짐툴 공식 3대 인증 서비스 준비중 (영상 검증 + QR 인증서)
          </p>

          <AdSlot slotId="lifts-result" className="mt-2" />
        </div>
      )}

      {hasResult && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white/95 p-4 backdrop-blur">
          <div className="mx-auto flex max-w-md flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                setShareModalOpen(true);
                setShareError("");
                setShareCardUrl("");
                setShareNotice("");
                if (shareCardObjectUrl) URL.revokeObjectURL(shareCardObjectUrl);
                setShareCardObjectUrl("");
                setShareCardBlob(null);
              }}
              className="min-h-[52px] w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white"
            >
              📸 결과 카드 만들기
            </button>
            <button
              type="button"
              onClick={handleOpenRanking}
              className="min-h-[52px] w-full rounded-xl bg-amber-500 px-4 text-sm font-semibold text-white"
            >
              🏆 랭킹에 등록하기
            </button>
          </div>
        </div>
      )}

      {shareModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/45 p-4 sm:items-center sm:justify-center">
          <div className="w-[90%] max-w-sm rounded-2xl bg-white p-4">
            <h3 className="text-base font-semibold text-neutral-900">공유 카드 만들기</h3>
            <p className="mt-1 text-xs text-neutral-600">
              {shareCardBlob ? "생성 완료! 저장하거나 공유해보세요" : "공유 카드에 표시할 닉네임을 입력하세요"}
            </p>

            <input
              type="text"
              value={shareNickname}
              onChange={(e) => setShareNickname(e.target.value)}
              placeholder="닉네임"
              maxLength={12}
              className="mt-3 min-h-[48px] w-full rounded-xl border border-neutral-300 px-3 text-sm"
            />

            <button
              type="button"
              onClick={createShareCardAndPreview}
              className="mt-2 min-h-[48px] w-full rounded-xl bg-indigo-600 text-sm font-semibold text-white"
            >
              카드 생성하기
            </button>

            {shareNotice && <p className="mt-2 text-xs text-emerald-700">{shareNotice}</p>}
            {shareError && <p className="mt-2 text-xs text-red-600">{shareError}</p>}

            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={handleOpenCard}
                disabled={!shareCardObjectUrl}
                className="min-h-[44px] rounded-lg border border-neutral-300 text-xs font-medium disabled:opacity-50"
              >
                이미지 열기
              </button>
              <button
                type="button"
                onClick={handleDownloadCard}
                disabled={isDownloading || !shareCardBlob}
                className="min-h-[44px] rounded-lg bg-emerald-600 text-xs font-medium text-white disabled:opacity-50"
              >
                {isDownloading ? "다운로드 중" : "다운로드"}
              </button>
              <button
                type="button"
                onClick={handleShareCard}
                disabled={!shareCardBlob}
                className="min-h-[44px] rounded-lg bg-indigo-600 text-xs font-medium text-white disabled:opacity-50"
              >
                SNS 공유
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setShareModalOpen(false);
                if (shareCardObjectUrl) URL.revokeObjectURL(shareCardObjectUrl);
                setShareCardObjectUrl("");
                setShareCardBlob(null);
                setShareNotice("");
              }}
              className="mt-3 min-h-[44px] w-full rounded-xl border border-neutral-300 text-sm font-medium text-neutral-700"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {rankingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/45 p-4 sm:items-center sm:justify-center">
          <div className="w-[90%] max-w-sm rounded-2xl bg-white p-4">
            <h3 className="text-base font-semibold text-neutral-900">랭킹 등록하기</h3>
            <p className="mt-1 text-xs text-neutral-600">
              3대 기록을 저장하면 랭킹 등록 준비가 완료됩니다.
            </p>
            <p className="mt-2 text-sm text-neutral-800">총합 {result.totalKg}kg</p>

            <button
              type="button"
              onClick={handleSaveRecord}
              disabled={!hasSex || saveRecordStatus === "saving"}
              className="mt-3 min-h-[48px] w-full rounded-xl bg-amber-500 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saveRecordStatus === "saving"
                ? "저장 중..."
                : saveRecordStatus === "done"
                ? "저장 완료"
                : "3대 기록 저장하기"}
            </button>

            <button
              type="button"
              onClick={() => setRankingModalOpen(false)}
              className="mt-2 min-h-[44px] w-full rounded-xl border border-neutral-300 text-sm font-medium text-neutral-700"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

export default function LiftsPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-md px-4 py-10">
          <p className="text-center text-neutral-400">로딩 중...</p>
        </main>
      }
    >
      <LiftsContent />
    </Suspense>
  );
}
