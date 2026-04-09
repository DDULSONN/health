"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import DatingAdultNotice from "@/components/DatingAdultNotice";

type WriteStatusResponse = {
  loggedIn: boolean;
  isAdmin: boolean;
  phoneVerified: boolean;
  writeStatus: "approved" | "paused";
  canWrite: boolean;
  reason: string | null;
  totalApplications?: number;
};

type CardItem = {
  id: string;
  sex: "male" | "female";
  name: string;
  birth_year: number;
  height_cm: number;
  job: string;
  region: string;
  phone: string;
  intro_text: string;
  strengths_text: string;
  preferred_partner_text: string;
  smoking: "non_smoker" | "occasional" | "smoker";
  workout_frequency: "none" | "1_2" | "3_4" | "5_plus" | null;
  status: "submitted" | "reviewing" | "approved" | "rejected";
  created_at: string;
  photo_signed_urls: string[];
};

const SMOKING_OPTIONS = [
  { value: "non_smoker", label: "비흡연" },
  { value: "occasional", label: "가끔" },
  { value: "smoker", label: "흡연" },
] as const;

const WORKOUT_OPTIONS = [
  { value: "", label: "선택 안함" },
  { value: "none", label: "안함" },
  { value: "1_2", label: "주 1-2회" },
  { value: "3_4", label: "주 3-4회" },
  { value: "5_plus", label: "주 5회 이상" },
] as const;

function smokingLabel(value: CardItem["smoking"]): string {
  if (value === "non_smoker") return "비흡연";
  if (value === "occasional") return "가끔";
  return "흡연";
}

function workoutLabel(value: CardItem["workout_frequency"]): string {
  if (value === "none") return "안함";
  if (value === "1_2") return "주 1-2회";
  if (value === "3_4") return "주 3-4회";
  if (value === "5_plus") return "주 5회 이상";
  return "-";
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export default function DatingOneOnOnePage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-3xl px-4 py-10">
          <p className="text-sm text-neutral-500">로딩 중...</p>
        </main>
      }
    >
      <DatingOneOnOnePageContent />
    </Suspense>
  );
}

function DatingOneOnOnePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const editId = (searchParams.get("editId") ?? "").trim();
  const isEditMode = editId.length > 0;

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<WriteStatusResponse | null>(null);
  const [cards, setCards] = useState<CardItem[]>([]);

  const [sex, setSex] = useState<"male" | "female">("male");
  const [name, setName] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [job, setJob] = useState("");
  const [region, setRegion] = useState("");
  const [introText, setIntroText] = useState("");
  const [strengthsText, setStrengthsText] = useState("");
  const [preferredPartnerText, setPreferredPartnerText] = useState("");
  const [smoking, setSmoking] = useState<"non_smoker" | "occasional" | "smoker">("non_smoker");
  const [workoutFrequency, setWorkoutFrequency] = useState("");
  const [photoSlotOne, setPhotoSlotOne] = useState<File | null>(null);
  const [photoSlotTwo, setPhotoSlotTwo] = useState<File | null>(null);
  const [existingPhotoUrls, setExistingPhotoUrls] = useState<string[]>([]);

  const [consentFakeInfo, setConsentFakeInfo] = useState(false);
  const [consentNoShow, setConsentNoShow] = useState(false);
  const [consentFee, setConsentFee] = useState(false);
  const [consentPrivacy, setConsentPrivacy] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const allConsented = consentFakeInfo && consentNoShow && consentFee && consentPrivacy;
  const canSubmitForm = isEditMode ? true : Boolean(status?.canWrite);
  const selectedPhotos = [photoSlotOne, photoSlotTwo].filter((file): file is File => Boolean(file));

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          router.replace("/login?redirect=/dating/1on1");
          return;
        }

        const statusRes = await fetch("/api/dating/1on1/write-status", { cache: "no-store" });
        const statusBody = (await statusRes.json().catch(() => ({}))) as WriteStatusResponse & { error?: string };
        if (!statusRes.ok) {
          throw new Error(statusBody.error ?? "권한 상태를 불러오지 못했습니다.");
        }

        if (!mounted) return;
        setStatus(statusBody);

        if (statusBody.isAdmin) {
          const cardsRes = await fetch("/api/dating/1on1/cards", { cache: "no-store" });
          const cardsBody = (await cardsRes.json().catch(() => ({}))) as { items?: CardItem[]; error?: string };
          if (!cardsRes.ok) {
            throw new Error(cardsBody.error ?? "신청 목록을 불러오지 못했습니다.");
          }
          if (!mounted) return;
          setCards(cardsBody.items ?? []);
        }

        if (isEditMode) {
          const myRes = await fetch("/api/dating/1on1/my", { cache: "no-store" });
          const myBody = (await myRes.json().catch(() => ({}))) as { items?: CardItem[]; error?: string };
          if (!myRes.ok) {
            throw new Error(myBody.error ?? "수정할 신청서를 불러오지 못했습니다.");
          }
          const editTarget = (myBody.items ?? []).find((item) => item.id === editId);
          if (!editTarget) {
            throw new Error("수정할 신청서를 찾을 수 없습니다.");
          }
          if (editTarget.status !== "submitted") {
            throw new Error("접수중 상태일 때만 수정할 수 있습니다.");
          }

          if (!mounted) return;
          setSex(editTarget.sex);
          setName(editTarget.name);
          setBirthYear(String(editTarget.birth_year));
          setHeightCm(String(editTarget.height_cm));
          setJob(editTarget.job);
          setRegion(editTarget.region);
          setIntroText(editTarget.intro_text);
          setStrengthsText(editTarget.strengths_text);
          setPreferredPartnerText(editTarget.preferred_partner_text);
          setSmoking(editTarget.smoking);
          setWorkoutFrequency(editTarget.workout_frequency ?? "");
          setExistingPhotoUrls(Array.isArray(editTarget.photo_signed_urls) ? editTarget.photo_signed_urls : []);
          setConsentFakeInfo(true);
          setConsentNoShow(true);
          setConsentFee(true);
          setConsentPrivacy(true);
        }
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [editId, isEditMode, router, supabase]);

  const handleSlotChange = (slot: 1 | 2, files: FileList | null) => {
    const picked = files?.[0] ?? null;
    if (slot === 1) {
      setPhotoSlotOne(picked);
      return;
    }
    setPhotoSlotTwo(picked);
  };

  const clearSlot = (slot: 1 | 2) => {
    if (slot === 1) {
      setPhotoSlotOne(null);
      return;
    }
    setPhotoSlotTwo(null);
  };

  const reloadCards = async () => {
    const cardsRes = await fetch("/api/dating/1on1/cards", { cache: "no-store" });
    const cardsBody = (await cardsRes.json().catch(() => ({}))) as { items?: CardItem[]; error?: string };
    if (!cardsRes.ok) {
      throw new Error(cardsBody.error ?? "신청 목록을 불러오지 못했습니다.");
    }
    setCards(cardsBody.items ?? []);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");

    if (!isEditMode && !status?.canWrite) {
      setError("현재 신청 권한이 없습니다.");
      return;
    }
    if (!allConsented) {
      setError("필수 동의 항목을 모두 체크해주세요.");
      return;
    }
    if ((!isEditMode && selectedPhotos.length !== 2) || (isEditMode && selectedPhotos.length > 0 && selectedPhotos.length !== 2)) {
      setError(isEditMode ? "사진을 변경하려면 사진 1과 사진 2를 모두 선택해주세요." : "사진 1과 사진 2를 모두 업로드해주세요.");
      return;
    }

    setSubmitting(true);
    try {
      const uploadedPaths: string[] = [];
      if (selectedPhotos.length > 0) {
        for (const file of selectedPhotos) {
          const fd = new FormData();
          fd.append("file", file);
          const uploadRes = await fetchWithTimeout("/api/dating/1on1/upload", {
            method: "POST",
            body: fd,
          }, 45000);
          const uploadBody = (await uploadRes.json().catch(() => ({}))) as { path?: string; error?: string };
          if (!uploadRes.ok || !uploadBody.path) {
            throw new Error(uploadBody.error ?? "사진 업로드에 실패했습니다.");
          }
          uploadedPaths.push(uploadBody.path);
        }
      }

      const payload = {
        sex,
        name: name.trim(),
        birth_year: Number(birthYear),
        height_cm: Number(heightCm),
        job: job.trim(),
        region: region.trim(),
        intro_text: introText.trim(),
        strengths_text: strengthsText.trim(),
        preferred_partner_text: preferredPartnerText.trim(),
        smoking,
        workout_frequency: workoutFrequency || null,
        ...(uploadedPaths.length > 0 ? { photo_paths: uploadedPaths } : {}),
        consent_fake_info: consentFakeInfo,
        consent_no_show: consentNoShow,
        consent_fee: consentFee,
        consent_privacy: consentPrivacy,
      };

      const res = await fetchWithTimeout(isEditMode ? "/api/dating/1on1/my" : "/api/dating/1on1/cards", {
        method: isEditMode ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEditMode ? { id: editId, ...payload } : payload),
      }, 45000);
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "신청 저장에 실패했습니다.");
      }

      setInfo(isEditMode ? "신청서가 수정되었습니다." : "신청서가 등록되었습니다.");
      setName("");
      setSex("male");
      setBirthYear("");
      setHeightCm("");
      setJob("");
      setRegion("");
      setIntroText("");
      setStrengthsText("");
      setPreferredPartnerText("");
      setSmoking("non_smoker");
      setWorkoutFrequency("");
      setPhotoSlotOne(null);
      setPhotoSlotTwo(null);
      setExistingPhotoUrls([]);
      setConsentFakeInfo(false);
      setConsentNoShow(false);
      setConsentFee(false);
      setConsentPrivacy(false);

      if (status?.isAdmin) {
        await reloadCards();
      }
      if (isEditMode) {
        router.replace("/mypage");
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setError("요청 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.");
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-neutral-500">로딩 중...</p>
      </main>
    );
  }

  if (!status) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-red-600">권한 상태를 확인하지 못했습니다.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h1 className="text-2xl font-bold text-neutral-900">
          {isEditMode ? "1:1 오프라인 소개팅 신청서 수정" : "1:1 오프라인 소개팅"}
        </h1>
        <p className="mt-2 text-sm text-neutral-700">운영자가 직접 매칭하는 오프라인 소개팅 서비스입니다.</p>
        <p className="text-sm text-neutral-700">신청은 무료이며, 매칭 성사 시에만 매칭비 20,000원이 발생합니다.</p>
        <p className="text-sm text-neutral-700">신청 내용은 외부에 공개되지 않습니다.</p>
        <p className="mt-2 text-sm font-medium text-emerald-700">
          지금까지 {Number(status?.totalApplications ?? 0).toLocaleString("ko-KR")}명이 1:1 소개팅을 신청했습니다.
        </p>
        <p className="mt-2 text-xs text-neutral-500">
          카드 본문에는 상대에게 전달할 정보만 담기며, 전화번호는 운영자 확인용으로만 별도 보관됩니다.
        </p>
      </section>

      <DatingAdultNotice />

      <section className="mt-4 rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-neutral-900">주의사항 및 동의</h2>
        <div className="mt-3 space-y-2 text-sm text-neutral-700">
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={consentFakeInfo} onChange={(e) => setConsentFakeInfo(e.target.checked)} className="mt-1" />
            허위 정보 작성 시 서비스 이용이 제한될 수 있음에 동의합니다.
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={consentNoShow} onChange={(e) => setConsentNoShow(e.target.checked)} className="mt-1" />
            노쇼 및 무단 취소 시 향후 이용이 제한될 수 있음에 동의합니다.
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={consentFee} onChange={(e) => setConsentFee(e.target.checked)} className="mt-1" />
            매칭 성사 시 매칭비가 발생함을 이해했습니다.
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={consentPrivacy} onChange={(e) => setConsentPrivacy(e.target.checked)} className="mt-1" />
            개인정보는 매칭 목적에 한해 사용됨에 동의합니다.
          </label>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-neutral-900">{isEditMode ? "신청서 수정" : "신청 작성"}</h2>
        <p className="mt-1 text-xs text-neutral-500">로그인 + 휴대폰 인증 + 작성 권한 승인 상태에서만 신청이 가능합니다.</p>
        <p className="mt-1 text-xs text-neutral-500">접수중 상태일 때만 본인 신청서를 수정할 수 있습니다.</p>
        {!isEditMode && !status.phoneVerified && (
          <p className="mt-2 text-xs font-medium text-amber-700">휴대폰 인증이 완료된 계정만 신청할 수 있습니다.</p>
        )}
        {!isEditMode && status.writeStatus !== "approved" && (
          <p className="mt-2 text-xs font-medium text-amber-700">현재 이 신청 작성은 일시 중지되어 있습니다.</p>
        )}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {info && <p className="mt-2 text-sm text-emerald-700">{info}</p>}

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <select value={sex} onChange={(e) => setSex(e.target.value as "male" | "female")} className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900">
            <option value="male">성별: 남자</option>
            <option value="female">성별: 여자</option>
          </select>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름 (실명 또는 활동명)" className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-500" required />
          <input value={birthYear} onChange={(e) => setBirthYear(e.target.value)} placeholder="나이 (출생연도 권장, 예: 1996)" className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-500" inputMode="numeric" required />
          <input value={heightCm} onChange={(e) => setHeightCm(e.target.value)} placeholder="키(cm)" className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-500" inputMode="numeric" required />
          <input value={job} onChange={(e) => setJob(e.target.value)} placeholder="직업" className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-500" required />
          <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="지역 (시군구 기준)" className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-500" required />
          <textarea value={introText} onChange={(e) => setIntroText(e.target.value)} placeholder="자기소개" className="min-h-24 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-500" required />
          <textarea value={strengthsText} onChange={(e) => setStrengthsText(e.target.value)} placeholder="자기 장점" className="min-h-20 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-500" required />
          <textarea value={preferredPartnerText} onChange={(e) => setPreferredPartnerText(e.target.value)} placeholder="상대방에게 원하는 점" className="min-h-20 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-500" required />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <select value={smoking} onChange={(e) => setSmoking(e.target.value as "non_smoker" | "occasional" | "smoker")} className="h-11 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900">
              {SMOKING_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>흡연 여부: {item.label}</option>
              ))}
            </select>
            <select value={workoutFrequency} onChange={(e) => setWorkoutFrequency(e.target.value)} className="h-11 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900">
              {WORKOUT_OPTIONS.map((item) => (
                <option key={item.value || "empty"} value={item.value}>운동 빈도: {item.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-neutral-700">사진 업로드</label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-sm font-medium text-neutral-800">사진 1</p>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => handleSlotChange(1, e.target.files)}
                  className="mt-2 block w-full text-sm"
                />
                <p className="mt-2 text-xs text-neutral-500">{photoSlotOne ? photoSlotOne.name : "아직 선택하지 않았습니다."}</p>
                {photoSlotOne && (
                  <button type="button" onClick={() => clearSlot(1)} className="mt-2 text-xs font-medium text-neutral-600 underline">
                    사진 1 선택 취소
                  </button>
                )}
              </div>
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-sm font-medium text-neutral-800">사진 2</p>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => handleSlotChange(2, e.target.files)}
                  className="mt-2 block w-full text-sm"
                />
                <p className="mt-2 text-xs text-neutral-500">{photoSlotTwo ? photoSlotTwo.name : "아직 선택하지 않았습니다."}</p>
                {photoSlotTwo && (
                  <button type="button" onClick={() => clearSlot(2)} className="mt-2 text-xs font-medium text-neutral-600 underline">
                    사진 2 선택 취소
                  </button>
                )}
              </div>
            </div>
            <p className="mt-2 text-xs text-neutral-500">두 장 모두 업로드해야 신청할 수 있습니다. 업로드 시 WebP로 최적화됩니다.</p>
            {isEditMode && existingPhotoUrls.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-neutral-500">수정 시 사진을 바꾸지 않으면 기존 사진 2장이 유지됩니다. 바꾸려면 사진 1과 사진 2를 모두 새로 선택해주세요.</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {existingPhotoUrls.map((url, idx) => (
                    <a key={`existing-${idx}`} href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-neutral-200 bg-white">
                      <div className="flex h-24 w-full items-center justify-center bg-neutral-50">
                        <img
                          src={url}
                          alt={`기존 사진 ${idx + 1}`}
                          decoding="async"
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button type="submit" disabled={!allConsented || !canSubmitForm || submitting} className="h-11 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
            {submitting ? "처리 중..." : isEditMode ? "수정 저장" : "글 쓰기"}
          </button>
        </form>
      </section>

      {status.isAdmin && (
        <section className="mt-4 rounded-2xl border border-neutral-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-neutral-900">등록된 신청 카드 (관리자 전용)</h2>
          {cards.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">등록된 신청서가 없습니다.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {cards.map((card) => (
                <article key={card.id} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-neutral-900">{card.name} / {card.birth_year}년생 / {card.height_cm}cm</p>
                    <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs text-neutral-700">{card.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">직업 {card.job} / 지역 {card.region} / 작성일 {new Date(card.created_at).toLocaleString("ko-KR")}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {card.photo_signed_urls.map((url, idx) => (
                      <a key={`${card.id}-${idx}`} href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-neutral-200 bg-white">
                        <div className="flex h-32 w-full items-center justify-center bg-neutral-50">
                          <img
                            src={url}
                            alt={`소개팅 신청 사진 ${idx + 1}`}
                            decoding="async"
                            className="max-h-full max-w-full object-contain"
                          />
                        </div>
                      </a>
                    ))}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-800">{card.intro_text}</p>
                  <p className="mt-1 text-sm text-neutral-700">장점: {card.strengths_text}</p>
                  <p className="mt-1 text-sm text-neutral-700">원하는 점: {card.preferred_partner_text}</p>
                  <p className="mt-1 text-xs text-neutral-600">흡연 {smokingLabel(card.smoking)} / 운동 빈도 {workoutLabel(card.workout_frequency)}</p>
                  <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1">
                    <p className="text-xs font-medium text-amber-800">운영자 확인용 연락처: {card.phone}</p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
