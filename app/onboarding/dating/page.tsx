"use client";

import Link from "next/link";
import NextImage from "next/image";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import DatingAdultNotice from "@/components/DatingAdultNotice";
import { normalizeNickname, validateNickname } from "@/lib/nickname";
import { createClient } from "@/lib/supabase/client";

type TargetKey = "open" | "oneOnOne";
type Sex = "male" | "female";
type Smoking = "non_smoker" | "occasional" | "smoker";

type OneOnOneWriteStatus = {
  loggedIn?: boolean;
  isAdmin?: boolean;
  phoneVerified?: boolean;
  canWrite?: boolean;
  writeStatus?: "approved" | "paused";
  activeRequestStatus?: "submitted" | "reviewing" | "approved" | null;
  reason?: string | null;
};

type OpenCardItem = {
  id?: string;
  status?: "pending" | "public" | "hidden" | "expired";
};

type OpenPhotoAssets = {
  rawPaths: string[];
  blurPaths: string[];
  blurThumbPath: string;
};

const STEP_LABELS = ["기본 정보", "소개", "생활 정보", "사진", "확인"] as const;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PHOTO_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const MAX_ADULT_BIRTH_YEAR = Math.min(2010, new Date().getFullYear() - 18);

function normalizeInstagramId(value: string) {
  return value.trim().replace(/^@+/, "").replace(/\s+/g, "").slice(0, 30);
}

function validInstagramId(value: string) {
  return /^[A-Za-z0-9._]{1,30}$/.test(normalizeInstagramId(value));
}

function getExtension(name: string) {
  const index = name.toLowerCase().lastIndexOf(".");
  return index >= 0 ? name.toLowerCase().slice(index + 1) : "";
}

function photoError(file: File) {
  const type = file.type.toLowerCase();
  const extension = getExtension(file.name);
  if (type === "image/heic" || type === "image/heif" || extension === "heic" || extension === "heif") {
    return "HEIC 사진은 지원하지 않아요. 사진을 캡처한 뒤 다시 선택해 주세요.";
  }
  if (file.size > PHOTO_MAX_BYTES) return "사진은 장당 10MB 이하만 선택할 수 있어요.";
  if (!PHOTO_TYPES.has(type) && !PHOTO_EXTENSIONS.has(extension)) return "JPG, PNG, WebP 사진만 선택할 수 있어요.";
  return "";
}

async function imageFileFromCanvas(source: File, options: { blur?: boolean; webp?: boolean }) {
  const imageUrl = URL.createObjectURL(source);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("사진을 읽지 못했습니다."));
      element.src = imageUrl;
    });
    const maxEdge = options.blur ? 960 : 1200;
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("사진 처리 기능을 사용할 수 없습니다.");
    if (options.blur) context.filter = "blur(9px)";
    context.drawImage(image, 0, 0, width, height);
    context.filter = "none";
    const mimeType = options.webp ? "image/webp" : "image/jpeg";
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("사진 변환에 실패했습니다."))), mimeType, options.webp ? 0.78 : 0.82);
    });
    return new File([blob], options.webp ? "lite.webp" : "blur.jpg", { type: mimeType });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

async function responseError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
  const message = body.error ?? body.message ?? fallback;
  if (message === "Phone verification is required.") return "휴대폰 인증 후 1:1 신청서를 등록할 수 있어요.";
  if (message.includes("active request")) return "이미 진행 중인 1:1 신청서가 있어요.";
  if (message === "Writing is paused.") return "현재 1:1 신청서 작성이 잠시 중단되어 있어요.";
  if (message.includes("Exactly two photos")) return "사진 두 장을 모두 다시 확인해 주세요.";
  return message;
}

function koreanAgeFromBirthYear(birthYear: number) {
  return new Date().getFullYear() - birthYear + 1;
}

export default function DatingOnboardingPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState(0);
  const [targets, setTargets] = useState<Record<TargetKey, boolean>>({ open: true, oneOnOne: true });
  const [available, setAvailable] = useState<Record<TargetKey, boolean>>({ open: false, oneOnOne: false });
  const [availabilityNote, setAvailabilityNote] = useState<Record<TargetKey, string>>({ open: "", oneOnOne: "" });

  const [sex, setSex] = useState<Sex>("male");
  const [nickname, setNickname] = useState("");
  const [nicknameSaved, setNicknameSaved] = useState(false);
  const [name, setName] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [job, setJob] = useState("");
  const [region, setRegion] = useState("");
  const [introText, setIntroText] = useState("");
  const [strengthsText, setStrengthsText] = useState("");
  const [preferredPartnerText, setPreferredPartnerText] = useState("");
  const [smoking, setSmoking] = useState<Smoking>("non_smoker");
  const [workoutFrequency, setWorkoutFrequency] = useState("");
  const [trainingYears, setTrainingYears] = useState("");
  const [instagramId, setInstagramId] = useState("");
  const [total3Lift, setTotal3Lift] = useState("");
  const [photoVisibility, setPhotoVisibility] = useState<"blur" | "public">("blur");
  const [photos, setPhotos] = useState<(File | null)[]>([null, null]);
  const [previewUrls, setPreviewUrls] = useState<(string | null)[]>([null, null]);

  const [consentFakeInfo, setConsentFakeInfo] = useState(false);
  const [consentNoShow, setConsentNoShow] = useState(false);
  const [consentFee, setConsentFee] = useState(false);
  const [consentPrivacy, setConsentPrivacy] = useState(false);
  const [consentNoDirectContact, setConsentNoDirectContact] = useState(false);
  const [consentOpenCard, setConsentOpenCard] = useState(false);

  const [openAssets, setOpenAssets] = useState<OpenPhotoAssets | null>(null);
  const [oneOnOnePhotoPaths, setOneOnOnePhotoPaths] = useState<string[] | null>(null);
  const [completed, setCompleted] = useState<Record<TargetKey, boolean>>({ open: false, oneOnOne: false });
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    const urls = photos.map((file) => (file ? URL.createObjectURL(file) : null));
    setPreviewUrls(urls);
    return () => urls.forEach((url) => url && URL.revokeObjectURL(url));
  }, [photos]);

  useEffect(() => {
    let active = true;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace(`/login?redirect=${encodeURIComponent("/onboarding/dating")}`);
        return;
      }

      try {
        const [oneResponse, openResponse, writeResponse, profileResponse] = await Promise.all([
          fetch("/api/dating/1on1/write-status", { cache: "no-store" }),
          fetch("/api/dating/cards/my", { cache: "no-store" }),
          fetch("/api/dating/cards/write-enabled", { cache: "no-store" }),
          fetch("/api/mypage/summary", { cache: "no-store" }),
        ]);
        if (!oneResponse.ok || !openResponse.ok || !writeResponse.ok || !profileResponse.ok) {
          throw new Error("등록 가능 상태를 불러오지 못했습니다.");
        }
        const one = (await oneResponse.json().catch(() => ({}))) as OneOnOneWriteStatus;
        const open = (await openResponse.json().catch(() => ({}))) as { items?: OpenCardItem[] };
        const write = (await writeResponse.json().catch(() => ({}))) as { enabled?: boolean };
        const profile = (await profileResponse.json().catch(() => ({}))) as { profile?: { nickname?: string | null } };
        if (!active) return;
        if (one.isAdmin !== true) {
          router.replace("/mypage");
          return;
        }
        if (!one.phoneVerified) {
          router.replace(`/phone-verification?next=${encodeURIComponent("/onboarding/dating")}`);
          return;
        }

        const hasActiveOpen = (open.items ?? []).some((item) => item.status === "pending" || item.status === "public");
        const openAvailable = write.enabled !== false && !hasActiveOpen;
        const oneAvailable = one.canWrite === true;
        const profileNickname = normalizeNickname(String(profile.profile?.nickname ?? ""));
        const metadataNickname = normalizeNickname(String((user.user_metadata as { nickname?: unknown } | null)?.nickname ?? ""));
        setNickname(profileNickname || metadataNickname);
        setNicknameSaved(Boolean(profileNickname || metadataNickname));
        setAvailable({ open: openAvailable, oneOnOne: oneAvailable });
        setTargets({ open: openAvailable, oneOnOne: oneAvailable });
        setCompleted({ open: hasActiveOpen, oneOnOne: Boolean(one.activeRequestStatus) });
        setAvailabilityNote({
          open: hasActiveOpen ? "이미 등록된 오픈카드가 있어요." : write.enabled === false ? "현재 오픈카드 작성이 중단되어 있어요." : "",
          oneOnOne: one.activeRequestStatus
            ? "이미 진행 중인 1:1 신청서가 있어요."
            : one.writeStatus !== "approved"
              ? "현재 1:1 신청서 작성이 중단되어 있어요."
              : "",
        });
      } catch {
        if (active) setError("등록 가능 상태를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      } finally {
        if (active) setChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [router, supabase]);

  const selectedTargets = (Object.keys(targets) as TargetKey[]).filter((key) => targets[key] && (available[key] || completed[key]));
  const allSelectedDone = selectedTargets.length > 0 && selectedTargets.every((key) => completed[key]);

  const validateStep = (targetStep: number) => {
    if (selectedTargets.length === 0) return "등록할 서비스를 하나 이상 선택해 주세요.";
    if (targetStep === 0) {
      const year = Number(birthYear);
      const height = Number(heightCm);
      if (!nicknameSaved) {
        const nicknameError = validateNickname(nickname);
        if (nicknameError) return nicknameError;
      }
      if (targets.oneOnOne && !name.trim()) return "1:1 신청서에 사용할 이름을 입력해 주세요.";
      if (targets.oneOnOne && name.trim().length > 30) return "이름은 30자 이하로 입력해 주세요.";
      if (!Number.isInteger(year) || year < 1960 || year > MAX_ADULT_BIRTH_YEAR) {
        return `만 18세 이상만 이용할 수 있어요. 출생연도 4자리를 입력해 주세요. 예: 1996`;
      }
      if (!Number.isInteger(height) || height < 120 || height > 230) return "키는 120~230cm 사이로 입력해 주세요.";
      if (!job.trim()) return "직업을 입력해 주세요.";
      if (!region.trim()) return "지역을 입력해 주세요.";
      if (targets.open && job.trim().length > 50) return "오픈카드 직업은 50자 이하로 입력해 주세요.";
      if (targets.open && region.trim().length > 30) return "오픈카드 지역은 30자 이하로 입력해 주세요.";
      if (targets.oneOnOne && job.trim().length > 80) return "직업은 80자 이하로 입력해 주세요.";
      if (targets.oneOnOne && region.trim().length > 80) return "지역은 80자 이하로 입력해 주세요.";
    }
    if (targetStep === 1) {
      if (targets.oneOnOne && !introText.trim()) return "자기소개를 입력해 주세요.";
      if (!strengthsText.trim()) return "내 강점을 입력해 주세요.";
      if (!preferredPartnerText.trim()) return "원하는 상대에 대한 내용을 입력해 주세요.";
      if (targets.oneOnOne && introText.trim().length > 2000) return "자기소개는 2,000자 이하로 입력해 주세요.";
      if (targets.open && strengthsText.trim().length > 150) return "오픈카드 내 강점은 150자 이하로 입력해 주세요.";
      if (targets.oneOnOne && strengthsText.trim().length > 1000) return "내 강점은 1,000자 이하로 입력해 주세요.";
      if (preferredPartnerText.trim().length > 1000) return "원하는 상대는 1,000자 이하로 입력해 주세요.";
    }
    if (targetStep === 2 && targets.open) {
      if (!validInstagramId(instagramId)) return "인스타그램 아이디를 @ 없이 정확히 입력해 주세요.";
      const years = trainingYears ? Number(trainingYears) : 0;
      if (!Number.isFinite(years) || years < 0 || years > 50) return "운동 경력은 0~50년 사이로 입력해 주세요.";
    }
    if (targetStep === 3) {
      if (!photos[0] || !photos[1]) return "사진 두 장을 모두 선택해 주세요.";
      for (let index = 0; index < photos.length; index += 1) {
        const file = photos[index];
        if (!file) continue;
        const message = photoError(file);
        if (message) return `${index + 1}번 사진: ${message}`;
      }
    }
    if (targetStep === 4) {
      if (targets.open && !consentOpenCard) return "오픈카드 공개 범위 안내를 확인해 주세요.";
      if (
        targets.oneOnOne &&
        (!consentFakeInfo || !consentNoShow || !consentFee || !consentPrivacy || !consentNoDirectContact)
      ) {
        return "1:1 신청 필수 확인 항목을 모두 체크해 주세요.";
      }
    }
    return "";
  };

  const moveNext = () => {
    const message = validateStep(step);
    if (message) {
      setError(message);
      return;
    }
    setError("");
    setStep((current) => Math.min(STEP_LABELS.length - 1, current + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const uploadOpenCardPhotos = async (files: File[]): Promise<OpenPhotoAssets> => {
    const rawPaths: string[] = [];
    const blurPaths: string[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const assetId = crypto.randomUUID();
      setProgress(`오픈카드 사진 ${index + 1}/2 처리 중`);

      const rawForm = new FormData();
      rawForm.append("file", file);
      rawForm.append("kind", "raw");
      rawForm.append("asset_id", assetId);
      rawForm.append("index", String(index));
      const rawResponse = await fetchWithTimeout("/api/dating/cards/upload-card", { method: "POST", body: rawForm });
      if (!rawResponse.ok) throw new Error(await responseError(rawResponse, `${index + 1}번 원본 사진 업로드에 실패했습니다.`));
      const rawBody = (await rawResponse.json().catch(() => ({}))) as { path?: string };
      if (!rawBody.path) throw new Error(`${index + 1}번 원본 사진 저장 정보를 받지 못했습니다.`);
      rawPaths[index] = rawBody.path;

      const [liteFile, blurFile] = await Promise.all([
        imageFileFromCanvas(file, { webp: true }),
        imageFileFromCanvas(file, { blur: true }),
      ]);
      const liteForm = new FormData();
      liteForm.append("file", liteFile);
      liteForm.append("kind", "lite");
      liteForm.append("asset_id", assetId);
      liteForm.append("index", String(index));
      const liteResponse = await fetchWithTimeout("/api/dating/cards/upload-card", { method: "POST", body: liteForm });
      if (!liteResponse.ok) throw new Error(await responseError(liteResponse, `${index + 1}번 최적화 사진 업로드에 실패했습니다.`));

      const blurForm = new FormData();
      blurForm.append("file", blurFile);
      blurForm.append("kind", "blur");
      blurForm.append("index", String(index));
      const blurResponse = await fetchWithTimeout("/api/dating/cards/upload-card", { method: "POST", body: blurForm });
      if (!blurResponse.ok) throw new Error(await responseError(blurResponse, `${index + 1}번 블러 사진 업로드에 실패했습니다.`));
      const blurBody = (await blurResponse.json().catch(() => ({}))) as { path?: string };
      if (!blurBody.path) throw new Error(`${index + 1}번 블러 사진 저장 정보를 받지 못했습니다.`);
      blurPaths[index] = blurBody.path;
    }
    return { rawPaths, blurPaths, blurThumbPath: blurPaths[0] };
  };

  const uploadOneOnOnePhotos = async (files: File[]) => {
    const paths: string[] = [];
    for (let index = 0; index < files.length; index += 1) {
      setProgress(`1:1 사진 ${index + 1}/2 처리 중`);
      const form = new FormData();
      form.append("file", files[index]);
      const response = await fetchWithTimeout("/api/dating/1on1/upload", { method: "POST", body: form });
      if (!response.ok) throw new Error(await responseError(response, `${index + 1}번 1:1 사진 업로드에 실패했습니다.`));
      const body = (await response.json().catch(() => ({}))) as { path?: string };
      if (!body.path) throw new Error(`${index + 1}번 1:1 사진 저장 정보를 받지 못했습니다.`);
      paths[index] = body.path;
    }
    return paths;
  };

  const submit = async () => {
    for (let index = 0; index < STEP_LABELS.length; index += 1) {
      const message = validateStep(index);
      if (message) {
        setStep(index);
        setError(message);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
    }

    const selectedFiles = photos.filter((file): file is File => Boolean(file));
    setSubmitting(true);
    setError("");
    setInfo("");
    const failures: string[] = [];
    const successes: string[] = [];

    try {
      let nextOpenAssets = openAssets;
      let nextOneOnOnePaths = oneOnOnePhotoPaths;
      if (targets.open && !completed.open && !nextOpenAssets) {
        nextOpenAssets = await uploadOpenCardPhotos(selectedFiles);
        setOpenAssets(nextOpenAssets);
      }
      if (targets.oneOnOne && !completed.oneOnOne && !nextOneOnOnePaths) {
        nextOneOnOnePaths = await uploadOneOnOnePhotos(selectedFiles);
        setOneOnOnePhotoPaths(nextOneOnOnePaths);
      }

      if (targets.open && !completed.open && nextOpenAssets) {
        setProgress("오픈카드 등록 중");
        try {
          const response = await fetchWithTimeout("/api/dating/cards/my", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sex,
              age: koreanAgeFromBirthYear(Number(birthYear)),
              region: region.trim(),
              height_cm: Number(heightCm),
              job: job.trim(),
              training_years: trainingYears ? Number(trainingYears) : null,
              ideal_type: preferredPartnerText.trim(),
              strengths_text: strengthsText.trim(),
              photo_visibility: photoVisibility,
              instagram_id: normalizeInstagramId(instagramId),
              photo_paths: nextOpenAssets.rawPaths,
              blur_thumb_path: nextOpenAssets.blurThumbPath,
              blur_paths: nextOpenAssets.blurPaths,
              total_3lift: total3Lift ? Number(total3Lift) : null,
            }),
          });
          if (!response.ok) throw new Error(await responseError(response, "오픈카드 등록에 실패했습니다."));
          setCompleted((current) => ({ ...current, open: true }));
          successes.push("오픈카드");
        } catch (openError) {
          failures.push(`오픈카드: ${openError instanceof Error ? openError.message : "등록 실패"}`);
        }
      }

      if (targets.oneOnOne && !completed.oneOnOne && nextOneOnOnePaths) {
        setProgress("1:1 신청서 등록 중");
        try {
          const response = await fetchWithTimeout("/api/dating/1on1/cards", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
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
              photo_paths: nextOneOnOnePaths,
              consent_fake_info: consentFakeInfo,
              consent_no_show: consentNoShow,
              consent_fee: consentFee,
              consent_privacy: consentPrivacy,
              consent_no_direct_contact: consentNoDirectContact,
            }),
          });
          if (!response.ok) throw new Error(await responseError(response, "1:1 신청서 등록에 실패했습니다."));
          setCompleted((current) => ({ ...current, oneOnOne: true }));
          successes.push("1:1 신청서");
        } catch (oneError) {
          failures.push(`1:1 신청서: ${oneError instanceof Error ? oneError.message : "등록 실패"}`);
        }
      }

      if (successes.length > 0) setInfo(`${successes.join(" · ")} 등록을 완료했습니다.`);
      if (failures.length > 0) setError(`${failures.join("\n")} 성공한 등록은 유지되며 실패한 항목만 다시 시도할 수 있어요.`);
    } catch (uploadError) {
      if (uploadError instanceof DOMException && uploadError.name === "AbortError") {
        setError("사진 처리 시간이 초과되었습니다. 네트워크를 확인하고 다시 시도해 주세요.");
      } else {
        setError(uploadError instanceof Error ? uploadError.message : "사진 처리 중 오류가 발생했습니다.");
      }
    } finally {
      setProgress("");
      setSubmitting(false);
    }
  };

  if (checking) {
    return <main className="mx-auto flex min-h-[70vh] max-w-lg items-center justify-center px-4"><p className="text-sm text-neutral-500">가입 정보를 확인하고 있어요...</p></main>;
  }

  const nothingAvailable = !available.open && !available.oneOnOne;

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-7 text-neutral-950">
      <div className="mx-auto max-w-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold text-amber-700">관리자 통합 작성 테스트</p>
            <h1 className="mt-1 text-2xl font-black">한 번 작성하고 바로 시작해요</h1>
            <p className="mt-2 text-sm leading-6 text-neutral-600">공통 정보는 한 번만 받고, 기존 오픈카드와 1:1 신청서에 맞게 나눠 등록합니다.</p>
          </div>
          <button type="button" onClick={() => router.replace("/community/dating/cards")} className="shrink-0 text-xs font-semibold text-neutral-500 underline underline-offset-4">나중에</button>
        </div>

        <section className="mt-5 border-y border-neutral-200 bg-white py-3">
          <div className="grid grid-cols-2 gap-2">
            {(["open", "oneOnOne"] as TargetKey[]).map((key) => {
              const label = key === "open" ? "오픈카드" : "1:1 매칭";
              const done = completed[key];
              const enabled = available[key] && !done;
              const selected = targets[key] && enabled;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!enabled}
                  onClick={() => setTargets((current) => ({ ...current, [key]: !current[key] }))}
                  className={`min-h-14 border px-3 text-left transition ${selected ? "border-neutral-950 bg-neutral-950 text-white" : "border-neutral-200 bg-white text-neutral-700"} disabled:bg-neutral-100 disabled:text-neutral-400`}
                >
                  <span className="block text-sm font-bold">{done ? `${label} 등록됨` : label}</span>
                  <span className="mt-1 block text-[11px] opacity-75">{availabilityNote[key] || (key === "open" ? "내 카드 공개 후 지원 받기" : "추천 후보 확인하고 지원하기")}</span>
                </button>
              );
            })}
          </div>
        </section>

        {nothingAvailable ? (
          <section className="mt-5 border border-neutral-200 bg-white p-5">
            <p className="text-base font-bold">이미 준비가 끝났어요</p>
            <p className="mt-2 text-sm leading-6 text-neutral-600">등록된 카드와 진행 상태는 마이페이지에서 확인할 수 있습니다.</p>
            <Link href="/mypage?section=matching" className="mt-4 inline-flex h-11 items-center bg-neutral-950 px-4 text-sm font-bold text-white">마이페이지에서 확인</Link>
          </section>
        ) : (
          <>
            <nav className="mt-5 grid grid-cols-5 border-b border-neutral-200" aria-label="작성 단계">
              {STEP_LABELS.map((label, index) => (
                <button key={label} type="button" onClick={() => index <= step && setStep(index)} className={`h-12 border-b-2 text-[11px] font-bold ${index === step ? "border-rose-500 text-neutral-950" : index < step ? "border-transparent text-neutral-600" : "border-transparent text-neutral-300"}`}>
                  <span className="block">{index + 1}</span>{label}
                </button>
              ))}
            </nav>

            <section className="bg-white px-4 py-5 sm:px-5">
              {step === 0 && (
                <div>
                  <StepHeading title="기본 정보" description="두 서비스에 공통으로 들어갈 정보예요." />
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    {!nicknameSaved && <TextField value={nickname} onChange={(value) => setNickname(normalizeNickname(value).slice(0, 12))} label="닉네임" placeholder="사이트에서 사용할 닉네임" className="sm:col-span-2" maxLength={12} />}
                    <div className="sm:col-span-2">
                      <FieldLabel>성별</FieldLabel>
                      <div className="grid grid-cols-2 border border-neutral-200">
                        <Choice active={sex === "male"} onClick={() => setSex("male")}>남자</Choice>
                        <Choice active={sex === "female"} onClick={() => setSex("female")}>여자</Choice>
                      </div>
                    </div>
                    {targets.oneOnOne && <TextField value={name} onChange={setName} label="이름" placeholder="1:1 운영 확인용 이름" className="sm:col-span-2" maxLength={30} />}
                    <TextField value={birthYear} onChange={(value) => setBirthYear(value.replace(/\D/g, "").slice(0, 4))} label="출생연도" placeholder="예: 1996" inputMode="numeric" />
                    <TextField value={heightCm} onChange={(value) => setHeightCm(value.replace(/\D/g, "").slice(0, 3))} label="키(cm)" placeholder="예: 175" inputMode="numeric" />
                    <TextField value={job} onChange={setJob} label="직업" placeholder="직업" className="sm:col-span-2" maxLength={targets.open ? 50 : 80} />
                    <TextField value={region} onChange={setRegion} label="지역" placeholder="예: 서울 마포구" className="sm:col-span-2" maxLength={targets.open ? 30 : 80} />
                  </div>
                </div>
              )}

              {step === 1 && (
                <div>
                  <StepHeading title="나를 보여주는 글" description="같은 문장을 각 서비스의 알맞은 위치에 나눠 담아요." />
                  <div className="mt-5 space-y-4">
                    {targets.oneOnOne && <TextArea value={introText} onChange={setIntroText} label="자기소개" placeholder="일상, 성격, 취미를 편하게 적어주세요." maxLength={2000} />}
                    <TextArea value={strengthsText} onChange={setStrengthsText} label="내 강점" placeholder="나와 만나면 좋은 점을 적어주세요." maxLength={targets.open ? 150 : 1000} />
                    <TextArea value={preferredPartnerText} onChange={setPreferredPartnerText} label="원하는 상대" placeholder="중요하게 생각하는 점을 적어주세요." maxLength={1000} />
                    {targets.open && <p className="text-xs leading-5 text-neutral-500">내 강점과 원하는 상대 내용은 오픈카드에도 공개됩니다.</p>}
                  </div>
                </div>
              )}

              {step === 2 && (
                <div>
                  <StepHeading title="생활 정보" description="필요한 서비스의 항목만 보여드려요." />
                  {targets.oneOnOne && (
                    <div className="mt-5">
                      <FieldLabel>흡연</FieldLabel>
                      <div className="grid grid-cols-3 border border-neutral-200">
                        {([['non_smoker', '비흡연'], ['occasional', '가끔'], ['smoker', '흡연']] as const).map(([value, label]) => <Choice key={value} active={smoking === value} onClick={() => setSmoking(value)}>{label}</Choice>)}
                      </div>
                      <FieldLabel className="mt-5">운동 빈도</FieldLabel>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {[["none", "안함"], ["1_2", "주 1-2회"], ["3_4", "주 3-4회"], ["5_plus", "주 5회+"]].map(([value, label]) => <button key={value} type="button" onClick={() => setWorkoutFrequency(value)} className={`h-11 border text-xs font-bold ${workoutFrequency === value ? "border-rose-500 bg-rose-50 text-rose-700" : "border-neutral-200 bg-white text-neutral-600"}`}>{label}</button>)}
                      </div>
                    </div>
                  )}
                  {targets.open && (
                    <div className="mt-6 grid gap-3 sm:grid-cols-2">
                      <TextField value={trainingYears} onChange={(value) => setTrainingYears(value.replace(/\D/g, "").slice(0, 2))} label="운동 경력(년)" placeholder="예: 3" inputMode="numeric" />
                      <TextField value={total3Lift} onChange={(value) => setTotal3Lift(value.replace(/\D/g, "").slice(0, 4))} label="3대 합계(선택)" placeholder="선택 입력" inputMode="numeric" />
                      <TextField value={instagramId} onChange={(value) => setInstagramId(normalizeInstagramId(value))} label="인스타그램 아이디" placeholder="@ 제외" className="sm:col-span-2" />
                    </div>
                  )}
                </div>
              )}

              {step === 3 && (
                <div>
                  <StepHeading title="사진 두 장" description="한 번 선택하면 오픈카드와 1:1에 각각 안전하게 저장해요." />
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    {[0, 1].map((index) => (
                      <label key={index} className="relative flex aspect-[4/5] cursor-pointer items-center justify-center overflow-hidden border border-dashed border-neutral-300 bg-neutral-50">
                        {previewUrls[index] ? <NextImage src={previewUrls[index] ?? ""} alt={`사진 ${index + 1} 미리보기`} fill sizes="(max-width: 640px) 45vw, 250px" unoptimized className="object-contain" /> : <span className="text-sm font-bold text-neutral-500">사진 {index + 1} 선택</span>}
                        <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => {
                          const file = event.target.files?.[0] ?? null;
                          if (file) {
                            const message = photoError(file);
                            if (message) {
                              setError(`${index + 1}번 사진: ${message}`);
                              event.currentTarget.value = "";
                              return;
                            }
                          }
                          setError("");
                          setPhotos((current) => current.map((item, itemIndex) => itemIndex === index ? file : item));
                          setOpenAssets(null);
                          setOneOnOnePhotoPaths(null);
                        }} />
                      </label>
                    ))}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-neutral-500">JPG, PNG, WebP · 장당 10MB 이하. HEIC는 캡처한 뒤 선택해 주세요.</p>
                  {targets.open && (
                    <div className="mt-5 border-t border-neutral-200 pt-5">
                      <FieldLabel>오픈카드 사진 공개</FieldLabel>
                      <div className="grid grid-cols-2 border border-neutral-200">
                        <Choice active={photoVisibility === "blur"} onClick={() => setPhotoVisibility("blur")}>블러 공개</Choice>
                        <Choice active={photoVisibility === "public"} onClick={() => setPhotoVisibility("public")}>원본 공개</Choice>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-neutral-500">블러 공개가 기본값입니다. 1:1 사진은 후보 확인 과정에서만 사용됩니다.</p>
                      {previewUrls[0] && photoVisibility === "blur" && (
                        <div className="mt-3 flex items-center gap-3 border border-neutral-200 bg-neutral-50 p-3">
                          <div className="relative h-16 w-14 overflow-hidden bg-white"><NextImage src={previewUrls[0]} alt="블러 공개 예시" fill sizes="56px" unoptimized className="scale-110 object-cover blur-md" /></div>
                          <div><p className="text-xs font-bold text-neutral-800">목록에서는 이런 느낌으로 보여요</p><p className="mt-1 text-[11px] text-neutral-500">서버에는 별도의 블러 이미지도 함께 생성해 저장합니다.</p></div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {step === 4 && (
                <div>
                  <StepHeading title="마지막 확인" description="등록되는 서비스와 개인정보 안내를 확인해 주세요." />
                  <div className="mt-5 space-y-3">
                    {targets.open && (
                      <label className="flex min-h-12 items-start gap-3 border border-neutral-200 bg-neutral-50 p-3 text-sm leading-5 text-neutral-700">
                        <input type="checkbox" checked={consentOpenCard} onChange={(event) => setConsentOpenCard(event.target.checked)} className="mt-1 accent-rose-500" />
                        <span>오픈카드의 소개·강점·사진 공개 범위를 확인했고, 수락 후 인스타그램 아이디가 상대에게 공개되는 것에 동의합니다.</span>
                      </label>
                    )}
                    {targets.oneOnOne && (
                      <>
                        <Consent checked={consentFakeInfo} onChange={setConsentFakeInfo}>허위 정보 작성 시 이용이 제한될 수 있어요.</Consent>
                        <Consent checked={consentNoShow} onChange={setConsentNoShow}>노쇼나 무단 취소 시 재이용이 제한될 수 있어요.</Consent>
                        <Consent checked={consentFee} onChange={setConsentFee}>번호 교환 시 매칭비가 발생하고 연락처가 공개돼요.</Consent>
                        <Consent checked={consentNoDirectContact} onChange={setConsentNoDirectContact}>신청서에는 휴대폰 번호, 카카오톡 ID, 인스타 계정, 오픈채팅 링크 등 외부 연락처를 적지 않아요.</Consent>
                        <Consent checked={consentPrivacy} onChange={setConsentPrivacy}>개인정보는 1:1 매칭 진행, 운영 확인, 안전 관리 목적으로만 사용돼요.</Consent>
                      </>
                    )}
                  </div>
                  <DatingAdultNotice />
                </div>
              )}

              {error && <p className="mt-5 whitespace-pre-line border border-rose-200 bg-rose-50 p-3 text-sm leading-6 text-rose-700">{error}</p>}
              {info && <p className="mt-5 border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-700">{info}</p>}
              {progress && <p className="mt-3 text-center text-xs font-semibold text-neutral-500">{progress}</p>}

              <div className="mt-6 grid grid-cols-[auto_1fr] gap-2">
                <button type="button" disabled={submitting || step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))} className="h-12 border border-neutral-300 bg-white px-5 text-sm font-bold text-neutral-700 disabled:opacity-30">이전</button>
                {step < STEP_LABELS.length - 1 ? (
                  <button type="button" onClick={moveNext} className="h-12 bg-neutral-950 px-5 text-sm font-bold text-white">다음</button>
                ) : allSelectedDone ? (
                  <button type="button" onClick={() => router.replace("/community/dating/cards")} className="h-12 bg-emerald-600 px-5 text-sm font-bold text-white">오픈카드 홈으로</button>
                ) : (
                  <button type="button" disabled={submitting} onClick={() => void submit()} className="h-12 bg-rose-500 px-5 text-sm font-bold text-white disabled:opacity-50">{submitting ? "등록 중..." : completed.open || completed.oneOnOne ? "남은 등록 다시 시도" : "연애 준비 시작하기"}</button>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function StepHeading({ title, description }: { title: string; description: string }) {
  return <div><h2 className="text-lg font-black text-neutral-950">{title}</h2><p className="mt-1 text-sm leading-6 text-neutral-500">{description}</p></div>;
}

function FieldLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`mb-2 text-xs font-bold text-neutral-700 ${className}`}>{children}</p>;
}

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className={`h-11 text-sm font-bold ${active ? "bg-rose-50 text-rose-700" : "bg-white text-neutral-500"}`}>{children}</button>;
}

function TextField({ value, onChange, label, placeholder, className = "", inputMode, maxLength }: { value: string; onChange: (value: string) => void; label: string; placeholder: string; className?: string; inputMode?: "text" | "numeric"; maxLength?: number }) {
  return <label className={className}><span className="mb-2 block text-xs font-bold text-neutral-700">{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} inputMode={inputMode} maxLength={maxLength} className="h-12 w-full border border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none focus:border-neutral-900" /></label>;
}

function TextArea({ value, onChange, label, placeholder, maxLength }: { value: string; onChange: (value: string) => void; label: string; placeholder: string; maxLength: number }) {
  return <label><span className="mb-2 flex items-center justify-between text-xs font-bold text-neutral-700"><span>{label}</span><span className="font-normal text-neutral-400">{value.length}/{maxLength}</span></span><textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} maxLength={maxLength} rows={4} className="w-full border border-neutral-300 bg-white px-3 py-3 text-sm leading-6 text-neutral-900 outline-none focus:border-neutral-900" /></label>;
}

function Consent({ checked, onChange, children }: { checked: boolean; onChange: (value: boolean) => void; children: ReactNode }) {
  return <label className="flex min-h-12 items-start gap-3 border border-neutral-200 bg-neutral-50 p-3 text-sm leading-5 text-neutral-700"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 accent-rose-500" /><span>{children}</span></label>;
}
