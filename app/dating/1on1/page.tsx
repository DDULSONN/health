"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
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
  admin_tags?: string[] | null;
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

const BIRTH_YEAR_HELP_MESSAGE = "나이가 아니라 출생연도 4자리를 입력해 주세요. 예: 1996";
const ONE_ON_ONE_USER_EDIT_USED_TAG = "one_on_one_user_edit_used";
const FORM_STEPS = [
  { title: "기본 정보", description: "이름과 성별을 알려주세요." },
  { title: "프로필", description: "후보 추천에 필요한 정보를 입력해주세요." },
  { title: "소개", description: "나를 잘 보여주는 내용을 적어주세요." },
  { title: "생활과 사진", description: "생활 정보와 사진 2장을 등록해주세요." },
  { title: "최종 확인", description: "입력 내용과 필수 안내를 확인해주세요." },
] as const;

function hasOneOnOneUserEditBeenUsed(card: Pick<CardItem, "admin_tags">) {
  return Array.isArray(card.admin_tags) && card.admin_tags.includes(ONE_ON_ONE_USER_EDIT_USED_TAG);
}

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
  const isLocalPreview = process.env.NODE_ENV === "development" && searchParams.get("preview") === "1";

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
  const [formStep, setFormStep] = useState(1);
  const birthYearInputRef = useRef<HTMLInputElement | null>(null);
  const formTopRef = useRef<HTMLDivElement | null>(null);

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

  const focusBirthYearInput = () => {
    const target = birthYearInputRef.current;
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => {
      target.focus({ preventScroll: true });
    }, 220);
  };

  const scrollToFormTop = () => {
    window.requestAnimationFrame(() => {
      formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const getStepError = (step: number) => {
    if (step === 1) {
      if (!name.trim() || name.trim().length > 30) return "이름을 30자 이내로 입력해주세요.";
      return "";
    }
    if (step === 2) {
      const parsedBirthYear = Number(birthYear);
      if (!Number.isInteger(parsedBirthYear) || parsedBirthYear < 1960 || parsedBirthYear > 2010) {
        return BIRTH_YEAR_HELP_MESSAGE;
      }
      const parsedHeight = Number(heightCm);
      if (!Number.isInteger(parsedHeight) || parsedHeight < 120 || parsedHeight > 230) {
        return "키는 120~230cm 사이의 숫자로 입력해주세요.";
      }
      if (!job.trim() || job.trim().length > 80) return "직업을 80자 이내로 입력해주세요.";
      if (!region.trim() || region.trim().length > 80) return "지역을 80자 이내로 입력해주세요.";
      return "";
    }
    if (step === 3) {
      if (!introText.trim() || introText.trim().length > 2000) return "자기소개를 입력해주세요.";
      if (!strengthsText.trim() || strengthsText.trim().length > 1000) return "내 강점을 입력해주세요.";
      if (!preferredPartnerText.trim() || preferredPartnerText.trim().length > 1000) return "원하는 상대를 입력해주세요.";
      return "";
    }
    if (step === 4) {
      for (const [index, file] of selectedPhotos.entries()) {
        const photoError = getOneOnOnePhotoError(file);
        if (photoError) return `사진 ${index + 1}: ${photoError}`;
      }
      if ((!isEditMode && selectedPhotos.length !== 2) || (isEditMode && selectedPhotos.length > 0 && selectedPhotos.length !== 2)) {
        return isEditMode ? "사진을 변경하려면 사진 1과 사진 2를 모두 선택해주세요." : "사진 1과 사진 2를 모두 업로드해주세요.";
      }
    }
    return "";
  };

  const moveToStep = (nextStep: number) => {
    setError("");
    setFormStep(Math.min(5, Math.max(1, nextStep)));
    scrollToFormTop();
  };

  const handleNextStep = () => {
    const stepError = getStepError(formStep);
    if (stepError) {
      setError(stepError);
      if (formStep === 2 && stepError === BIRTH_YEAR_HELP_MESSAGE) focusBirthYearInput();
      return;
    }
    moveToStep(formStep + 1);
  };

  useEffect(() => {
    if (isLocalPreview) {
      setStatus({
        loggedIn: true,
        isAdmin: false,
        phoneVerified: true,
        writeStatus: "approved",
        canWrite: true,
        reason: null,
        activeRequestStatus: null,
        totalApplications: 0,
      });
      setLoading(false);
      return;
    }

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
          if (hasOneOnOneUserEditBeenUsed(editTarget)) {
            throw new Error("1:1 신청서는 한 번만 수정할 수 있습니다.");
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
  }, [editId, isEditMode, isLocalPreview, router, supabase]);

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

    for (let step = 1; step <= 4; step += 1) {
      const stepError = getStepError(step);
      if (stepError) {
        setFormStep(step);
        setError(stepError);
        scrollToFormTop();
        if (step === 2 && stepError === BIRTH_YEAR_HELP_MESSAGE) {
          window.setTimeout(focusBirthYearInput, 120);
        }
        return;
      }
    }
    const parsedBirthYear = Number(birthYear);

    if (!isEditMode && !status?.canWrite) {
      setError("현재 신청 권한이 없습니다.");
      return;
    }
    if (!allConsented) {
      setFormStep(5);
      setError("필수 동의 항목을 모두 체크해주세요.");
      scrollToFormTop();
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
        birth_year: parsedBirthYear,
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
        const message = body.error ?? "신청 저장에 실패했습니다.";
        if (message.includes("출생연도")) {
          setFormStep(2);
          setError(message);
          scrollToFormTop();
          window.setTimeout(focusBirthYearInput, 120);
          return;
        }
        throw new Error(message);
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
      setFormStep(1);

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
          {isEditMode ? (
            <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold leading-5 text-amber-800">
              신청서 수정은 한 번만 가능합니다. 저장 전 내용을 다시 확인해 주세요.
            </p>
          ) : null}
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

      {!isLocalPreview && <DatingAdultNotice />}

      <section ref={formTopRef} className="mt-4 scroll-mt-4 rounded-[28px] border border-neutral-200 bg-white px-5 py-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-black text-neutral-950">{isEditMode ? "신청서 수정" : "신청 작성"}</h2>
            <p className="mt-1 text-xs text-neutral-500">한 단계씩 작성하면 약 3분 정도 걸려요.</p>
          </div>
          <Link href="/mypage?section=matching" className="inline-flex min-h-9 items-center rounded-full border border-neutral-200 bg-white px-3 text-xs font-black text-neutral-700 hover:bg-neutral-50">
            매칭탭 보기
          </Link>
        </div>
        {isEditMode && <p className="mt-1 text-xs text-neutral-500">접수중 상태일 때만 본인 신청서를 수정할 수 있습니다.</p>}
        {!isEditMode && writeBlockedMessage && (
          <p className="mt-2 text-xs font-medium text-amber-700">{writeBlockedMessage}</p>
        )}
        <div className="mt-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black text-rose-500">{formStep} / {FORM_STEPS.length}</p>
              <p className="mt-1 text-xl font-black text-neutral-950">{FORM_STEPS[formStep - 1]?.title}</p>
              <p className="mt-1 text-sm text-neutral-500">{FORM_STEPS[formStep - 1]?.description}</p>
            </div>
            <span className="shrink-0 text-xs font-bold text-neutral-400">{Math.round((formStep / FORM_STEPS.length) * 100)}%</span>
          </div>
          <div className="mt-4 grid grid-cols-5 gap-1.5" aria-label={`신청서 ${formStep}단계`}>
            {FORM_STEPS.map((step, index) => (
              <div key={step.title} className={`h-1.5 rounded-full ${index < formStep ? "bg-rose-500" : "bg-neutral-100"}`} />
            ))}
          </div>
        </div>

        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-3 text-sm font-semibold text-red-700">{error}</p>}
        {info && (
          <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3">
            <p className="text-sm font-semibold text-emerald-800">{info}</p>
            <Link href="/mypage?section=matching" className="mt-2 inline-flex text-xs font-bold text-emerald-700 underline">
              마이페이지 매칭탭으로 이동
            </Link>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="mt-6">
          {formStep === 1 && (
            <div className="space-y-5">
              <div>
                <label htmlFor="one-on-one-name" className="mb-2 block text-sm font-black text-neutral-900">이름</label>
                <input id="one-on-one-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="이름을 입력해주세요" autoComplete="name" className="h-14 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 text-base text-neutral-900 placeholder:text-neutral-400 focus:border-rose-300 focus:bg-white focus:outline-none" />
              </div>
              <div>
                <p className="mb-2 text-sm font-black text-neutral-900">성별</p>
                <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 p-1">
                  {[["male", "남자"], ["female", "여자"]].map(([value, label]) => (
                    <button key={value} type="button" onClick={() => setSex(value as "male" | "female")} className={`h-12 rounded-xl text-sm font-black transition ${sex === value ? "bg-white text-neutral-950 shadow-sm" : "text-neutral-500"}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {formStep === 2 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="one-on-one-birth-year" className="mb-2 block text-sm font-black text-neutral-900">출생연도</label>
                <input id="one-on-one-birth-year" ref={birthYearInputRef} value={birthYear} onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="예: 1996" className="h-14 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 text-base text-neutral-900 placeholder:text-neutral-400 focus:border-rose-300 focus:bg-white focus:outline-none" inputMode="numeric" />
                <p className="mt-1.5 text-xs text-neutral-400">나이가 아닌 출생연도 4자리</p>
              </div>
              <div>
                <label htmlFor="one-on-one-height" className="mb-2 block text-sm font-black text-neutral-900">키</label>
                <div className="relative">
                  <input id="one-on-one-height" value={heightCm} onChange={(e) => setHeightCm(e.target.value.replace(/\D/g, "").slice(0, 3))} placeholder="예: 175" className="h-14 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 pr-12 text-base text-neutral-900 placeholder:text-neutral-400 focus:border-rose-300 focus:bg-white focus:outline-none" inputMode="numeric" />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-neutral-400">cm</span>
                </div>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="one-on-one-job" className="mb-2 block text-sm font-black text-neutral-900">직업</label>
                <input id="one-on-one-job" value={job} onChange={(e) => setJob(e.target.value)} maxLength={80} placeholder="예: 회사원, 간호사, 자영업" className="h-14 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 text-base text-neutral-900 placeholder:text-neutral-400 focus:border-rose-300 focus:bg-white focus:outline-none" />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="one-on-one-region" className="mb-2 block text-sm font-black text-neutral-900">지역</label>
                <input id="one-on-one-region" value={region} onChange={(e) => setRegion(e.target.value)} maxLength={80} placeholder="예: 서울 강남구, 경기 수원" className="h-14 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 text-base text-neutral-900 placeholder:text-neutral-400 focus:border-rose-300 focus:bg-white focus:outline-none" />
              </div>
            </div>
          )}

          {formStep === 3 && (
            <div className="grid gap-5">
              {[
                { id: "intro", label: "자기소개", hint: "일상, 성격, 취미처럼 나를 자연스럽게 소개해주세요.", value: introText, setter: setIntroText, maxLength: 2000 },
                { id: "strengths", label: "내 강점", hint: "상대가 알면 좋을 나만의 장점을 적어주세요.", value: strengthsText, setter: setStrengthsText, maxLength: 1000 },
                { id: "preferred", label: "원하는 상대", hint: "연락처나 SNS 계정 없이 편하게 적어주세요.", value: preferredPartnerText, setter: setPreferredPartnerText, maxLength: 1000 },
              ].map((field) => (
                <div key={field.id}>
                  <div className="mb-2 flex items-end justify-between gap-3">
                    <label htmlFor={`one-on-one-${field.id}`} className="text-sm font-black text-neutral-900">{field.label}</label>
                    <span className="text-[11px] text-neutral-400">{field.value.length}/{field.maxLength}</span>
                  </div>
                  <textarea id={`one-on-one-${field.id}`} value={field.value} onChange={(e) => field.setter(e.target.value)} maxLength={field.maxLength} placeholder={field.hint} className="min-h-28 w-full resize-none rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-4 text-base leading-6 text-neutral-900 placeholder:text-neutral-400 focus:border-rose-300 focus:bg-white focus:outline-none" />
                </div>
              ))}
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">휴대폰 번호, 카카오톡 ID, 인스타 계정, 외부 링크는 적지 말아주세요.</p>
            </div>
          )}

          {formStep === 4 && (
            <div className="space-y-7">
              <div>
                <p className="mb-3 text-sm font-black text-neutral-900">흡연</p>
                <div className="flex flex-wrap gap-2">
                  {SMOKING_OPTIONS.map((item) => (
                    <button key={item.value} type="button" onClick={() => setSmoking(item.value)} className={`h-11 rounded-full border px-5 text-sm font-black transition ${smoking === item.value ? "border-rose-500 bg-rose-50 text-rose-700" : "border-neutral-200 bg-white text-neutral-600"}`}>
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-3 text-sm font-black text-neutral-900">운동 빈도</p>
                <div className="flex flex-wrap gap-2">
                  {WORKOUT_OPTIONS.map((item) => (
                    <button key={item.value || "empty"} type="button" onClick={() => setWorkoutFrequency(item.value)} className={`h-11 rounded-full border px-5 text-sm font-black transition ${workoutFrequency === item.value ? "border-rose-500 bg-rose-50 text-rose-700" : "border-neutral-200 bg-white text-neutral-600"}`}>
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-black text-neutral-900">사진 2장</p>
                  <span className="text-xs font-bold text-neutral-400">{isEditMode && selectedPhotos.length === 0 ? "기존 사진 유지" : `${selectedPhotos.length}/2 선택`}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-neutral-500">얼굴이 잘 보이는 사진을 한 장씩 선택해주세요.</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {[{ slot: 1 as const, file: photoSlotOne }, { slot: 2 as const, file: photoSlotTwo }].map(({ slot, file }) => (
                    <label key={slot} className="flex aspect-[4/5] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 px-3 text-center">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl text-neutral-500 shadow-sm">+</span>
                      <span className="mt-3 text-sm font-black text-neutral-700">사진 {slot}</span>
                      <span className="mt-1 max-w-full truncate text-xs text-neutral-400">{file ? file.name : "눌러서 선택"}</span>
                      <input type="file" accept="image/*" onChange={(e) => { handleSlotChange(slot, e.target.files); if (e.target.files?.[0] && getOneOnOnePhotoError(e.target.files[0])) e.currentTarget.value = ""; }} className="sr-only" />
                      {file && <button type="button" onClick={(e) => { e.preventDefault(); clearSlot(slot); }} className="mt-3 text-xs font-black text-rose-600 underline">선택 취소</button>}
                    </label>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-5 text-neutral-500">JPG, PNG, WebP / 사진당 12MB 이하. HEIC 사진은 캡처 후 올려주세요.</p>
                {isEditMode && existingPhotoUrls.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs text-neutral-500">새 사진을 선택하지 않으면 아래 기존 사진이 유지됩니다.</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {existingPhotoUrls.map((url, idx) => (
                        <a key={`existing-${idx}`} href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-neutral-200 bg-white">
                          <div className="flex h-24 w-full items-center justify-center bg-neutral-50">
                            <img src={url} alt={`기존 사진 ${idx + 1}`} decoding="async" className="max-h-full max-w-full object-contain" />
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {formStep === 5 && (
            <div className="space-y-6">
              <div className="divide-y divide-neutral-100 rounded-2xl border border-neutral-200">
                {[
                  { step: 1, label: "기본 정보", value: `${name} · ${sex === "male" ? "남자" : "여자"}` },
                  { step: 2, label: "프로필", value: `${birthYear}년생 · ${heightCm}cm · ${job} · ${region}` },
                  { step: 3, label: "소개", value: `${introText}\n강점: ${strengthsText}\n원하는 상대: ${preferredPartnerText}` },
                  { step: 4, label: "생활과 사진", value: `${smokingLabel(smoking)} · ${workoutLabel((workoutFrequency || null) as CardItem["workout_frequency"])} · ${isEditMode && selectedPhotos.length === 0 ? "기존 사진 유지" : `사진 ${selectedPhotos.length}장`}` },
                ].map((item) => (
                  <div key={item.step} className="flex items-start gap-3 px-4 py-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-black text-neutral-400">{item.label}</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-neutral-800">{item.value}</p>
                    </div>
                    <button type="button" onClick={() => moveToStep(item.step)} className="shrink-0 rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-black text-neutral-600">수정</button>
                  </div>
                ))}
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-black text-neutral-950">필수 확인</h3>
                    <p className="mt-1 text-xs text-neutral-500">모든 내용을 확인한 뒤 제출해주세요.</p>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-black text-neutral-700">
                    <input type="checkbox" checked={allConsented} onChange={(e) => { const checked = e.target.checked; setConsentFakeInfo(checked); setConsentNoShow(checked); setConsentFee(checked); setConsentPrivacy(checked); setConsentNoDirectContact(checked); }} className="h-4 w-4 accent-rose-500" />
                    전체 확인
                  </label>
                </div>
                <div className="mt-4 grid gap-2">
                  {[
                    { checked: consentFakeInfo, setter: setConsentFakeInfo, text: "허위 정보 작성 시 이용이 제한될 수 있어요." },
                    { checked: consentNoShow, setter: setConsentNoShow, text: "노쇼나 무단 취소 시 재이용이 제한될 수 있어요." },
                    { checked: consentFee, setter: setConsentFee, text: "번호 교환 시 매칭비가 발생하고 연락처가 공개돼요." },
                    { checked: consentNoDirectContact, setter: setConsentNoDirectContact, text: "신청서에는 휴대폰 번호, 카카오톡 ID, 인스타 계정, 오픈채팅 링크 등 외부 연락처를 적지 않습니다." },
                    { checked: consentPrivacy, setter: setConsentPrivacy, text: "개인정보는 1:1 매칭 진행, 운영 확인, 안전 관리 목적으로만 사용돼요." },
                  ].map((item) => (
                    <label key={item.text} className="flex min-h-[52px] cursor-pointer items-start gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm leading-5 text-neutral-700">
                      <input type="checkbox" checked={item.checked} onChange={(e) => item.setter(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-rose-500" />
                      <span>{item.text}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="mt-8 flex gap-2">
            {formStep > 1 && (
              <button type="button" onClick={() => moveToStep(formStep - 1)} disabled={submitting} className="h-14 min-w-24 rounded-full border border-neutral-200 bg-white px-5 text-sm font-black text-neutral-700 disabled:opacity-50">
                이전
              </button>
            )}
            {formStep < 5 ? (
              <button type="button" onClick={handleNextStep} className="h-14 flex-1 rounded-full bg-neutral-950 px-5 text-base font-black text-white">
                다음
              </button>
            ) : (
              <button type="submit" disabled={!allConsented || !canSubmitForm || submitting} className="h-14 flex-1 rounded-full bg-rose-500 px-4 text-base font-black text-white shadow-lg shadow-rose-200 disabled:cursor-not-allowed disabled:opacity-50">
                {submitting ? "처리 중..." : isEditMode ? "수정 저장" : "신청서 제출"}
              </button>
            )}
          </div>

          {formStep === 5 && submitDisabledReason && (
            <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              <p>{submitDisabledReason}</p>
              {!isEditMode && (status.activeRequestStatus || status.reason === "ACTIVE_REQUEST_EXISTS") && (
                <Link href="/mypage?section=matching" className="mt-1 inline-flex font-bold underline">마이페이지 매칭탭 보기</Link>
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
