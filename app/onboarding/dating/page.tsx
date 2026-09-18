"use client";

import Link from "next/link";
import NextImage from "next/image";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import DatingAdultNotice from "@/components/DatingAdultNotice";
import { normalizeNickname } from "@/lib/nickname";
import { createClient } from "@/lib/supabase/client";
import { type DraftFields } from "@/lib/dating-onboarding-draft";
import { useDatingOnboardingDraft } from "@/lib/use-dating-onboarding-draft";
import { onboardingFieldId, validateOnboardingStep, type OnboardingField, type OnboardingErrors } from "@/lib/dating-onboarding-validation";

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
const ONE_ON_ONE_CANDIDATES_HREF = "/community/dating/cards?tab=one_on_one&from=onboarding";
const INSTANT_OPEN_CARD_HREF = "/dating/paid?apply=1&source=open_card";

function normalizeInstagramId(value: string) {
  return value.trim().replace(/^@+/, "").replace(/\s+/g, "").slice(0, 30);
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
  const [checkFailed, setCheckFailed] = useState(false);
  const [step, setStep] = useState(0);
  const [targets, setTargets] = useState<Record<TargetKey, boolean>>({ open: true, oneOnOne: true });
  const [available, setAvailable] = useState<Record<TargetKey, boolean>>({ open: false, oneOnOne: false });
  const [availabilityNote, setAvailabilityNote] = useState<Record<TargetKey, string>>({ open: "", oneOnOne: "" });

  const [sex, setSex] = useState<Sex | null>(null);
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
  const [continueToInstantOpenCard, setContinueToInstantOpenCard] = useState(false);

  const [draftUserId, setDraftUserId] = useState<string | null>(null);
  const [attemptedSteps, setAttemptedSteps] = useState<number[]>([]);
  const [focusField, setFocusField] = useState<OnboardingField | null>(null);
  const [photoSelectionErrors, setPhotoSelectionErrors] = useState(["", ""]);
  const submitLock = useRef(false);
  const authIdentity = useRef<string | null | undefined>(undefined);
  const authVersion = useRef(0);
  const fields: DraftFields = {
    sex, nickname, name, birthYear, heightCm, job, region, introText, strengthsText,
    preferredPartnerText, smoking, workoutFrequency, trainingYears, instagramId, total3Lift, photoVisibility,
  };
  const selectedTargets = (Object.keys(targets) as TargetKey[]).filter((key) => targets[key] && (available[key] || completed[key]));
  const allSelectedDone = selectedTargets.length > 0 && selectedTargets.every((key) => completed[key]);
  const draft = useDatingOnboardingDraft(draftUserId, { step, targets, fields },
    !checking && !allSelectedDone && (available.open || available.oneOnOne));
  const finishDraft = draft.finish;

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (authIdentity.current !== undefined && authIdentity.current !== next) {
        authVersion.current += 1;
        finishDraft();
        setChecking(true);
        window.location.reload();
      }
      authIdentity.current = next;
    });
    return () => data.subscription.unsubscribe();
  }, [supabase, finishDraft]);

  useEffect(() => {
    if (!focusField) return;
    const frame = window.requestAnimationFrame(() => {
      const field = document.getElementById(onboardingFieldId(focusField));
      field?.focus({ preventScroll: true });
      field?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      setFocusField(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusField, step]);

  const resumeDraft = () => {
    const saved = draft.pendingDraft;
    if (!saved) return;
    const f = saved.fields;
    setSex(f.sex);
    if (!nicknameSaved) setNickname(f.nickname);
    setName(f.name); setBirthYear(f.birthYear); setHeightCm(f.heightCm);
    setJob(f.job); setRegion(f.region); setIntroText(f.introText);
    setStrengthsText(f.strengthsText); setPreferredPartnerText(f.preferredPartnerText);
    setSmoking(f.smoking); setWorkoutFrequency(f.workoutFrequency);
    setTrainingYears(f.trainingYears); setInstagramId(f.instagramId);
    setTotal3Lift(f.total3Lift); setPhotoVisibility(f.photoVisibility);
    const nextTargets = {
      open: available.open && saved.targets.open,
      oneOnOne: !continueToInstantOpenCard && available.oneOnOne && saved.targets.oneOnOne,
    };
    if (continueToInstantOpenCard) nextTargets.open = available.open;
    if (nextTargets.open || nextTargets.oneOnOne) setTargets(nextTargets);
    setStep(saved.step);
    setInfo("이어서 작성 중이에요. 사진과 필수 동의는 다시 선택해 주세요.");
    draft.resumed();
  };

  useEffect(() => {
    const urls = photos.map((file) => (file ? URL.createObjectURL(file) : null));
    setPreviewUrls(urls);
    return () => urls.forEach((url) => url && URL.revokeObjectURL(url));
  }, [photos]);

  useEffect(() => {
    let active = true;
    const version = authVersion.current;
    (async () => {
      const wantsInstantOpenCard = new URLSearchParams(window.location.search).get("next") === "instant_open_card";
      const onboardingPath = wantsInstantOpenCard
        ? "/onboarding/dating?next=instant_open_card"
        : "/onboarding/dating";
      setContinueToInstantOpenCard(wantsInstantOpenCard);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!active || version !== authVersion.current) return;
        if (!user) {
          router.replace(`/login?redirect=${encodeURIComponent(onboardingPath)}`);
          return;
        }
        const [oneResponse, openResponse, writeResponse, profileResponse] = await Promise.all([
          fetch("/api/dating/1on1/write-status", { cache: "no-store" }),
          fetch("/api/dating/cards/my", { cache: "no-store" }),
          fetch("/api/dating/cards/write-enabled", { cache: "no-store" }),
          fetch("/api/mypage/summary?profileOnly=1", { cache: "no-store" }),
        ]);
        if (!oneResponse.ok || !openResponse.ok || !writeResponse.ok || !profileResponse.ok) {
          throw new Error("등록 가능 상태를 불러오지 못했습니다.");
        }
        const one = (await oneResponse.json().catch(() => ({}))) as OneOnOneWriteStatus;
        const open = (await openResponse.json().catch(() => ({}))) as { items?: OpenCardItem[] };
        const write = (await writeResponse.json().catch(() => ({}))) as { enabled?: boolean };
        const profile = (await profileResponse.json().catch(() => ({}))) as { profile?: { nickname?: string | null } };
        if (!active || version !== authVersion.current) return;
        if (!one.phoneVerified) {
          router.replace(`/phone-verification?next=${encodeURIComponent(onboardingPath)}`);
          return;
        }

        const hasActiveOpen = (open.items ?? []).some((item) => item.status === "pending" || item.status === "public");
        if (wantsInstantOpenCard && hasActiveOpen) {
          router.replace(INSTANT_OPEN_CARD_HREF);
          return;
        }
        const openAvailable = write.enabled !== false && !hasActiveOpen;
        const oneAvailable = one.canWrite === true;
        const profileNickname = normalizeNickname(String(profile.profile?.nickname ?? ""));
        const metadataNickname = normalizeNickname(String((user.user_metadata as { nickname?: unknown } | null)?.nickname ?? ""));
        setDraftUserId(user.id);
        setNickname(profileNickname || metadataNickname);
        setNicknameSaved(Boolean(profileNickname || metadataNickname));
        setAvailable({ open: openAvailable, oneOnOne: oneAvailable });
        setTargets({
          open: openAvailable,
          oneOnOne: wantsInstantOpenCard ? false : oneAvailable,
        });
        setCompleted({ open: hasActiveOpen, oneOnOne: Boolean(one.activeRequestStatus) });
        setAvailabilityNote({
          open: hasActiveOpen ? "이미 등록된 오픈카드가 있어요." : write.enabled === false ? "현재 오픈카드 작성이 중단되어 있어요." : "",
          oneOnOne: one.activeRequestStatus
            ? "이미 진행 중인 1:1 신청서가 있어요."
            : one.writeStatus !== "approved"
              ? "현재 1:1 신청서 작성이 중단되어 있어요."
              : "",
        });
        setChecking(false);
      } catch {
        if (active && version === authVersion.current) {
          setCheckFailed(true);
          setError("등록 가능 상태를 불러오지 못했습니다. 입력했던 내용은 변경하지 않았어요. 다시 시도해 주세요.");
          setChecking(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [router, supabase]);

  const validateStep = (targetStep: number): OnboardingErrors => validateOnboardingStep(targetStep, {
    fields, targets, selectedCount: selectedTargets.length, nicknameSaved, maxBirthYear: MAX_ADULT_BIRTH_YEAR,
    photos: photos.map((file, index) => photoSelectionErrors[index] || (file ? photoError(file) : `사진 ${index + 1}을 선택해 주세요.`)),
    consents: { consentOpenCard, consentFakeInfo, consentNoShow, consentFee, consentPrivacy, consentNoDirectContact },
  });
  const fieldErrors = attemptedSteps.includes(step) ? validateStep(step) : {};
  const fieldProps = (field: OnboardingField) => ({ id: onboardingFieldId(field), error: fieldErrors[field] });
  const showStepErrors = (targetStep: number, errors: OnboardingErrors) => {
    setAttemptedSteps((current) => current.includes(targetStep) ? current : [...current, targetStep]);
    setStep(targetStep);
    setError("");
    setFocusField(Object.keys(errors)[0] as OnboardingField);
  };
  const moveNext = () => {
    const errors = validateStep(step);
    if (Object.keys(errors).length) { showStepErrors(step, errors); return; }
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
    if (submitLock.current || checking || !draft.ready || draft.pendingDraft || allSelectedDone) return;
    for (let index = 0; index < STEP_LABELS.length; index += 1) {
      const errors = validateStep(index);
      if (Object.keys(errors).length) { showStepErrors(index, errors); return; }
    }
    submitLock.current = true;
    const selectedFiles = photos.filter((file): file is File => Boolean(file));
    setSubmitting(true);
    setError("");
    setInfo("");
    const failures: string[] = [];
    const successes: string[] = [];

    try {
      if (!nicknameSaved) {
        setProgress("닉네임 저장 중");
        const nicknameResponse = await fetchWithTimeout("/api/mypage/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname: normalizeNickname(nickname) }),
        });
        if (!nicknameResponse.ok) {
          throw new Error(await responseError(nicknameResponse, "닉네임 저장에 실패했습니다."));
        }
        setNicknameSaved(true);
      }

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

      if (successes.length > 0 && failures.length === 0) finishDraft();
      if (successes.length > 0) setInfo(`${successes.join(" · ")} 등록을 완료했습니다.`);
      if (failures.length > 0) setError(`${failures.join("\n")} 성공한 등록은 유지되며 실패한 항목만 다시 시도할 수 있어요.`);
      if (continueToInstantOpenCard && successes.includes("오픈카드") && failures.length === 0) {
        setInfo("오픈카드 등록 완료! 결제 내용을 확인해 주세요.");
        setProgress("결제 화면으로 이동 중");
        await new Promise<void>((resolve) => window.setTimeout(resolve, 450));
        router.replace(INSTANT_OPEN_CARD_HREF);
      } else if (successes.includes("1:1 신청서") && failures.length === 0) {
        setInfo(`${successes.join(" · ")} 등록 완료! 지금 추천 후보를 확인할 수 있어요.`);
        setProgress("추천 후보 불러오는 중");
        await new Promise<void>((resolve) => window.setTimeout(resolve, 650));
        router.replace(ONE_ON_ONE_CANDIDATES_HREF);
      }
    } catch (uploadError) {
      if (uploadError instanceof DOMException && uploadError.name === "AbortError") {
        setError("사진 처리 시간이 초과되었습니다. 네트워크를 확인하고 다시 시도해 주세요.");
      } else {
        setError(uploadError instanceof Error ? uploadError.message : "사진 처리 중 오류가 발생했습니다.");
      }
    } finally {
      setProgress("");
      setSubmitting(false);
      submitLock.current = false;
    }
  };

  if (checking) {
    return <main className="mx-auto flex min-h-[70vh] max-w-lg items-center justify-center px-4"><p className="text-sm text-neutral-500">가입 정보를 확인하고 있어요...</p></main>;
  }

  if (checkFailed) {
    return (
      <main className="mx-auto min-h-[70vh] max-w-xl px-4 py-7">
        <h1 className="text-xl font-bold">등록 상태를 확인하지 못했어요</h1>
        <p role="alert" className="mt-3 text-sm leading-6 text-neutral-600">{error}</p>
        <div className="mt-5 flex gap-3">
          <button type="button" onClick={() => window.location.reload()} className="rounded-lg bg-neutral-950 px-4 py-3 text-sm font-bold text-white">다시 시도</button>
          <Link href="/community/dating/cards" className="rounded-lg border border-neutral-200 px-4 py-3 text-sm text-neutral-600">홈으로</Link>
        </div>
      </main>
    );
  }

  const nothingAvailable = continueToInstantOpenCard
    ? !available.open
    : !available.open && !available.oneOnOne;

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-7 text-neutral-950">
      <div className="mx-auto max-w-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold text-rose-600">프로필 등록</p>
            <h1 className="mt-1 text-2xl font-black">소개 프로필 작성</h1>
            <p className="mt-2 text-sm leading-6 text-neutral-600">오픈카드와 1:1 매칭에 함께 사용할 정보를 입력해 주세요.</p>
          </div>
          <button type="button" disabled={submitting} onClick={() => router.replace("/community/dating/cards")} className="shrink-0 text-xs font-semibold text-neutral-500 underline underline-offset-4">나중에</button>
        </div>

        {draft.pendingDraft && !nothingAvailable && (
          <section className="mt-4 rounded-xl border border-neutral-200 bg-white p-4" aria-label="임시저장한 프로필">
            <p className="text-sm font-bold">작성 중인 프로필이 있어요</p>
            <p className="mt-1 text-xs leading-5 text-neutral-500">이 브라우저에 저장한 내용을 이어 쓸 수 있어요. 사진과 필수 동의는 다시 선택해 주세요.</p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={resumeDraft} className="rounded-lg bg-neutral-950 px-4 py-2 text-sm font-bold text-white">이어서 작성</button>
              <button type="button" onClick={draft.discard} className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-600">새로 작성</button>
            </div>
          </section>
        )}
        {!nothingAvailable && !draft.pendingDraft && (
          <p className="mt-3 text-xs leading-5 text-neutral-500" role="status">
            {draft.saveStatus === "unavailable" ? "이 브라우저에서는 임시저장이 안 돼요. 화면을 닫기 전에 등록을 완료해 주세요." : "입력한 글은 이 브라우저에 7일간 임시저장돼요. 사진·동의는 제외되며 로그아웃하면 삭제돼요."}
          </p>
        )}
        {nothingAvailable && error && <p role="alert" className="mt-4 text-sm text-rose-700">{error}</p>}
        <fieldset disabled={submitting || Boolean(draft.pendingDraft) || !draft.ready} aria-busy={submitting} className="min-w-0">
        <section id={onboardingFieldId("targets")} tabIndex={-1} aria-describedby={fieldErrors.targets ? `${onboardingFieldId("targets")}-error` : undefined} className="mt-5 border-y border-neutral-200 bg-white py-3">
          <div className="grid grid-cols-2 gap-2">
            {(["open", "oneOnOne"] as TargetKey[]).map((key) => {
              const label = key === "open" ? "오픈카드" : "1:1 매칭";
              const done = completed[key];
              const enabled = available[key] && !done && (!continueToInstantOpenCard || key === "open");
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

        <FieldError id={onboardingFieldId("targets")} error={fieldErrors.targets} />
        {nothingAvailable ? (
          <section className="mt-5 border border-neutral-200 bg-white p-5">
            <p className="text-base font-bold">
              {continueToInstantOpenCard && !completed.open ? "지금은 오픈카드를 등록할 수 없어요" : "이미 준비가 끝났어요"}
            </p>
            <p className="mt-2 text-sm leading-6 text-neutral-600">
              {continueToInstantOpenCard && !completed.open
                ? availabilityNote.open || "오픈카드 작성이 다시 열리면 대기 없이 등록도 이어서 이용할 수 있습니다."
                : completed.oneOnOne
                ? "작성한 1:1 프로필로 추천 후보를 바로 확인할 수 있습니다."
                : "등록된 카드와 진행 상태는 마이페이지에서 확인할 수 있습니다."}
            </p>
            <Link
              href={continueToInstantOpenCard ? "/community/dating/cards" : completed.oneOnOne ? ONE_ON_ONE_CANDIDATES_HREF : "/mypage?section=matching"}
              className="mt-4 inline-flex h-11 items-center bg-neutral-950 px-4 text-sm font-bold text-white"
            >
              {continueToInstantOpenCard ? "오픈카드 홈으로" : completed.oneOnOne ? "1:1 추천 후보 확인하기" : "마이페이지에서 확인"}
            </Link>
          </section>
        ) : (
          <>
            <nav className="mt-5 bg-white px-4 pt-4" aria-label="작성 단계">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-neutral-900">{step + 1}. {STEP_LABELS[step]}</span>
                <span className="text-neutral-400">{step + 1} / {STEP_LABELS.length}</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-100" aria-hidden>
                <div
                  className="h-full rounded-full bg-rose-500 transition-[width] duration-300"
                  style={{ width: `${((step + 1) / STEP_LABELS.length) * 100}%` }}
                />
              </div>
              <div className="mt-2 grid grid-cols-5 gap-1 pb-3">
                {STEP_LABELS.map((label, index) => (
                  <button
                    key={label}
                    type="button"
                    disabled={index > step}
                    onClick={() => index <= step && setStep(index)}
                    className={`min-h-8 truncate rounded-md px-1 text-[10px] font-bold ${
                      index === step
                        ? "bg-rose-50 text-rose-700"
                        : index < step
                          ? "text-neutral-600 hover:bg-neutral-50"
                          : "text-neutral-300"
                    } disabled:cursor-default`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </nav>

            <section className="bg-white px-4 py-5 sm:px-5">
              {step === 0 && (
                <div>
                  <StepHeading title="기본 정보" description="두 서비스에 공통으로 들어갈 정보예요." />
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    {!nicknameSaved && <TextField {...fieldProps("nickname")} value={nickname} onChange={(value) => setNickname(normalizeNickname(value).slice(0, 12))} label="닉네임" placeholder="사이트에서 사용할 닉네임" className="sm:col-span-2" maxLength={12} />}
                    <div className="sm:col-span-2">
                      <FieldLabel>성별 (필수)</FieldLabel>
                      <div id={onboardingFieldId("sex")} tabIndex={-1} aria-describedby={fieldErrors.sex ? `${onboardingFieldId("sex")}-error` : undefined} className="grid grid-cols-2 border border-neutral-200" role="group" aria-label="성별 선택">
                        <Choice active={sex === "male"} onClick={() => setSex("male")}>남자</Choice>
                        <Choice active={sex === "female"} onClick={() => setSex("female")}>여자</Choice>
                      </div>
                      <FieldError {...fieldProps("sex")} />
                    </div>
                    {targets.oneOnOne && <TextField {...fieldProps("name")} value={name} onChange={setName} label="이름" placeholder="1:1 운영 확인용 이름" className="sm:col-span-2" maxLength={30} />}
                    <TextField {...fieldProps("birthYear")} value={birthYear} onChange={(value) => setBirthYear(value.replace(/\D/g, "").slice(0, 4))} label="출생연도" placeholder="예: 1996" inputMode="numeric" />
                    <TextField {...fieldProps("heightCm")} value={heightCm} onChange={(value) => setHeightCm(value.replace(/\D/g, "").slice(0, 3))} label="키(cm)" placeholder="예: 175" inputMode="numeric" />
                    <TextField {...fieldProps("job")} value={job} onChange={setJob} label="직업" placeholder="직업" className="sm:col-span-2" maxLength={targets.open ? 50 : 80} />
                    <TextField {...fieldProps("region")} value={region} onChange={setRegion} label="지역" placeholder="예: 서울 마포구" className="sm:col-span-2" maxLength={targets.open ? 30 : 80} />
                  </div>
                </div>
              )}

              {step === 1 && (
                <div>
                  <StepHeading title="내 소개" description="상대가 나를 이해하고 대화를 시작하기 쉬운 내용을 적어 주세요." />
                  <div className="mt-5 space-y-4">
                    {targets.oneOnOne && <TextArea {...fieldProps("introText")} value={introText} onChange={setIntroText} label="요즘 나는 어떤 사람인가요?" placeholder="평소 일상, 주말에 하는 일, 좋아하는 것 등을 적어 주세요." maxLength={2000} />}
                    <TextArea {...fieldProps("strengthsText")} value={strengthsText} onChange={setStrengthsText} label="나와 만나면 어떤 점이 좋을까요?" placeholder="성격이나 관계에서의 장점을 구체적으로 적어 주세요." maxLength={targets.open ? 150 : 1000} />
                    <TextArea {...fieldProps("preferredPartnerText")} value={preferredPartnerText} onChange={setPreferredPartnerText} label="어떤 사람을 만나고 싶나요?" placeholder="성격, 대화 방식, 함께 하고 싶은 일 등을 적어 주세요." maxLength={1000} />
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
                      <TextField {...fieldProps("trainingYears")} value={trainingYears} onChange={(value) => setTrainingYears(value.replace(/\D/g, "").slice(0, 2))} label="운동 경력(년)" placeholder="예: 3" inputMode="numeric" />
                      <TextField {...fieldProps("total3Lift")} value={total3Lift} onChange={(value) => setTotal3Lift(value.replace(/\D/g, "").slice(0, 4))} label="3대 합계(선택)" placeholder="선택 입력" inputMode="numeric" />
                      <TextField {...fieldProps("instagramId")} value={instagramId} onChange={(value) => setInstagramId(normalizeInstagramId(value))} label="인스타그램 아이디" placeholder="@ 제외" className="sm:col-span-2" />
                    </div>
                  )}
                </div>
              )}

              {step === 3 && (
                <div>
                  <StepHeading title="사진 두 장" description="한 번 선택하면 오픈카드와 1:1에 각각 안전하게 저장해요." />
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    {[0, 1].map((index) => (
                      <div key={index} className="min-w-0"><label className="relative flex aspect-[4/5] cursor-pointer items-center justify-center overflow-hidden border border-dashed border-neutral-300 bg-neutral-50">
                        {previewUrls[index] ? <NextImage src={previewUrls[index] ?? ""} alt={`사진 ${index + 1} 미리보기`} fill sizes="(max-width: 640px) 45vw, 250px" unoptimized className="object-contain" /> : <span className="text-sm font-bold text-neutral-500">사진 {index + 1} 선택</span>}
                        <input id={onboardingFieldId(`photo${index}`)} aria-label={`사진 ${index + 1}`} aria-invalid={Boolean(fieldErrors[index === 0 ? "photo0" : "photo1"] || photoSelectionErrors[index])} aria-describedby={(fieldErrors[index === 0 ? "photo0" : "photo1"] || photoSelectionErrors[index]) ? `${onboardingFieldId(`photo${index}`)}-error` : undefined} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => {
                          const file = event.target.files?.[0] ?? null;
                          if (file) {
                            const message = photoError(file);
                            if (message) {
                              setPhotoSelectionErrors((current) => current.map((item, i) => i === index ? message : item));
                              event.currentTarget.value = "";
                              return;
                            }
                          }
                          setError("");
                          setPhotoSelectionErrors((current) => current.map((item, i) => i === index ? "" : item));
                          setPhotos((current) => current.map((item, itemIndex) => itemIndex === index ? file : item));
                          setOpenAssets(null);
                          setOneOnOnePhotoPaths(null);
                        }} />
                      </label><FieldError id={onboardingFieldId(`photo${index}`)} error={photoSelectionErrors[index] || fieldErrors[index === 0 ? "photo0" : "photo1"]} /></div>
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
                      <Consent {...fieldProps("consentOpenCard")} checked={consentOpenCard} onChange={setConsentOpenCard}>오픈카드의 소개·강점·사진 공개 범위를 확인했고, 수락 후 인스타그램 아이디가 상대에게 공개되는 것에 동의합니다.</Consent>
                    )}
                    {targets.oneOnOne && (
                      <>
                        <Consent {...fieldProps("consentFakeInfo")} checked={consentFakeInfo} onChange={setConsentFakeInfo}>허위 정보 작성 시 이용이 제한될 수 있어요.</Consent>
                        <Consent {...fieldProps("consentNoShow")} checked={consentNoShow} onChange={setConsentNoShow}>노쇼나 무단 취소 시 재이용이 제한될 수 있어요.</Consent>
                        <Consent {...fieldProps("consentFee")} checked={consentFee} onChange={setConsentFee}>번호 교환 시 매칭비가 발생하고 연락처가 공개돼요.</Consent>
                        <Consent {...fieldProps("consentNoDirectContact")} checked={consentNoDirectContact} onChange={setConsentNoDirectContact}>신청서에는 휴대폰 번호, 카카오톡 ID, 인스타 계정, 오픈채팅 링크 등 외부 연락처를 적지 않아요.</Consent>
                        <Consent {...fieldProps("consentPrivacy")} checked={consentPrivacy} onChange={setConsentPrivacy}>개인정보는 1:1 매칭 진행, 운영 확인, 안전 관리 목적으로만 사용돼요.</Consent>
                      </>
                    )}
                  </div>
                  <DatingAdultNotice />
                </div>
              )}

              {error && <p role="alert" className="mt-5 whitespace-pre-line border border-rose-200 bg-rose-50 p-3 text-sm leading-6 text-rose-700">{error}</p>}
              {info && <p className="mt-5 border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-700">{info}</p>}
              {progress && <p className="mt-3 text-center text-xs font-semibold text-neutral-500">{progress}</p>}

              <div className="mt-6 grid grid-cols-[auto_1fr] gap-2">
                <button type="button" disabled={submitting || step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))} className="h-12 border border-neutral-300 bg-white px-5 text-sm font-bold text-neutral-700 disabled:opacity-30">이전</button>
                {step < STEP_LABELS.length - 1 ? (
                  <button type="button" onClick={moveNext} className="h-12 bg-neutral-950 px-5 text-sm font-bold text-white">다음</button>
                ) : allSelectedDone ? (
                  <button
                    type="button"
                    onClick={() => router.replace(completed.oneOnOne ? ONE_ON_ONE_CANDIDATES_HREF : "/community/dating/cards")}
                    className="h-12 bg-emerald-600 px-5 text-sm font-bold text-white"
                  >
                    {completed.oneOnOne ? "1:1 추천 후보 확인하기" : "오픈카드 홈으로"}
                  </button>
                ) : (
                  <button type="button" disabled={submitting} onClick={() => void submit()} className="h-12 bg-rose-500 px-5 text-sm font-bold text-white disabled:opacity-50">{submitting ? "등록 중..." : completed.open || completed.oneOnOne ? "남은 등록 다시 시도" : "선택한 프로필 등록하기"}</button>
                )}
              </div>
            </section>
          </>
        )}
        </fieldset>
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
  return <button type="button" aria-pressed={active} onClick={onClick} className={`h-11 text-sm font-bold ${active ? "bg-rose-50 text-rose-700" : "bg-white text-neutral-500"}`}>{children}</button>;
}

type FieldFeedback = { id: string; error?: string };

function FieldError({ id, error }: FieldFeedback) {
  return error ? <p id={`${id}-error`} className="mt-1.5 text-xs leading-5 text-rose-700">{error}</p> : null;
}

function TextField({ id, error, value, onChange, label, placeholder, className = "", inputMode, maxLength }: FieldFeedback & { value: string; onChange: (value: string) => void; label: string; placeholder: string; className?: string; inputMode?: "text" | "numeric"; maxLength?: number }) {
  return <label className={className}><span className="mb-2 block text-xs font-bold text-neutral-700">{label}</span><input id={id} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} inputMode={inputMode} maxLength={maxLength} className={`h-12 w-full border ${error ? "border-rose-400" : "border-neutral-300"} bg-white px-3 text-sm text-neutral-900 outline-none focus:border-neutral-900`} /><FieldError id={id} error={error} /></label>;
}

function TextArea({ id, error, value, onChange, label, placeholder, maxLength }: FieldFeedback & { value: string; onChange: (value: string) => void; label: string; placeholder: string; maxLength: number }) {
  return <label className="block"><span className="mb-2 flex items-center justify-between text-xs font-bold text-neutral-700"><span>{label}</span><span className="font-normal text-neutral-400">{value.length}/{maxLength}</span></span><textarea id={id} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} maxLength={maxLength} rows={4} className={`w-full border ${error ? "border-rose-400" : "border-neutral-300"} bg-white px-3 py-3 text-sm leading-6 text-neutral-900 outline-none focus:border-neutral-900`} /><FieldError id={id} error={error} /></label>;
}

function Consent({ id, error, checked, onChange, children }: FieldFeedback & { checked: boolean; onChange: (value: boolean) => void; children: ReactNode }) {
  return <div><label className={`flex min-h-12 items-start gap-3 border ${error ? "border-rose-400" : "border-neutral-200"} bg-neutral-50 p-3 text-sm leading-5 text-neutral-700`}><input id={id} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 accent-rose-500" /><span>{children}</span></label><FieldError id={id} error={error} /></div>;
}
