"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DATING_PAID_FIXED_BADGE_LABEL, DATING_PAID_FIXED_HOURS, DATING_PAID_FIXED_LABEL, DATING_PAID_FIXED_SHORT_LABEL } from "@/lib/dating-paid";
import { formatRemainingToKorean } from "@/lib/dating-open";
import PhoneVerifiedBadge from "@/components/PhoneVerifiedBadge";
import DatingAdultNotice from "@/components/DatingAdultNotice";
import PaidPolicyNotice from "@/components/PaidPolicyNotice";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 12 * 1024 * 1024;
const PAYMENT_CARD_UNAVAILABLE_MESSAGE =
  "현재 국민/우리/현대 카드는 결제가 되지 않습니다. 다른 카드나 다른 결제수단으로 다시 시도해 주세요.";
const PAID_FORM_STEPS = [
  { title: "등록 방식과 기본 정보", description: "노출 방식을 고르고 기본 프로필을 입력해주세요." },
  { title: "소개와 연락 정보", description: "장점과 이상형, 수락 후 공개할 인스타그램을 적어주세요." },
  { title: "사진 확인", description: "실제로 공개될 사진 2장을 확인해주세요." },
  { title: "입력 내용 확인", description: "등록 내용을 확인한 뒤 결제를 진행해주세요." },
] as const;

type SubmitMode = "kakaopay" | "manual";

type PaidItem = {
  id: string;
  nickname: string;
  is_phone_verified?: boolean;
  gender: "M" | "F";
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  is_3lift_verified: boolean;
  strengths_text: string | null;
  ideal_text: string | null;
  intro_text: string | null;
  photo_visibility: "blur" | "public";
  thumbUrl: string;
  image_urls?: string[];
  expires_at: string | null;
  paid_at: string | null;
  display_mode?: "priority_24h" | "instant_public";
};

type EditablePaidCard = {
  id: string;
  gender: "M" | "F";
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  strengths_text: string | null;
  ideal_text: string | null;
  instagram_id: string | null;
  photo_visibility: "blur" | "public";
  display_mode?: "priority_24h" | "instant_public";
  blur_thumb_path: string | null;
  photo_paths: string[];
  photo_preview_urls?: string[];
  status?: "pending" | "approved";
  paid_at?: string | null;
  expires_at?: string | null;
};

type SourceOpenCard = {
  id: string;
  sex: "male" | "female";
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  strengths_text: string | null;
  ideal_type: string | null;
  instagram_id: string | null;
  photo_visibility: "blur" | "public";
  blur_thumb_path: string | null;
  photo_paths: string[];
  photo_preview_urls?: string[];
  status: "pending" | "public" | "expired" | "hidden";
};

function normalizeInstagramId(value: string) {
  return value.trim().replace(/^@+/, "").replace(/\s+/g, "").slice(0, 30);
}

function createClientAssetId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `asset-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function withPaymentCardNotice(message: string) {
  return `${message}\n${PAYMENT_CARD_UNAVAILABLE_MESSAGE}`;
}

async function fetchWithNetworkMessage(
  input: RequestInfo | URL,
  init: RequestInit,
  networkMessage: string
) {
  try {
    return await fetch(input, init);
  } catch {
    throw new Error(networkMessage);
  }
}

async function createBlurThumbnailFile(source: File): Promise<File> {
  const imageUrl = URL.createObjectURL(source);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image-load-failed"));
      el.src = imageUrl;
    });

    const maxWidth = 960;
    const ratio = img.width > maxWidth ? maxWidth / img.width : 1;
    const width = Math.max(1, Math.round(img.width * ratio));
    const height = Math.max(1, Math.round(img.height * ratio));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas-context-missing");

    ctx.filter = "blur(9px)";
    ctx.drawImage(img, 0, 0, width, height);
    ctx.filter = "none";

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("blur-generate-failed"))), "image/jpeg", 0.82);
    });

    return new File([blob], "paid_blur_thumb.jpg", { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export default function DatingPaidPage() {
  const [editId, setEditId] = useState("");
  const isEditMode = editId.length > 0;
  const supabase = useMemo(() => createClient(), []);
  const openKakaoUrl = process.env.NEXT_PUBLIC_OPENKAKAO_URL ?? "https://open.kakao.com/o/s2gvTdhi";

  const [items, setItems] = useState<PaidItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitMode, setSubmitMode] = useState<SubmitMode>("kakaopay");
  const [error, setError] = useState("");
  const [successId, setSuccessId] = useState("");
  const [successWasEdit, setSuccessWasEdit] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formStep, setFormStep] = useState(1);
  const [editLoading, setEditLoading] = useState(false);

  const [gender, setGender] = useState<"M" | "F">("M");
  const [age, setAge] = useState("");
  const [region, setRegion] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [job, setJob] = useState("");
  const [trainingYears, setTrainingYears] = useState("");
  const [strengthsText, setStrengthsText] = useState("");
  const [idealText, setIdealText] = useState("");
  const [instagramId, setInstagramId] = useState("");
  const [photoVisibility, setPhotoVisibility] = useState<"blur" | "public">("blur");
  const [displayMode, setDisplayMode] = useState<"priority_24h" | "instant_public">("priority_24h");
  const [photos, setPhotos] = useState<(File | null)[]>([null, null]);
  const [previewUrls, setPreviewUrls] = useState<(string | null)[]>([null, null]);
  const [previewFailed, setPreviewFailed] = useState<boolean[]>([false, false]);
  const [existingRawPaths, setExistingRawPaths] = useState<string[]>([]);
  const [existingPreviewUrls, setExistingPreviewUrls] = useState<string[]>([]);
  const [existingBlurThumbPath, setExistingBlurThumbPath] = useState("");
  const [editingPaidCardStatus, setEditingPaidCardStatus] = useState<"pending" | "approved" | "">("");
  const [sourceOpenCard, setSourceOpenCard] = useState<SourceOpenCard | null>(null);
  const [sourcePrefillLoading, setSourcePrefillLoading] = useState(false);
  const [sourcePrefillMessage, setSourcePrefillMessage] = useState("");
  const [tick, setTick] = useState(0);

  const loadItems = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dating/paid/list", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { items?: PaidItem[] };
      setItems(Array.isArray(body.items) ? body.items : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    queueMicrotask(loadItems);
  }, []);

  useEffect(() => {
    const urls = photos.map((file) => (file ? URL.createObjectURL(file) : null));
    setPreviewUrls(urls);
    setPreviewFailed(photos.map(() => false));
    return () => {
      urls.forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, [photos]);

  const handlePhotoChange = (index: 0 | 1, file: File | null) => {
    setPhotos((prev) => {
      const next = [...prev] as (File | null)[];
      next[index] = file;
      return next;
    });
    setPreviewFailed((prev) => {
      const next = [...prev];
      next[index] = false;
      return next;
    });
  };

  useEffect(() => {
    const timer = window.setInterval(() => setTick((v) => v + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const nextId = params.get("editId") ?? "";
    const shouldOpenForm = params.get("apply") === "1" || params.get("apply") === "true";
    const shouldReuseOpenCard = params.get("source") === "open_card";
    setEditId(nextId);
    if (shouldOpenForm) {
      setFormStep(1);
      setFormOpen(true);
    }

    if (!nextId && shouldOpenForm && shouldReuseOpenCard) {
      setSourcePrefillLoading(true);
      queueMicrotask(async () => {
        try {
          const res = await fetch("/api/dating/paid/create?source=open_card", { cache: "no-store" });
          const body = (await res.json().catch(() => ({}))) as { card?: SourceOpenCard; code?: string; message?: string };
          if (!res.ok || !body.card) {
            if (res.status === 401 || body.code === "UNAUTHORIZED") {
              const nextPath = "/onboarding/dating?next=instant_open_card";
              window.location.href = `/login?redirect=${encodeURIComponent(nextPath)}`;
              return;
            }
            if (res.status === 404 || body.code === "SOURCE_NOT_FOUND") {
              window.location.href = "/onboarding/dating?next=instant_open_card";
              return;
            }
            throw new Error(body.message ?? "기존 오픈카드를 불러오지 못했습니다.");
          }
          const sourceCard = body.card;

          const rawPaths = Array.isArray(sourceCard.photo_paths)
            ? sourceCard.photo_paths.filter((path): path is string => typeof path === "string" && path.length > 0).slice(0, 2)
            : [];
          const previewUrls = Array.isArray(sourceCard.photo_preview_urls)
            ? sourceCard.photo_preview_urls.filter((url): url is string => typeof url === "string" && url.length > 0).slice(0, 2)
            : [];
          const normalizedInstagram = normalizeInstagramId(sourceCard.instagram_id ?? "");

          setSourceOpenCard(sourceCard);
          setGender(sourceCard.sex === "female" ? "F" : "M");
          setAge(sourceCard.age != null ? String(sourceCard.age) : "");
          setRegion(sourceCard.region ?? "");
          setHeightCm(sourceCard.height_cm != null ? String(sourceCard.height_cm) : "");
          setJob(sourceCard.job ?? "");
          setTrainingYears(sourceCard.training_years != null ? String(sourceCard.training_years) : "");
          setStrengthsText(sourceCard.strengths_text ?? "");
          setIdealText(sourceCard.ideal_type ?? "");
          setInstagramId(normalizedInstagram);
          setPhotoVisibility(sourceCard.photo_visibility === "public" ? "public" : "blur");
          setDisplayMode("instant_public");
          setExistingRawPaths(rawPaths);
          setExistingPreviewUrls(previewUrls);
          setExistingBlurThumbPath(sourceCard.blur_thumb_path ?? "");
          setFormStep(/^[A-Za-z0-9._]{1,30}$/.test(normalizedInstagram) && rawPaths.length === 2 ? 4 : 2);
          setSourcePrefillMessage(
            sourceCard.status === "pending"
              ? "대기 중인 오픈카드는 그대로 두고, 같은 내용으로 즉시 공개 카드를 별도 등록합니다."
              : "기존 오픈카드 내용으로 즉시 공개 카드를 별도 등록합니다."
          );
        } catch (prefillError) {
          setDisplayMode("instant_public");
          setSourcePrefillMessage(
            prefillError instanceof Error ? prefillError.message : "기존 오픈카드를 불러오지 못했습니다."
          );
        } finally {
          setSourcePrefillLoading(false);
        }
      });
    }
  }, []);

  useEffect(() => {
    if (!isEditMode || !editId) return;
    let cancelled = false;
    setFormOpen(true);
    setFormStep(1);
    setEditLoading(true);
    queueMicrotask(async () => {
      try {
        const res = await fetch(`/api/dating/paid/create?id=${encodeURIComponent(editId)}`, { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as { card?: EditablePaidCard; message?: string };
        if (!res.ok || !body.card) {
          if (!cancelled) setError(body.message ?? "수정할 유료카드를 불러오지 못했습니다.");
          return;
        }
        if (cancelled) return;
        setGender(body.card.gender);
        setAge(body.card.age != null ? String(body.card.age) : "");
        setRegion(body.card.region ?? "");
        setHeightCm(body.card.height_cm != null ? String(body.card.height_cm) : "");
        setJob(body.card.job ?? "");
        setTrainingYears(body.card.training_years != null ? String(body.card.training_years) : "");
        setStrengthsText(body.card.strengths_text ?? "");
        setIdealText(body.card.ideal_text ?? "");
        setInstagramId(body.card.instagram_id ?? "");
        setPhotoVisibility(body.card.photo_visibility === "public" ? "public" : "blur");
        setDisplayMode(body.card.display_mode === "instant_public" ? "instant_public" : "priority_24h");
        setExistingRawPaths(Array.isArray(body.card.photo_paths) ? body.card.photo_paths : []);
        setExistingPreviewUrls(Array.isArray(body.card.photo_preview_urls) ? body.card.photo_preview_urls : []);
        setExistingBlurThumbPath(body.card.blur_thumb_path ?? "");
        setEditingPaidCardStatus(body.card.status === "approved" ? "approved" : "pending");
      } catch {
        if (!cancelled) setError("수정할 유료카드를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setEditLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [editId, isEditMode]);

  const moveToFormStep = (step: number) => {
    setError("");
    setFormStep(Math.min(PAID_FORM_STEPS.length, Math.max(1, step)));
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        document.getElementById("paid-create-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  };

  const validateFormStep = (step: number) => {
    if (step === 1) {
      const ageValue = age ? Number(age) : null;
      const heightValue = heightCm ? Number(heightCm) : null;
      const trainingValue = trainingYears ? Number(trainingYears) : null;
      if (ageValue != null && (!Number.isFinite(ageValue) || ageValue < 19 || ageValue > 99)) {
        return "나이는 19세부터 99세까지 입력해주세요.";
      }
      if (heightValue != null && (!Number.isFinite(heightValue) || heightValue < 120 || heightValue > 230)) {
        return "키는 120cm부터 230cm까지 입력해주세요.";
      }
      if (trainingValue != null && (!Number.isFinite(trainingValue) || trainingValue < 0 || trainingValue > 50)) {
        return "운동 경력은 0년부터 50년까지 입력해주세요.";
      }
    }

    if (step === 2) {
      const normalizedInstagramId = normalizeInstagramId(instagramId);
      if (!normalizedInstagramId) return "인스타그램 아이디를 입력해주세요.";
      if (!/^[A-Za-z0-9._]{1,30}$/.test(normalizedInstagramId)) {
        return "인스타그램 아이디 형식을 확인해 주세요. (@ 제외, 최대 30자)";
      }
    }

    if (step === 3) {
      const hasFirstPhoto = Boolean(photos[0]) || Boolean(existingRawPaths[0]);
      const hasSecondPhoto = Boolean(photos[1]) || Boolean(existingRawPaths[1]);
      if (!hasFirstPhoto || !hasSecondPhoto) return "사진 1과 사진 2를 모두 선택해 주세요.";
      for (const photo of photos.filter((item): item is File => Boolean(item))) {
        if (!ALLOWED_TYPES.includes(photo.type)) return "사진은 JPG/PNG/WebP만 업로드할 수 있습니다.";
        if (photo.size > MAX_FILE_SIZE) return "사진은 장당 12MB 이하만 가능합니다.";
      }
    }

    return "";
  };

  const handleNextFormStep = () => {
    const message = validateFormStep(formStep);
    if (message) {
      setError(message);
      return;
    }
    moveToFormStep(formStep + 1);
  };

  const submitPaidRequest = async (requestedSubmitMode: SubmitMode) => {
    if (submitting) return;
    setSubmitMode(requestedSubmitMode);
    setError("");
    setSuccessId("");
    setSuccessWasEdit(false);

    for (let step = 1; step <= 3; step += 1) {
      const message = validateFormStep(step);
      if (message) {
        setFormStep(step);
        setError(message);
        return;
      }
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      window.location.href = `/login?redirect=${encodeURIComponent("/dating/paid")}`;
      return;
    }

    const normalizedInstagramId = normalizeInstagramId(instagramId);
    if (!/^[A-Za-z0-9._]{1,30}$/.test(normalizedInstagramId)) {
      setError("인스타그램 아이디 형식을 확인해 주세요. (@ 제외, 최대 30자)");
      return;
    }

    const combinedPhotoCount = [
      photos[0] ? "new-0" : existingRawPaths[0],
      photos[1] ? "new-1" : existingRawPaths[1],
    ].filter(Boolean).length;
    if (combinedPhotoCount !== 2) {
      setError("사진 1과 사진 2를 모두 선택해 주세요.");
      return;
    }
    for (const photo of photos.filter((p): p is File => Boolean(p))) {
      if (!ALLOWED_TYPES.includes(photo.type)) {
        setError("사진은 JPG/PNG/WebP만 업로드할 수 있습니다.");
        return;
      }
      if (photo.size > MAX_FILE_SIZE) {
        setError("사진은 장당 12MB 이하만 가능합니다.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const nextRawPaths = [...existingRawPaths];
      for (let i = 0; i < 2; i++) {
        const photo = photos[i];
        if (!photo) continue;
        const assetId = createClientAssetId();
        const fd = new FormData();
        fd.append("file", photo);
        fd.append("kind", "raw");
        fd.append("asset_id", assetId);
        fd.append("index", String(i));
        const res = await fetchWithNetworkMessage(
          "/api/dating/cards/upload-card",
          { method: "POST", body: fd },
          `사진 ${i + 1} 업로드 중 연결이 끊겼습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.`
        );
        const body = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
        if (!res.ok || !body.path) {
          setError(body.error ?? "사진 업로드에 실패했습니다.");
          setSubmitting(false);
          return;
        }
        nextRawPaths[i] = body.path;

        try {
          const imageUrl = URL.createObjectURL(photo);
          try {
            const img = await new Promise<HTMLImageElement>((resolve, reject) => {
              const el = new Image();
              el.onload = () => resolve(el);
              el.onerror = () => reject(new Error("image-load-failed"));
              el.src = imageUrl;
            });
            const maxEdge = 1200;
            const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
            const width = Math.max(1, Math.round(img.width * scale));
            const height = Math.max(1, Math.round(img.height * scale));
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("canvas-context-missing");
            ctx.drawImage(img, 0, 0, width, height);
            const liteBlob = await new Promise<Blob>((resolve, reject) => {
              canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("lite-generate-failed"))), "image/webp", 0.78);
            });
            const liteFd = new FormData();
            liteFd.append("file", new File([liteBlob], "lite.webp", { type: "image/webp" }));
            liteFd.append("kind", "lite");
            liteFd.append("asset_id", assetId);
            liteFd.append("index", String(i));
            const liteRes = await fetch("/api/dating/cards/upload-card", { method: "POST", body: liteFd });
            if (!liteRes.ok) {
              console.warn("[dating-paid] lite image upload skipped", { index: i, status: liteRes.status });
            }
          } finally {
            URL.revokeObjectURL(imageUrl);
          }
        } catch (liteError) {
          console.warn("[dating-paid] lite image generation skipped", liteError);
        }
      }

      let blurThumbPath = existingBlurThumbPath;
      if (photoVisibility === "blur" && photos[0]) {
        // If the first photo changed, never reuse the previous photo's blur thumbnail.
        // Leaving this empty lets the API regenerate it from the newly uploaded raw image.
        blurThumbPath = "";
        try {
          const blurFile = await createBlurThumbnailFile(photos[0]);
          const blurFd = new FormData();
          blurFd.append("file", blurFile);
          blurFd.append("kind", "blur");
          blurFd.append("index", "0");
          const blurRes = await fetch("/api/dating/cards/upload-card", { method: "POST", body: blurFd });
          const blurBody = (await blurRes.json().catch(() => ({}))) as { path?: string; error?: string };
          if (blurRes.ok && blurBody.path) {
            blurThumbPath = blurBody.path;
          } else {
            console.warn("[dating-paid] blur thumb upload skipped", { status: blurRes.status, error: blurBody.error ?? null });
          }
        } catch (blurError) {
          console.warn("[dating-paid] blur thumb generation skipped", blurError);
        }
      }
      const filteredRawPaths = nextRawPaths.filter((path): path is string => typeof path === "string" && path.length > 0);
      if (filteredRawPaths.length !== 2 || new Set(filteredRawPaths).size !== 2) {
        setError("사진 2장이 모두 업로드되지 않았습니다. 사진을 다시 확인해 주세요.");
        setSubmitting(false);
        return;
      }

      const payload = {
        ...(isEditMode ? { id: editId } : {}),
        gender,
        age: age ? Number(age) : null,
        region: region.trim(),
        height_cm: heightCm ? Number(heightCm) : null,
        job: job.trim(),
        training_years: trainingYears ? Number(trainingYears) : null,
        strengths_text: strengthsText.trim(),
        ideal_text: idealText.trim(),
        instagram_id: normalizedInstagramId,
        photo_visibility: photoVisibility,
        display_mode: displayMode,
        blur_thumb_path: blurThumbPath || null,
        photo_paths: filteredRawPaths,
      };

      const createRes = await fetchWithNetworkMessage(
        "/api/dating/paid/create",
        {
          method: isEditMode ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        isEditMode
          ? "수정 내용을 저장하는 중 연결이 끊겼습니다. 잠시 후 다시 시도해 주세요."
          : "신청을 접수하는 중 연결이 끊겼습니다. 잠시 후 다시 시도해 주세요."
      );
      const createBody = (await createRes.json().catch(() => ({}))) as {
        ok?: boolean;
        paidCardId?: string;
        message?: string;
      };
      if (!createRes.ok || !createBody.ok || !createBody.paidCardId) {
        setError(createBody.message ?? "유료 요청 생성에 실패했습니다.");
        setSubmitting(false);
        return;
      }

      if (isEditMode) {
        setSuccessId(createBody.paidCardId);
        setSuccessWasEdit(true);
        setPhotos([null, null]);
        setExistingRawPaths([]);
        setExistingPreviewUrls([]);
        setExistingBlurThumbPath("");
        setEditingPaidCardStatus("");
        setFormStep(1);
        setFormOpen(false);
        setEditId("");
        if (typeof window !== "undefined") {
          window.history.replaceState(null, "", "/dating/paid");
        }
        await loadItems();
        if (typeof globalThis !== "undefined" && typeof globalThis.scrollTo === "function") {
          globalThis.scrollTo({ top: 0, behavior: "smooth" });
        }
        return;
      }

      if (requestedSubmitMode === "manual") {
        setSuccessId(createBody.paidCardId);
        setSuccessWasEdit(false);
        setPhotos([null, null]);
        setAge("");
        setRegion("");
        setHeightCm("");
        setJob("");
        setTrainingYears("");
        setStrengthsText("");
        setIdealText("");
        setInstagramId("");
        setDisplayMode("priority_24h");
        setExistingRawPaths([]);
        setExistingPreviewUrls([]);
        setExistingBlurThumbPath("");
        setEditingPaidCardStatus("");
        setFormStep(1);
        setFormOpen(false);
        await loadItems();
        if (typeof globalThis !== "undefined" && typeof globalThis.scrollTo === "function") {
          globalThis.scrollTo({ top: 0, behavior: "smooth" });
        }
        return;
      }

      let tossCreateRes: Response;
      try {
        tossCreateRes = await fetchWithNetworkMessage(
          "/api/payments/toss/create",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              productType: "paid_card",
              paidCardId: createBody.paidCardId,
            }),
          },
          "결제창을 준비하는 중 연결이 끊겼습니다. 잠시 후 다시 시도해 주세요."
        );
      } catch (paymentError) {
        await fetch(`/api/dating/paid/create?id=${encodeURIComponent(createBody.paidCardId)}`, {
          method: "DELETE",
        }).catch(() => null);
        throw paymentError;
      }
      const tossCreateBody = (await tossCreateRes.json().catch(() => ({}))) as {
        ok?: boolean;
        checkoutUrl?: string;
        message?: string;
      };
      if (!tossCreateRes.ok || !tossCreateBody.ok || !tossCreateBody.checkoutUrl) {
        await fetch(`/api/dating/paid/create?id=${encodeURIComponent(createBody.paidCardId)}`, {
          method: "DELETE",
        }).catch(() => null);
        setError(
          withPaymentCardNotice(tossCreateBody.message ?? "결제창을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.")
        );
        setSubmitting(false);
        return;
      }

      if (typeof window !== "undefined") {
        window.location.href = tossCreateBody.checkoutUrl;
        return;
      }

      setSuccessId(createBody.paidCardId);
      setSuccessWasEdit(false);
      setPhotos([null, null]);
      setAge("");
      setRegion("");
      setHeightCm("");
      setJob("");
      setTrainingYears("");
      setStrengthsText("");
      setIdealText("");
      setInstagramId("");
      setDisplayMode("priority_24h");
      setExistingRawPaths([]);
      setExistingPreviewUrls([]);
      setExistingBlurThumbPath("");
      setEditingPaidCardStatus("");
      setFormStep(1);
      setFormOpen(false);
      await loadItems();
      if (typeof globalThis !== "undefined" && typeof globalThis.scrollTo === "function") {
        globalThis.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "네트워크 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void submitPaidRequest("kakaopay");
  };

  const fixedItems = useMemo(() => items.filter((item) => item.display_mode !== "instant_public"), [items]);
  const maleItems = useMemo(() => fixedItems.filter((item) => item.gender === "M"), [fixedItems]);
  const femaleItems = useMemo(() => fixedItems.filter((item) => item.gender === "F"), [fixedItems]);
  const nowTick = useMemo(() => tick, [tick]);
  void nowTick;

  return (
    <main className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Link href="/community/dating/cards" className="rounded-full border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50">
          오픈카드
        </Link>
        <span className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-rose-300 bg-gradient-to-r from-rose-50 to-orange-50 px-3.5 py-1.5 text-sm font-semibold text-rose-700 shadow-sm ring-2 ring-rose-100">
          <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white">추천</span>
          <span>대기 없이 등록</span>
        </span>
        <a
          href={openKakaoUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
        >
          구매문의(오픈카톡)
        </a>
      </div>

      <section className="rounded-2xl border border-rose-200 bg-gradient-to-br from-white via-rose-50/70 to-orange-50/70 p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-xl font-bold text-neutral-900">{DATING_PAID_FIXED_BADGE_LABEL} 신청</h1>
          <Link
            href="/dating/paid?apply=1&source=open_card"
            className="rounded-lg bg-rose-500 px-3 py-2 text-sm font-medium text-white hover:bg-rose-600"
          >
            신청하기
          </Link>
        </div>
        <p className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
          대기 없이 등록과 상단 고정은 일반 오픈카드보다 지원률이 2배가량 높아요.
        </p>
        <p className="mt-2 text-sm text-neutral-600">대기열 없이 게시 · 지원서 여러 장 수락 가능 · {DATING_PAID_FIXED_HOURS}시간 글에는 하루 지원권 차감 없이 지원 가능 · 남/녀 오픈카드 최상단에 고정 노출</p>
        <p className="mt-2 inline-flex items-center gap-2 rounded-full border border-rose-200 bg-white/90 px-3 py-1 text-xs font-medium text-rose-700">
          <span className="inline-block h-2 w-2 rounded-full bg-rose-500" />
          기다리지 않고 바로 눈에 띄게 올리는 빠른 등록 옵션
        </p>
        <p className="mt-2 text-xs text-neutral-500">가격: 10,000원</p>
      </section>

      <DatingAdultNotice />

      {successId && (
        <section className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <p className="font-semibold">{successWasEdit ? "유료카드가 수정되었습니다." : "신청이 접수되었습니다."}</p>
          <p className="mt-1">신청ID: {successId}</p>
          <p className="mt-1">
            {successWasEdit
              ? "기존 결제 상태와 노출 시간은 유지됩니다. 추가 결제는 진행되지 않습니다."
              : "결제는 스윙카톡에서 진행됩니다. 스윙카톡으로 \"닉네임 + 신청ID\"를 보내주세요."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setSuccessId("");
                setSuccessWasEdit(false);
                setFormOpen(true);
                if (typeof window !== "undefined") {
                  document.getElementById("paid-create-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }
              }}
              className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-emerald-700"
            >
              다시 작성하기
            </button>
            {!successWasEdit && (
              <a href={openKakaoUrl} target="_blank" rel="noreferrer" className="inline-block rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-emerald-700">
                스윙카톡 이동
              </a>
            )}
          </div>
        </section>
      )}

      {formOpen && (
        <section id="paid-create-form" className="mt-5 rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-rose-600">
                {formStep} / {PAID_FORM_STEPS.length}
              </p>
              <h2 className="mt-1 text-lg font-bold text-neutral-900">
                {isEditMode && formStep === 1 ? "유료 신청 수정" : PAID_FORM_STEPS[formStep - 1]?.title}
              </h2>
              <p className="mt-1 text-sm leading-5 text-neutral-500">{PAID_FORM_STEPS[formStep - 1]?.description}</p>
            </div>
            <span className="shrink-0 text-xs font-semibold text-neutral-400">
              {Math.round((formStep / PAID_FORM_STEPS.length) * 100)}%
            </span>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-1.5" aria-label="작성 진행 단계">
            {PAID_FORM_STEPS.map((step, index) => (
              <button
                key={step.title}
                type="button"
                aria-label={`${index + 1}단계 ${step.title}`}
                onClick={() => index + 1 < formStep && moveToFormStep(index + 1)}
                className={`h-1.5 rounded-full ${index + 1 <= formStep ? "bg-rose-500" : "bg-neutral-200"}`}
              />
            ))}
          </div>

          <form onSubmit={handleSubmit} noValidate className="mt-5">
            {editLoading && <p className="mb-4 text-sm text-neutral-500">기존 카드 정보를 불러오는 중...</p>}
            {sourcePrefillLoading ? (
              <div className="mb-4 rounded-xl border border-rose-100 bg-rose-50 px-3 py-3">
                <p className="text-sm font-bold text-rose-900">내 오픈카드 내용을 불러오는 중...</p>
                <p className="mt-1 text-xs leading-5 text-rose-700">사진과 프로필을 다시 입력하지 않도록 준비하고 있어요.</p>
              </div>
            ) : sourcePrefillMessage ? (
              <div className={`mb-4 rounded-xl border px-3 py-3 ${sourceOpenCard ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                <p className={`text-sm font-bold ${sourceOpenCard ? "text-emerald-900" : "text-amber-900"}`}>
                  {sourceOpenCard ? "기존 프로필을 불러왔어요" : "프로필을 확인해 주세요"}
                </p>
                <p className={`mt-1 text-xs leading-5 ${sourceOpenCard ? "text-emerald-800" : "text-amber-800"}`}>
                  {sourcePrefillMessage}
                </p>
              </div>
            ) : null}

            {formStep === 1 && (
              <div className="space-y-4">
                <div>
                  <p className="mb-2 text-sm font-semibold text-neutral-900">성별</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setGender("M")} className={`h-11 rounded-xl border text-sm font-medium ${gender === "M" ? "border-rose-500 bg-rose-500 text-white" : "border-neutral-300 bg-white text-neutral-700"}`}>
                      남자
                    </button>
                    <button type="button" onClick={() => setGender("F")} className={`h-11 rounded-xl border text-sm font-medium ${gender === "F" ? "border-rose-500 bg-rose-500 text-white" : "border-neutral-300 bg-white text-neutral-700"}`}>
                      여자
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-neutral-200 p-3">
                  <p className="text-sm font-semibold text-neutral-900">노출 방식</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setDisplayMode("priority_24h")}
                      className={`min-h-11 rounded-xl border px-3 text-sm font-medium ${
                        displayMode === "priority_24h" ? "border-rose-500 bg-rose-500 text-white" : "border-neutral-300 bg-white text-neutral-700"
                      }`}
                    >
                      {DATING_PAID_FIXED_LABEL}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDisplayMode("instant_public")}
                      className={`min-h-11 rounded-xl border px-3 text-sm font-medium ${
                        displayMode === "instant_public" ? "border-emerald-600 bg-emerald-600 text-white" : "border-neutral-300 bg-white text-neutral-700"
                      }`}
                    >
                      대기 없이 등록
                    </button>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-neutral-500">
                    {displayMode === "priority_24h" ? `${DATING_PAID_FIXED_LABEL}으로 노출됩니다.` : "기존 대기 카드는 유지하고 별도 카드가 바로 공개됩니다."}
                  </p>
                </div>

                <div>
                  <p className="mb-2 text-sm font-semibold text-neutral-900">기본 정보</p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <input className="input" placeholder="나이" inputMode="numeric" type="number" min={19} max={99} value={age} onChange={(e) => setAge(e.target.value)} />
                    <input className="input" placeholder="지역" maxLength={50} value={region} onChange={(e) => setRegion(e.target.value)} />
                    <input className="input" placeholder="키(cm)" inputMode="numeric" type="number" min={120} max={230} value={heightCm} onChange={(e) => setHeightCm(e.target.value)} />
                    <input className="input" placeholder="직업" maxLength={80} value={job} onChange={(e) => setJob(e.target.value)} />
                    <input className="input md:col-span-2" placeholder="운동경력(년)" inputMode="numeric" type="number" min={0} max={50} value={trainingYears} onChange={(e) => setTrainingYears(e.target.value)} />
                  </div>
                </div>
              </div>
            )}

            {formStep === 2 && (
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-neutral-900" htmlFor="paid-strengths">내 장점</label>
                  <textarea id="paid-strengths" className="w-full rounded-xl border border-neutral-300 px-3 py-3" rows={4} maxLength={300} placeholder="나를 잘 보여주는 장점을 적어주세요." value={strengthsText} onChange={(e) => setStrengthsText(e.target.value)} />
                  <p className="mt-1 text-right text-xs text-neutral-400">{strengthsText.length}/300</p>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-neutral-900" htmlFor="paid-ideal">원하는 상대</label>
                  <textarea id="paid-ideal" className="w-full rounded-xl border border-neutral-300 px-3 py-3" rows={5} maxLength={1000} placeholder="어떤 사람을 만나고 싶은지 적어주세요." value={idealText} onChange={(e) => setIdealText(e.target.value)} />
                  <p className="mt-1 text-right text-xs text-neutral-400">{idealText.length}/1000</p>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-neutral-900" htmlFor="paid-instagram">인스타그램 아이디</label>
                  <input id="paid-instagram" className="input" placeholder="@ 없이 입력" maxLength={30} autoCapitalize="none" autoCorrect="off" value={instagramId} onChange={(e) => setInstagramId(normalizeInstagramId(e.target.value))} />
                  <p className="mt-2 text-xs leading-5 text-neutral-500">인스타그램은 매칭 수락 후 상대에게 공개됩니다.</p>
                </div>
              </div>
            )}

            {formStep === 3 && (
              <div className="space-y-4">
                <label className="flex min-h-12 items-center gap-3 rounded-xl border border-neutral-200 px-3 py-2 text-sm text-neutral-700">
                  <input type="checkbox" checked={photoVisibility === "public"} onChange={(e) => setPhotoVisibility(e.target.checked ? "public" : "blur")} className="h-4 w-4" />
                  <span>사진을 블러 없이 공개합니다. 미선택 시 블러 처리됩니다.</span>
                </label>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {([0, 1] as const).map((index) => {
                    const selectedPreview = previewUrls[index];
                    const existingPreview = existingPreviewUrls[index];
                    return (
                      <div key={index} className="rounded-xl border border-neutral-200 p-3">
                        <label className="block text-sm font-semibold text-neutral-900">사진 {index + 1} (필수)</label>
                        <div className="mt-2 flex h-48 items-center justify-center overflow-hidden rounded-xl bg-neutral-50 text-center text-xs font-semibold text-neutral-500">
                          {selectedPreview || existingPreview ? (
                            previewFailed[index] ? (
                              <span className="px-3">{selectedPreview ? "파일은 선택됐어요. 미리보기 없이도 등록할 수 있습니다." : "기존 사진 미리보기를 불러오지 못했습니다."}</span>
                            ) : (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img
                                src={selectedPreview ?? existingPreview}
                                alt={`유료카드 사진 ${index + 1} 미리보기`}
                                decoding="async"
                                className="h-full w-full object-contain"
                                onError={() => setPreviewFailed((prev) => index === 0 ? [true, prev[1] ?? false] : [prev[0] ?? false, true])}
                              />
                            )
                          ) : (
                            <span>선택한 사진이 여기에 표시됩니다.</span>
                          )}
                        </div>
                        <input
                          className="mt-3 block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={(e) => {
                            handlePhotoChange(index, e.target.files?.[0] ?? null);
                            if (isEditMode) e.currentTarget.value = "";
                          }}
                        />
                        {isEditMode && (
                          <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                            <span className="font-medium text-neutral-500">{selectedPreview ? "새 사진 미리보기" : "기존 사진 유지"}</span>
                            {photos[index] && <button type="button" onClick={() => handlePhotoChange(index, null)} className="font-semibold text-rose-600 underline">변경 취소</button>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {isEditMode && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">새 사진을 선택하지 않은 칸은 화면에 보이는 기존 사진 그대로 유지됩니다.</p>}
                <p className="text-xs leading-5 text-neutral-500">JPG, PNG, WebP 파일을 장당 12MB 이하로 올려주세요.</p>
              </div>
            )}

            {formStep === 4 && (
              <div className="space-y-3">
                <div className="rounded-xl border border-neutral-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-bold text-neutral-900">노출·기본 정보</h3>
                    <button type="button" onClick={() => moveToFormStep(1)} className="text-xs font-semibold text-rose-600">수정</button>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-neutral-700">
                    {gender === "M" ? "남자" : "여자"} · {displayMode === "priority_24h" ? DATING_PAID_FIXED_LABEL : "대기 없이 등록"}
                    <br />
                    {age || "나이 미입력"}세 · {region || "지역 미입력"} · {heightCm || "키 미입력"}{heightCm ? "cm" : ""}
                    <br />
                    {job || "직업 미입력"} · 운동 {trainingYears || "0"}년
                  </p>
                </div>

                <div className="rounded-xl border border-neutral-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-bold text-neutral-900">소개·인스타그램</h3>
                    <button type="button" onClick={() => moveToFormStep(2)} className="text-xs font-semibold text-rose-600">수정</button>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-700">{strengthsText || "장점 미입력"}</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-500">{idealText || "원하는 상대 미입력"}</p>
                  <p className="mt-2 text-sm font-medium text-neutral-800">@{normalizeInstagramId(instagramId)}</p>
                </div>

                <div className="rounded-xl border border-neutral-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-bold text-neutral-900">사진 2장</h3>
                    <button type="button" onClick={() => moveToFormStep(3)} className="text-xs font-semibold text-rose-600">수정</button>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {([0, 1] as const).map((index) => (
                      <div key={index} className="flex h-32 items-center justify-center overflow-hidden rounded-xl bg-neutral-50 text-xs font-medium text-neutral-500">
                        {previewUrls[index] || existingPreviewUrls[index] ? (
                          previewFailed[index] ? (
                            <span className="px-2 text-center">사진 {index + 1} 선택 완료</span>
                          ) : (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={previewUrls[index] ?? existingPreviewUrls[index]} alt={`최종 확인 사진 ${index + 1}`} className="h-full w-full object-cover" />
                          )
                        ) : (
                          <span>사진 {index + 1} 없음</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-neutral-500">{photoVisibility === "public" ? "사진 공개" : "사진 블러 공개"}</p>
                </div>

                <div className="rounded-xl bg-neutral-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-neutral-900">{isEditMode ? "수정 내용 저장" : "대기 없이 등록"}</p>
                      <p className="mt-1 text-xs leading-5 text-neutral-500">
                        {isEditMode ? "기존 결제와 노출 시간은 유지됩니다." : "결제 확인 후 카드가 등록되거나 노출됩니다."}
                      </p>
                    </div>
                    <strong className="shrink-0 text-lg text-neutral-900">{isEditMode ? "추가 결제 없음" : "10,000원"}</strong>
                  </div>
                </div>
              </div>
            )}

            {error && <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600">{error}</p>}

            <div className="mt-6 flex gap-2">
              {formStep > 1 && (
                <button type="button" onClick={() => moveToFormStep(formStep - 1)} disabled={submitting} className="h-11 min-w-24 rounded-xl border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-700 disabled:opacity-50">
                  이전
                </button>
              )}
              {formStep < PAID_FORM_STEPS.length ? (
                <button type="button" onClick={handleNextFormStep} disabled={editLoading || sourcePrefillLoading} className="h-11 flex-1 rounded-xl bg-neutral-900 px-4 text-sm font-semibold text-white disabled:opacity-50">
                  다음
                </button>
              ) : (
                <button type="submit" disabled={submitting || editLoading || sourcePrefillLoading} className="h-11 flex-1 rounded-xl bg-rose-500 px-4 text-sm font-semibold text-white hover:bg-rose-600 disabled:opacity-50">
                  {submitting && submitMode === "kakaopay" ? "처리 중..." : isEditMode ? "수정 저장" : "10,000원 결제하고 등록"}
                </button>
              )}
            </div>

            {formStep === PAID_FORM_STEPS.length && !isEditMode && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-200 px-3 py-2 text-xs text-neutral-500">
                <span>온라인 결제가 어려우면 수동 신청도 가능해요.</span>
                <button type="button" onClick={() => void submitPaidRequest("manual")} disabled={submitting || editLoading} className="min-h-9 rounded-lg border border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 disabled:opacity-50">
                  {submitting && submitMode === "manual" ? "신청 접수 중..." : "수동 신청"}
                </button>
              </div>
            )}
            {formStep === PAID_FORM_STEPS.length && isEditMode && editingPaidCardStatus === "approved" && (
              <p className="mt-3 text-xs font-medium text-emerald-700">결제 완료된 카드의 내용만 수정하며 추가 결제는 진행되지 않습니다.</p>
            )}
          </form>

          {successId && (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              <p className="font-semibold">{successWasEdit ? "유료카드가 수정되었습니다." : "신청이 접수되었습니다."}</p>
              <p className="mt-1">신청ID: {successId}</p>
              <p className="mt-1">
                {successWasEdit
                  ? "기존 결제 상태와 노출 시간은 유지됩니다. 추가 결제는 진행되지 않습니다."
                  : "결제는 오픈카톡에서 진행됩니다. 오픈카톡으로 \"닉네임 + 신청ID\"를 보내주세요."}
              </p>
              {!successWasEdit && (
                <a href={openKakaoUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-emerald-700">
                  오픈카톡 이동
                </a>
              )}
            </div>
          )}
        </section>
      )}

      <section className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-900">상품 및 결제 안내</h2>
        <div className="mt-3 rounded-xl bg-neutral-50 p-3 text-sm text-neutral-700">
          <p className="font-medium text-neutral-900">기본 정보</p>
          <ul className="mt-2 space-y-1 text-xs leading-5 text-neutral-600">
            <li>상품명: 오픈카드 대기 없이 등록</li>
            <li>금액: 10,000원</li>
            <li>진행 방식: 신청 접수 후 결제 확인, 이후 카드 등록 또는 노출 처리</li>
            <li>문의: gymtools.kr@gmail.com / 010-8693-0657</li>
          </ul>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-900">환불 기준</h2>
        <div className="mt-3 rounded-xl bg-neutral-50 p-3 text-sm text-neutral-700">
          <ul className="space-y-1 text-xs leading-5 text-neutral-600">
            <li>서비스 제공 전에는 운영 확인 후 환불 검토가 가능합니다.</li>
            <li>카드 등록, 승인, 노출이 시작된 뒤에는 환불이 제한될 수 있습니다.</li>
            <li>상세 기준은 하단 환불/취소 규정을 따릅니다.</li>
          </ul>
        </div>
      </section>

      <section className="mt-5">
        <h2 className="text-lg font-bold text-neutral-900">확인된 36시간 고정</h2>
        {loading ? (
          <p className="mt-2 text-sm text-neutral-500">불러오는 중...</p>
        ) : fixedItems.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">현재 공개 중인 고정 카드가 없습니다.</p>
        ) : (
          <div className="mt-3 space-y-6">
            <GenderSection title="남자 36시간 고정" items={maleItems} />
            <GenderSection title="여자 36시간 고정" items={femaleItems} />
          </div>
        )}
      </section>

      <PaidPolicyNotice />

      <style jsx>{`
        .input {
          min-height: 44px;
          width: 100%;
          border: 1px solid #d4d4d8;
          border-radius: 0.75rem;
          padding: 0 0.75rem;
          background: #fff;
          color: #171717;
        }
        .input::placeholder {
          color: #737373;
        }
        textarea {
          background: #fff;
          color: #171717;
        }
        textarea::placeholder {
          color: #737373;
        }
      `}</style>
    </main>
  );
}

function GenderSection({ title, items }: { title: string; items: PaidItem[] }) {
  return (
    <section>
      <h3 className="mb-2 text-base font-semibold text-neutral-800">{title}</h3>
      {items.length === 0 ? (
        <p className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-500">현재 노출 중인 카드가 없습니다.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {items.map((item) => (
            <article key={item.id} className="rounded-2xl border border-neutral-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-neutral-900">{item.nickname}</p>
                  <PhoneVerifiedBadge verified={item.is_phone_verified} />
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      item.display_mode === "instant_public" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                    }`}
                  >
                    {item.display_mode === "instant_public" ? "대기 없이 등록" : DATING_PAID_FIXED_SHORT_LABEL}
                  </span>
                </div>
                {item.expires_at ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{formatRemainingToKorean(item.expires_at)}</span>
                ) : null}
              </div>
              {item.thumbUrl ? (
                <div className="relative mt-2 flex h-44 items-center justify-center overflow-hidden rounded-xl border border-neutral-100 bg-neutral-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.thumbUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover opacity-30 blur-sm"
                  />
                  {item.photo_visibility === "public" && Array.isArray(item.image_urls) && item.image_urls.length >= 2 ? (
                    <div className="relative z-10 grid h-full w-full grid-cols-2 gap-1 p-1">
                      {item.image_urls.slice(0, 2).map((url, index) => (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img key={`${item.id}-list-photo-${index}`} src={url} alt="" loading="lazy" decoding="async" className="h-full w-full object-contain object-center" />
                      ))}
                    </div>
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={item.thumbUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className={`relative z-10 max-h-full max-w-full h-auto w-auto object-contain object-center ${item.photo_visibility === "public" ? "" : "blur-[9px]"}`}
                    />
                  )}
                </div>
              ) : (
                <div className="mt-2 h-44 rounded-xl border border-neutral-100 bg-neutral-50" />
              )}
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-600">
                {item.age != null && <span>{item.age}세</span>}
                {item.region && <span>{item.region}</span>}
                {item.height_cm != null && <span>{item.height_cm}cm</span>}
                {item.job && <span>{item.job}</span>}
                {item.training_years != null && <span>운동 {item.training_years}년</span>}
                {item.gender === "M" && item.is_3lift_verified && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">3대인증 완료</span>
                )}
              </div>
              {item.strengths_text && <p className="mt-2 text-sm text-emerald-700">내 장점: {item.strengths_text}</p>}
              {item.ideal_text && <p className="mt-1 text-sm text-rose-700">💘 이상형: {item.ideal_text}</p>}
              {item.intro_text && <p className="mt-1 text-sm text-neutral-700 whitespace-pre-wrap break-words">{item.intro_text}</p>}
              <div className="mt-3 flex items-center gap-2">
                <Link
                  href={`/dating/paid/${item.id}`}
                  className="inline-flex min-h-[40px] items-center rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  상세보기
                </Link>
                <Link
                  href={`/dating/paid/${item.id}/apply`}
                  className="inline-flex min-h-[40px] items-center rounded-lg bg-pink-500 px-4 text-sm font-medium text-white hover:bg-pink-600"
                >
                  지원하기
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
