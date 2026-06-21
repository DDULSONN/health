"use client";

import Link from "next/link";
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
  activeRequestStatus?: "submitted" | "reviewing" | "approved" | null;
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

const OPEN_KAKAO_URL = "https://open.kakao.com/o/s2gvTdhi";
const PHOTO_MAX_FILE_SIZE = 12 * 1024 * 1024;
const PHOTO_MAX_FILE_SIZE_MB = PHOTO_MAX_FILE_SIZE / (1024 * 1024);
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_PHOTO_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const UNSUPPORTED_IPHONE_PHOTO_EXTENSIONS = new Set(["heic", "heif"]);
const UNSUPPORTED_IPHONE_PHOTO_TYPES = new Set(["image/heic", "image/heif"]);

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

function getFileExtension(fileName: string) {
  const normalized = fileName.trim().toLowerCase();
  const idx = normalized.lastIndexOf(".");
  return idx >= 0 ? normalized.slice(idx + 1) : "";
}

function getOneOnOnePhotoError(file: File) {
  const ext = getFileExtension(file.name);
  const type = file.type.toLowerCase();

  if (UNSUPPORTED_IPHONE_PHOTO_TYPES.has(type) || UNSUPPORTED_IPHONE_PHOTO_EXTENSIONS.has(ext)) {
    return "HEIC 사진은 지원하지 않아요. 사진을 캡처해서 다시 올리거나 JPG/PNG/WebP로 선택해 주세요.";
  }
  if (file.size > PHOTO_MAX_FILE_SIZE) {
    return `사진은 ${PHOTO_MAX_FILE_SIZE_MB}MB 이하만 업로드할 수 있어요. 캡처해서 올리면 보통 해결됩니다.`;
  }
  if (!ALLOWED_PHOTO_TYPES.has(type) && !ALLOWED_PHOTO_EXTENSIONS.has(ext)) {
    return "JPG, PNG, WebP 사진만 업로드할 수 있어요. 안 되면 사진을 캡처해서 다시 올려주세요.";
  }
  return "";
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function friendlySubmitError(error: unknown) {
  if (isAbortError(error)) {
    return "요청 시간이 초과되었습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.";
  }
  if (error instanceof TypeError) {
    return "네트워크 연결이 불안정합니다. 잠시 후 다시 시도해주세요.";
  }
  return error instanceof Error ? error.message : String(error);
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs: number) {
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

async function fetchWithRetry(input: RequestInfo | URL, init: RequestInit, timeoutMs: number, retries: number) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetchWithTimeout(input, init, timeoutMs);
      if (!isRetryableStatus(res.status) || attempt === retries) return res;
      lastError = new Error(`Retryable response: ${res.status}`);
    } catch (error) {
      lastError = error;
      if (!isAbortError(error) && !(error instanceof TypeError)) throw error;
      if (attempt === retries) throw error;
    }
    await delay(700 * (attempt + 1));
  }
  throw lastError instanceof Error ? lastError : new Error("요청에 실패했습니다.");
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
  const [consentNoDirectContact, setConsentNoDirectContact] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const allConsented = consentFakeInfo && consentNoShow && consentFee && consentPrivacy && consentNoDirectContact;
  const canSubmitForm = isEditMode ? true : Boolean(status?.canWrite);
  const selectedPhotos = [photoSlotOne, photoSlotTwo].filter((file): file is File => Boolean(file));
  const writeBlockedMessage = useMemo(() => {
    if (isEditMode || !status || status.canWrite) return "";
    if (!status.phoneVerified || status.reason === "PHONE_NOT_VERIFIED") {
      return "휴대폰 인증이 완료된 계정만 신청할 수 있습니다.";
    }
    if (status.activeRequestStatus || status.reason === "ACTIVE_REQUEST_EXISTS") {
      return "이미 진행 중인 1:1 신청서가 있어요. 마이페이지 매칭탭에서 확인해주세요.";
    }
    if (status.writeStatus !== "approved" || status.reason === "WRITE_PAUSED") {
      return "현재 이 신청 작성은 일시 중지되어 있습니다.";
    }
    return "현재 신청 권한을 확인할 수 없습니다. 잠시 후 다시 시도해주세요.";
  }, [isEditMode, status]);
  const submitDisabledReason = useMemo(() => {
    if (submitting) return "";
    if (!canSubmitForm) return writeBlockedMessage;
    if (!allConsented) return "이용 전 확인 항목을 모두 체크하면 신청할 수 있습니다.";
    return "";
  }, [allConsented, canSubmitForm, submitting, writeBlockedMessage]);

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
          setConsentNoDirectContact(true);
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
    if (picked) {
      const photoError = getOneOnOnePhotoError(picked);
      if (photoError) {
        setError(`사진 ${slot}: ${photoError}`);
        if (slot === 1) {
          setPhotoSlotOne(null);
        } else {
          setPhotoSlotTwo(null);
        }
        return;
      }
      setError("");
    }
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
    if (submitting) return;
    setError("");
    setInfo("");

    for (const [index, file] of selectedPhotos.entries()) {
      const photoError = getOneOnOnePhotoError(file);
      if (photoError) {
        setError(`사진 ${index + 1}: ${photoError}`);
        return;
      }
    }

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
        for (const [index, file] of selectedPhotos.entries()) {
          setInfo(`사진 ${index + 1} 업로드 중...`);
          const fd = new FormData();
          fd.append("file", file);
          const uploadRes = await fetchWithRetry("/api/dating/1on1/upload", {
            method: "POST",
            body: fd,
          }, 60000, 1);
          const uploadBody = (await uploadRes.json().catch(() => ({}))) as { path?: string; error?: string };
          if (!uploadRes.ok || !uploadBody.path) {
            throw new Error(`사진 ${index + 1}: ${uploadBody.error ?? "사진 업로드에 실패했습니다. 캡처해서 다시 올려주세요."}`);
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
        consent_no_direct_contact: consentNoDirectContact,
      };

      setInfo(isEditMode ? "신청서 수정 중..." : "신청서 등록 중...");
      const res = await fetchWithTimeout(isEditMode ? "/api/dating/1on1/my" : "/api/dating/1on1/cards", {
        method: isEditMode ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEditMode ? { id: editId, ...payload } : payload),
      }, 60000);
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "신청 저장에 실패했습니다.");
      }

      setInfo(
        isEditMode
          ? "신청서가 수정되었습니다. 진행 상황은 마이페이지 매칭탭에서 확인할 수 있어요."
          : "신청서가 등록되었습니다. 후보 확인과 진행 상황은 마이페이지 매칭탭에서 확인해 주세요.",
      );
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
      setConsentNoDirectContact(false);

      if (status?.isAdmin) {
        reloadCards().catch((reloadError) => {
          console.error("[dating/1on1] reload after submit failed", reloadError);
        });
      }
      if (isEditMode) {
        router.replace("/mypage");
      }
    } catch (e) {
      setInfo("");
      setError(friendlySubmitError(e));
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
    <main className="min-h-screen bg-[#fff8f8] px-4 py-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex items-center justify-between">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-2xl font-light text-neutral-950 shadow-sm"
            aria-label="뒤로가기"
          >
            ‹
          </button>
          <h1 className="text-xl font-black tracking-tight text-neutral-950">
            {isEditMode ? "1:1 신청 수정" : "1:1 신청 작성"}
          </h1>
          <Link
            href="/mypage?section=matching"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-[11px] font-black text-neutral-500 shadow-sm"
            aria-label="매칭탭 보기"
          >
            MY
          </Link>
        </div>

        <section className="rounded-[28px] border border-rose-100 bg-white px-5 py-6 shadow-sm">
          <p className="text-xs font-black text-rose-500">1:1 소개팅</p>
          <h2 className="mt-2 text-2xl font-black leading-snug tracking-tight text-neutral-950">
            운영자가 후보를 연결하고,
            <br />
            서로 수락되면 번호 교환까지 이어집니다.
          </h2>
          <p className="mt-3 text-sm leading-6 text-neutral-600">
            신청은 무료이고, 최종 번호 교환 단계에서만 매칭비가 발생합니다.
          </p>
          <div className="mt-4 rounded-2xl bg-rose-50/70 px-4 py-3 text-xs leading-5 text-neutral-700">
            <p className="font-black text-neutral-950">개인정보 안내</p>
            <p className="mt-1">
              신청 내용은 1:1 매칭 운영과 안전 관리 목적으로만 사용되며 외부 목록에 공개되지 않습니다. 전화번호는 번호 교환 전까지 상대에게 공개되지 않습니다.
            </p>
          </div>
        </section>

        <section className="mt-4 rounded-[28px] border border-neutral-200 bg-white px-5 py-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="rounded-full bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700">신청 가능</span>
            <p className="text-sm font-black text-neutral-500">
              누적 신청 {Number(status?.totalApplications ?? 0).toLocaleString("ko-KR")}명
            </p>
          </div>
          <p className="mt-4 text-sm leading-6 text-neutral-600">
            신청서를 올리면 운영자가 검토 후 추천 후보와 진행 상태를 알려드립니다.
          </p>
          <a
            href={OPEN_KAKAO_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex min-h-10 items-center rounded-full border border-neutral-200 bg-white px-4 text-sm font-black text-neutral-800 hover:bg-neutral-50"
          >
            오픈카톡 문의
          </a>
        </section>

        <section className="mt-4 rounded-[28px] border border-rose-100 bg-white px-5 py-5 shadow-sm">
          <h2 className="text-lg font-black text-neutral-950">1:1 진행 방식</h2>
          <div className="mt-4 space-y-4">
            {[
              ["1", "신청서 작성", "사진 2장과 소개를 등록하면 운영자가 먼저 검토합니다."],
              ["2", "후보 전달 · 수락", "추천 후보를 고르고 서로 수락되면 번호 교환 단계가 열립니다."],
              ["3", "앱 결제로 번호 공개", "쌍방 수락 후 결제가 완료되면 연락처가 공개됩니다."],
            ].map(([step, title, body]) => (
              <div key={step} className="flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-50 text-base font-black text-rose-500">
                  {step}
                </span>
                <div>
                  <p className="text-base font-black text-neutral-950">{title}</p>
                  <p className="mt-1 text-sm leading-5 text-neutral-500">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

      <DatingAdultNotice />

      <section className="mt-4 rounded-[28px] border border-neutral-200 bg-white px-5 py-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-black text-neutral-950">필수 확인</h2>
            <p className="mt-1 text-xs text-neutral-500">신청 전 동의가 필요합니다.</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-black ${allConsented ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
            {allConsented ? "확인 완료" : "필수 확인"}
          </span>
        </div>
        <div className="mt-4 grid gap-2">
          <label className="flex min-h-[52px] cursor-pointer items-start gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
            <input type="checkbox" checked={consentFakeInfo} onChange={(e) => setConsentFakeInfo(e.target.checked)} className="mt-1 accent-rose-500" />
            <span>허위 정보 작성 시 이용이 제한될 수 있어요.</span>
          </label>
          <label className="flex min-h-[52px] cursor-pointer items-start gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
            <input type="checkbox" checked={consentNoShow} onChange={(e) => setConsentNoShow(e.target.checked)} className="mt-1 accent-rose-500" />
            <span>노쇼나 무단 취소 시 재이용이 제한될 수 있어요.</span>
          </label>
          <label className="flex min-h-[52px] cursor-pointer items-start gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
            <input type="checkbox" checked={consentFee} onChange={(e) => setConsentFee(e.target.checked)} className="mt-1 accent-rose-500" />
            <span>번호 교환 시 매칭비가 발생하고 연락처가 공개돼요.</span>
          </label>
          <label className="flex min-h-[52px] cursor-pointer items-start gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
            <input type="checkbox" checked={consentNoDirectContact} onChange={(e) => setConsentNoDirectContact(e.target.checked)} className="mt-1 accent-rose-500" />
            <span>신청서에는 휴대폰 번호, 카카오톡 ID, 인스타 계정, 오픈채팅 링크 등 외부 연락처를 적지 않습니다.</span>
          </label>
          <label className="flex min-h-[52px] cursor-pointer items-start gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
            <input type="checkbox" checked={consentPrivacy} onChange={(e) => setConsentPrivacy(e.target.checked)} className="mt-1 accent-rose-500" />
            <span>개인정보는 1:1 매칭 진행, 운영 확인, 안전 관리 목적으로만 사용돼요.</span>
          </label>
        </div>
      </section>

      <section className="mt-4 rounded-[28px] border border-neutral-200 bg-white px-5 py-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-black text-neutral-950">{isEditMode ? "신청서 수정" : "신청 작성"}</h2>
            <p className="mt-1 text-xs text-neutral-500">인증과 작성 권한이 확인된 계정만 신청할 수 있습니다.</p>
          </div>
          <Link href="/mypage?section=matching" className="inline-flex min-h-9 items-center rounded-full border border-neutral-200 bg-white px-3 text-xs font-black text-neutral-700 hover:bg-neutral-50">
            매칭탭 보기
          </Link>
        </div>
        {isEditMode && <p className="mt-1 text-xs text-neutral-500">접수중 상태일 때만 본인 신청서를 수정할 수 있습니다.</p>}
        {!isEditMode && writeBlockedMessage && (
          <p className="mt-2 text-xs font-medium text-amber-700">{writeBlockedMessage}</p>
        )}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {info && (
          <div className="mt-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3">
            <p className="text-sm font-semibold text-emerald-800">{info}</p>
            <Link href="/mypage?section=matching" className="mt-2 inline-flex text-xs font-bold text-emerald-700 underline">
              마이페이지 매칭탭으로 이동
            </Link>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-7">
          <div>
            <p className="mb-3 text-base font-black text-neutral-950">성별</p>
            <div className="grid grid-cols-2 overflow-hidden rounded-full border border-neutral-200 bg-white">
              {[
                ["male", "남자"],
                ["female", "여자"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSex(value as "male" | "female")}
                  className={`h-12 text-sm font-black transition ${sex === value ? "bg-rose-100 text-neutral-950" : "bg-white text-neutral-500"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-3 text-base font-black text-neutral-950">기본 정보</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" className="h-14 w-full rounded-2xl border border-neutral-200 bg-white px-4 text-base text-neutral-900 placeholder:text-neutral-500 sm:col-span-2" required />
              <input value={birthYear} onChange={(e) => setBirthYear(e.target.value)} placeholder="출생연도" className="h-14 w-full rounded-2xl border border-neutral-200 bg-white px-4 text-base text-neutral-900 placeholder:text-neutral-500" inputMode="numeric" required />
              <input value={heightCm} onChange={(e) => setHeightCm(e.target.value)} placeholder="키(cm)" className="h-14 w-full rounded-2xl border border-neutral-200 bg-white px-4 text-base text-neutral-900 placeholder:text-neutral-500" inputMode="numeric" required />
              <input value={job} onChange={(e) => setJob(e.target.value)} placeholder="직업" className="h-14 w-full rounded-2xl border border-neutral-200 bg-white px-4 text-base text-neutral-900 placeholder:text-neutral-500 sm:col-span-2" required />
              <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="지역" className="h-14 w-full rounded-2xl border border-neutral-200 bg-white px-4 text-base text-neutral-900 placeholder:text-neutral-500 sm:col-span-2" required />
            </div>
          </div>

          <div>
            <p className="mb-3 text-base font-black text-neutral-950">소개 내용</p>
            <div className="grid gap-3">
              <textarea value={introText} onChange={(e) => setIntroText(e.target.value)} placeholder="자기소개" className="min-h-20 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-4 text-base text-neutral-900 placeholder:text-neutral-500" required />
              <textarea value={strengthsText} onChange={(e) => setStrengthsText(e.target.value)} placeholder="내 강점" className="min-h-20 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-4 text-base text-neutral-900 placeholder:text-neutral-500" required />
              <textarea value={preferredPartnerText} onChange={(e) => setPreferredPartnerText(e.target.value)} placeholder="원하는 상대" className="min-h-20 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-4 text-base text-neutral-900 placeholder:text-neutral-500" required />
            </div>
          </div>

          <div>
            <p className="mb-3 text-base font-black text-neutral-950">생활 정보</p>
            <div className="flex flex-wrap gap-2">
              {SMOKING_OPTIONS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setSmoking(item.value)}
                  className={`h-11 rounded-full border px-5 text-sm font-black transition ${smoking === item.value ? "border-rose-500 bg-rose-50 text-rose-700" : "border-neutral-200 bg-white text-neutral-600"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {WORKOUT_OPTIONS.map((item) => (
                <button
                  key={item.value || "empty"}
                  type="button"
                  onClick={() => setWorkoutFrequency(item.value)}
                  className={`h-11 rounded-full border px-5 text-sm font-black transition ${workoutFrequency === item.value ? "border-rose-500 bg-rose-50 text-rose-700" : "border-neutral-200 bg-white text-neutral-600"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="block text-base font-black text-neutral-950">사진 2장</label>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-neutral-600">
                {selectedPhotos.length}/2 선택
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-neutral-500">
              정면이 잘 보이는 사진 2장을 넣어주세요. 수정 시 사진을 바꾸지 않으면 기존 사진이 유지됩니다.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="flex aspect-[4/5] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-200 bg-white px-3 text-center text-neutral-400">
                <span className="text-sm font-black text-neutral-500">사진 1</span>
                <span className="mt-2 text-xs leading-5">{photoSlotOne ? photoSlotOne.name : "눌러서 선택"}</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    handleSlotChange(1, e.target.files);
                    if (e.target.files?.[0] && getOneOnOnePhotoError(e.target.files[0])) e.currentTarget.value = "";
                  }}
                  className="sr-only"
                />
                {photoSlotOne && (
                  <button type="button" onClick={(e) => { e.preventDefault(); clearSlot(1); }} className="mt-3 text-xs font-black text-rose-600 underline">
                    선택 취소
                  </button>
                )}
              </label>
              <label className="flex aspect-[4/5] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-200 bg-white px-3 text-center text-neutral-400">
                <span className="text-sm font-black text-neutral-500">사진 2</span>
                <span className="mt-2 text-xs leading-5">{photoSlotTwo ? photoSlotTwo.name : "눌러서 선택"}</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    handleSlotChange(2, e.target.files);
                    if (e.target.files?.[0] && getOneOnOnePhotoError(e.target.files[0])) e.currentTarget.value = "";
                  }}
                  className="sr-only"
                />
                {photoSlotTwo && (
                  <button type="button" onClick={(e) => { e.preventDefault(); clearSlot(2); }} className="mt-3 text-xs font-black text-rose-600 underline">
                    선택 취소
                  </button>
                )}
              </label>
            </div>
            <p className="mt-3 text-xs text-neutral-500">
              두 장 모두 업로드해야 신청할 수 있습니다. JPG, PNG, WebP / 사진당 12MB 이하만 가능해요.
            </p>
            <p className="mt-1 text-xs text-amber-700">아이폰 HEIC 사진이 안 올라가면 사진을 캡처해서 다시 올려주세요.</p>
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

          <button type="submit" disabled={!allConsented || !canSubmitForm || submitting} className="h-14 w-full rounded-full bg-rose-500 px-4 text-base font-black text-white shadow-lg shadow-rose-200 disabled:cursor-not-allowed disabled:opacity-50">
            {submitting ? "처리 중..." : isEditMode ? "수정 저장" : "신청서 제출"}
          </button>
          {submitDisabledReason && (
            <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              <p>{submitDisabledReason}</p>
              {!isEditMode && (status.activeRequestStatus || status.reason === "ACTIVE_REQUEST_EXISTS") && (
                <Link href="/mypage?section=matching" className="mt-1 inline-flex font-bold underline">
                  마이페이지 매칭탭 보기
                </Link>
              )}
            </div>
          )}
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
      </div>
    </main>
  );
}
