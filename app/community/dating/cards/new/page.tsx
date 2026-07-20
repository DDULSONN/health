"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const UNSUPPORTED_IPHONE_PHOTO_TYPES = ["image/heic", "image/heif"];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

type MyCardItem = {
  id: string;
  sex: "male" | "female";
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  ideal_type: string | null;
  strengths_text: string | null;
  photo_visibility: "blur" | "public";
  instagram_id: string | null;
  photo_paths: string[] | null;
  photo_preview_urls?: string[] | null;
  blur_thumb_path: string | null;
  blur_paths: string[] | null;
  total_3lift: number | null;
  status: "pending" | "public" | "expired" | "hidden";
};

const FORM_STEPS = [
  { title: "기본 정보", description: "나를 보여줄 기본 프로필을 입력해주세요." },
  { title: "소개", description: "상대가 궁금해할 내용을 편하게 적어주세요." },
  { title: "사진", description: "등록될 사진 2장을 미리 확인해주세요." },
  { title: "최종 확인", description: "공개될 내용을 확인하고 등록해주세요." },
] as const;

function normalizeInstagramId(value: string) {
  return value.trim().replace(/^@+/, "").replace(/\s+/g, "").slice(0, 30);
}

function isUnsupportedIphonePhoto(file: File) {
  const name = file.name.toLowerCase();
  return (
    UNSUPPORTED_IPHONE_PHOTO_TYPES.includes(file.type.toLowerCase()) ||
    name.endsWith(".heic") ||
    name.endsWith(".heif")
  );
}

function photoFixMessage(slot: number) {
  return `${slot}번 사진 형식을 읽지 못했어요. 캡쳐본으로 다시 올려주세요.`;
}

async function createBlurThumbnailFile(source: File): Promise<File> {
  const imageUrl = URL.createObjectURL(source);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("이미지 로드 실패"));
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
    if (!ctx) throw new Error("canvas context 없음");

    ctx.filter = "blur(9px)";
    ctx.drawImage(img, 0, 0, width, height);
    ctx.filter = "none";

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error("블러 썸네일 생성 실패"));
      }, "image/jpeg", 0.82);
    });

    return new File([blob], "blur_thumb.jpg", { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

async function createLiteFile(source: File): Promise<File> {
  const imageUrl = URL.createObjectURL(source);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("이미지 로드 실패"));
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
    if (!ctx) throw new Error("canvas context 없음");
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error("lite 이미지 생성 실패"));
      }, "image/webp", 0.78);
    });

    return new File([blob], "lite.webp", { type: "image/webp" });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export default function NewDatingCardPage() {
  const router = useRouter();
  const [editId, setEditId] = useState("");
  const isEditMode = editId.length > 0;
  const [writeEnabled, setWriteEnabled] = useState(true);
  const [writeSettingLoading, setWriteSettingLoading] = useState(true);
  const [editLoading, setEditLoading] = useState(false);
  const [sex, setSex] = useState<"male" | "female">("male");
  const [age, setAge] = useState("");
  const [region, setRegion] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [job, setJob] = useState("");
  const [trainingYears, setTrainingYears] = useState("");
  const [idealType, setIdealType] = useState("");
  const [strengthsText, setStrengthsText] = useState("");
  const [instagramId, setInstagramId] = useState("");
  const [photoVisibility, setPhotoVisibility] = useState<"blur" | "public">("blur");
  const [total3Lift, setTotal3Lift] = useState("");
  const [photos, setPhotos] = useState<(File | null)[]>([null, null]);
  const [previewUrls, setPreviewUrls] = useState<(string | null)[]>([null, null]);
  const [existingRawPaths, setExistingRawPaths] = useState<string[]>([]);
  const [existingPreviewUrls, setExistingPreviewUrls] = useState<string[]>([]);
  const [existingBlurPaths, setExistingBlurPaths] = useState<string[]>([]);
  const [existingBlurThumbPath, setExistingBlurThumbPath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [formStep, setFormStep] = useState(1);

  useEffect(() => {
    queueMicrotask(async () => {
      try {
        const res = await fetch("/api/dating/cards/write-enabled", { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as { enabled?: boolean };
        setWriteEnabled(body.enabled !== false);
      } catch {
        setWriteEnabled(true);
      } finally {
        setWriteSettingLoading(false);
      }
    });
  }, []);

  useEffect(() => {
    const urls = photos.map((file) => (file ? URL.createObjectURL(file) : null));
    setPreviewUrls(urls);

    return () => {
      urls.forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, [photos]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextId = new URLSearchParams(window.location.search).get("editId") ?? "";
    setEditId(nextId);
  }, []);

  useEffect(() => {
    if (!isEditMode || !editId) return;
    let cancelled = false;
    setEditLoading(true);
    queueMicrotask(async () => {
      try {
        const res = await fetch("/api/dating/cards/my", { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as { items?: MyCardItem[]; error?: string };
        if (!res.ok) {
          if (!cancelled) setError(body.error ?? "수정할 카드를 불러오지 못했습니다.");
          return;
        }
        const item = (body.items ?? []).find((card) => card.id === editId);
        if (!item || !["pending", "hidden", "expired"].includes(item.status)) {
          if (!cancelled) setError("대기중이거나 내려간 오픈카드만 수정할 수 있습니다.");
          return;
        }
        if (cancelled) return;
        setSex(item.sex);
        setAge(item.age != null ? String(item.age) : "");
        setRegion(item.region ?? "");
        setHeightCm(item.height_cm != null ? String(item.height_cm) : "");
        setJob(item.job ?? "");
        setTrainingYears(item.training_years != null ? String(item.training_years) : "");
        setIdealType(item.ideal_type ?? "");
        setStrengthsText(item.strengths_text ?? "");
        setPhotoVisibility(item.photo_visibility === "public" ? "public" : "blur");
        setInstagramId(item.instagram_id ?? "");
        setTotal3Lift(item.total_3lift != null ? String(item.total_3lift) : "");
        setExistingRawPaths(Array.isArray(item.photo_paths) ? item.photo_paths : []);
        setExistingPreviewUrls(Array.isArray(item.photo_preview_urls) ? item.photo_preview_urls : []);
        setExistingBlurPaths(Array.isArray(item.blur_paths) ? item.blur_paths : []);
        setExistingBlurThumbPath(item.blur_thumb_path ?? "");
      } catch {
        if (!cancelled) setError("수정할 카드를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setEditLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [editId, isEditMode]);

  const readErrorMessage = async (res: Response, fallback: string) => {
    const text = await res.text().catch(() => "");
    if (!text) return `${fallback} (HTTP ${res.status})`;
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      if (parsed.error) return parsed.error;
      if (parsed.message) return parsed.message;
    } catch {
      // not json
    }
    return `${fallback} (HTTP ${res.status}) ${text.slice(0, 180)}`;
  };

  const moveToStep = (step: number) => {
    setError("");
    setFormStep(Math.min(FORM_STEPS.length, Math.max(1, step)));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const validateStep = (step: number) => {
    if (step === 1) {
      const ageValue = age ? Number(age) : null;
      const heightValue = heightCm ? Number(heightCm) : null;
      const trainingValue = trainingYears ? Number(trainingYears) : null;
      if (ageValue != null && (ageValue < 19 || ageValue > 99)) return "나이는 19세부터 99세까지 입력해주세요.";
      if (heightValue != null && (heightValue < 120 || heightValue > 230)) return "키는 120cm부터 230cm까지 입력해주세요.";
      if (trainingValue != null && (trainingValue < 0 || trainingValue > 50)) return "운동 경력은 0년부터 50년까지 입력해주세요.";
    }
    if (step === 2) {
      const normalizedInstagram = normalizeInstagramId(instagramId);
      if (!normalizedInstagram) return "인스타그램 아이디를 입력해주세요.";
      if (!/^[A-Za-z0-9._]{1,30}$/.test(normalizedInstagram)) return "인스타그램 아이디는 영문, 숫자, 마침표, 밑줄만 입력할 수 있어요.";
    }
    if (step === 3) {
      const hasPhotoSlot0 = Boolean(photos[0]) || Boolean(existingRawPaths[0]);
      const hasPhotoSlot1 = Boolean(photos[1]) || Boolean(existingRawPaths[1]);
      if (!hasPhotoSlot0 || !hasPhotoSlot1) return "오픈카드 사진은 2장 모두 필요합니다.";
      for (const photo of photos.filter((item): item is File => Boolean(item))) {
        if (isUnsupportedIphonePhoto(photo)) return "iPhone 사진 형식은 어려워요. 캡쳐본으로 다시 올려주세요.";
        if (!ALLOWED_TYPES.includes(photo.type)) return "사진은 JPG/PNG/WebP만 가능해요. 캡쳐본으로 다시 올려주세요.";
        if (photo.size > MAX_FILE_SIZE) return "사진은 장당 10MB 이하만 가능합니다.";
      }
    }
    return "";
  };

  const handleNextStep = () => {
    const message = validateStep(formStep);
    if (message) {
      setError(message);
      return;
    }
    moveToStep(formStep + 1);
  };

  const setPhotoSlot = (slot: number, file: File | null) => {
    setPhotos((current) => current.map((item, index) => (index === slot ? file : item)));
    setError("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    for (let step = 1; step <= 3; step += 1) {
      const message = validateStep(step);
      if (message) {
        setFormStep(step);
        setError(message);
        return;
      }
    }

    if (!writeEnabled) {
      setError("현재 오픈카드 작성이 일시 중단되었습니다.");
      return;
    }

    const hasPhotoSlot0 = Boolean(photos[0]) || Boolean(existingRawPaths[0]);
    const hasPhotoSlot1 = Boolean(photos[1]) || Boolean(existingRawPaths[1]);
    if (!hasPhotoSlot0 || !hasPhotoSlot1) {
      setError("오픈카드 사진은 2장 모두 필요합니다.");
      return;
    }

    for (const photo of photos.filter((p): p is File => Boolean(p))) {
      if (isUnsupportedIphonePhoto(photo)) {
        setError("iPhone 사진 형식은 어려워요. 캡쳐본으로 다시 올려주세요.");
        return;
      }
      if (!ALLOWED_TYPES.includes(photo.type)) {
        setError("사진은 JPG/PNG/WebP만 가능해요. 캡쳐본으로 다시 올려주세요.");
        return;
      }
      if (photo.size > MAX_FILE_SIZE) {
        setError("사진은 장당 10MB 이하만 가능합니다.");
        return;
      }
    }

    setSubmitting(true);

    try {
      const nextRawPaths = [...existingRawPaths];
      const nextBlurPaths = [...existingBlurPaths];
      let nextBlurThumbPath = existingBlurThumbPath;

      for (let i = 0; i < 2; i++) {
        const photo = photos[i];
        if (!photo) continue;

        const assetId = crypto.randomUUID();
        const fd = new FormData();
        fd.append("file", photo);
        fd.append("kind", "raw");
        fd.append("asset_id", assetId);
        fd.append("index", String(i));
        const res = await fetch("/api/dating/cards/upload-card", { method: "POST", body: fd });
        if (!res.ok) {
          setError(await readErrorMessage(res, "카드 사진 업로드에 실패했습니다."));
          setSubmitting(false);
          return;
        }
        const body = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
        if (!body.path) {
          setError("카드 사진 업로드 응답이 올바르지 않습니다.");
          setSubmitting(false);
          return;
        }
        nextRawPaths[i] = body.path;

        let liteFile: File;
        try {
          liteFile = await createLiteFile(photo);
        } catch {
          setError(photoFixMessage(i + 1));
          setSubmitting(false);
          return;
        }
        const liteFd = new FormData();
        liteFd.append("file", liteFile);
        liteFd.append("kind", "lite");
        liteFd.append("asset_id", assetId);
        liteFd.append("index", String(i));
        const liteRes = await fetch("/api/dating/cards/upload-card", { method: "POST", body: liteFd });
        if (!liteRes.ok) {
          setError(await readErrorMessage(liteRes, "라이트 이미지 업로드에 실패했습니다."));
          setSubmitting(false);
          return;
        }

        let blurFile: File;
        try {
          blurFile = await createBlurThumbnailFile(photo);
        } catch {
          setError(photoFixMessage(i + 1));
          setSubmitting(false);
          return;
        }
        const blurFd = new FormData();
        blurFd.append("file", blurFile);
        blurFd.append("kind", "blur");
        blurFd.append("index", String(i));
        const blurRes = await fetch("/api/dating/cards/upload-card", { method: "POST", body: blurFd });
        if (!blurRes.ok) {
          setError(await readErrorMessage(blurRes, "블러 썸네일 업로드에 실패했습니다."));
          setSubmitting(false);
          return;
        }
        const blurBody = (await blurRes.json().catch(() => ({}))) as { path?: string; error?: string };
        if (!blurBody.path) {
          setError("블러 썸네일 업로드 응답이 올바르지 않습니다.");
          setSubmitting(false);
          return;
        }
        nextBlurPaths[i] = blurBody.path;
        if (i === 0) nextBlurThumbPath = blurBody.path;
      }

      if (nextRawPaths.length < 2 || !nextRawPaths[0] || !nextRawPaths[1]) {
        setError("오픈카드 사진은 2장 모두 필요합니다.");
        setSubmitting(false);
        return;
      }
      if (nextBlurPaths.length < 2 || !nextBlurPaths[0] || !nextBlurPaths[1] || !nextBlurThumbPath) {
        setError("블러 이미지 2장 생성에 실패했습니다. 다시 시도해주세요.");
        setSubmitting(false);
        return;
      }

      const payload = {
        ...(isEditMode ? { id: editId } : {}),
        sex,
        age: age ? Number(age) : null,
        region: region.trim(),
        height_cm: heightCm ? Number(heightCm) : null,
        job: job.trim(),
        training_years: trainingYears ? Number(trainingYears) : null,
        ideal_type: idealType.trim(),
        strengths_text: strengthsText.trim(),
        photo_visibility: photoVisibility,
        instagram_id: normalizeInstagramId(instagramId),
        photo_paths: nextRawPaths,
        blur_thumb_path: nextBlurThumbPath,
        blur_paths: nextBlurPaths,
        total_3lift: total3Lift ? Number(total3Lift) : null,
      };

      const res = await fetch("/api/dating/cards/my", {
        method: isEditMode ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const message = await readErrorMessage(res, "오픈카드 생성에 실패했습니다.");
        setError(message);
        setSubmitting(false);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };

      alert(body.message ?? (isEditMode ? "오픈카드를 수정했습니다." : "오픈카드를 생성했습니다."));
      router.push("/mypage");
    } catch {
      setError("업로드 중 오류가 났어요. 캡쳐본으로 다시 올려주세요.");
    }

    setSubmitting(false);
  };

  return (
    <main className="max-w-lg mx-auto px-4 py-8">
      <Link href="/community/dating/cards" className="text-sm text-neutral-500 hover:text-neutral-700">
        뒤로가기
      </Link>

      <h1 className="text-2xl font-black text-neutral-950 mt-3">{isEditMode ? "오픈카드 수정" : "오픈카드 작성"}</h1>
      {isEditMode && <p className="text-sm text-amber-700 mt-1">대기중 오픈카드 수정 모드</p>}
      <p className="text-sm text-neutral-500 mt-1">한 단계씩 작성하고, 등록 전 사진과 내용을 확인할 수 있어요.</p>
      {!writeSettingLoading && !writeEnabled && (
        <p className="mt-2 text-sm font-medium text-red-600">현재 오픈카드 작성이 일시 중단되었습니다.</p>
      )}

      <section className="mt-6 rounded-2xl border border-neutral-200 bg-white px-4 py-5 shadow-sm">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black text-rose-500">{formStep} / {FORM_STEPS.length}</p>
            <h2 className="mt-1 text-xl font-black text-neutral-950">{FORM_STEPS[formStep - 1]?.title}</h2>
            <p className="mt-1 text-sm text-neutral-500">{FORM_STEPS[formStep - 1]?.description}</p>
          </div>
          <span className="text-xs font-bold text-neutral-400">{Math.round((formStep / FORM_STEPS.length) * 100)}%</span>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-1.5" aria-label={`오픈카드 ${formStep}단계`}>
          {FORM_STEPS.map((step, index) => (
            <div key={step.title} className={`h-1.5 rounded-full ${index < formStep ? "bg-rose-500" : "bg-neutral-100"}`} />
          ))}
        </div>
      </section>

      <form onSubmit={submit} noValidate className="mt-4 rounded-2xl border border-neutral-200 bg-white px-4 py-5 shadow-sm">
        {editLoading && <p className="text-sm text-neutral-500">기존 카드 정보를 불러오는 중...</p>}
        {formStep === 1 && <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">성별 *</label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setSex("male")} className={`h-12 rounded-xl border text-sm font-black ${sex === "male" ? "bg-neutral-950 text-white border-neutral-950" : "bg-white text-neutral-600 border-neutral-200"}`}>
              남자
            </button>
            <button type="button" onClick={() => setSex("female")} className={`h-12 rounded-xl border text-sm font-black ${sex === "female" ? "bg-neutral-950 text-white border-neutral-950" : "bg-white text-neutral-600 border-neutral-200"}`}>
              여자
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="나이"><input className="input" type="number" min={19} max={99} placeholder="예: 29" value={age} onChange={(e) => setAge(e.target.value)} /></Field>
          <Field label="키(cm)"><input className="input" type="number" min={120} max={230} placeholder="예: 175" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} /></Field>
        </div>
        <Field label="지역"><input className="input" maxLength={30} placeholder="예: 서울 강남구" value={region} onChange={(e) => setRegion(e.target.value)} /></Field>
        <Field label="직업"><input className="input" maxLength={50} placeholder="예: 회사원" value={job} onChange={(e) => setJob(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="운동경력(년)"><input className="input" type="number" min={0} max={50} placeholder="예: 3" value={trainingYears} onChange={(e) => setTrainingYears(e.target.value)} /></Field>
          <Field label="3대 합계(kg)"><input className="input" type="number" min={0} placeholder="선택" value={total3Lift} onChange={(e) => setTotal3Lift(e.target.value)} /></Field>
        </div>
        </div>}

        {formStep === 2 && <div className="space-y-5">
        <Field label="내 장점">
          <textarea className="textarea" maxLength={150} rows={4} placeholder="성격, 취미, 생활 방식처럼 나를 자연스럽게 소개해주세요." value={strengthsText} onChange={(e) => setStrengthsText(e.target.value)} />
          <p className="mt-1.5 text-right text-xs text-neutral-400">{strengthsText.length}/150</p>
        </Field>
        <Field label="이상형">
          <textarea className="textarea" maxLength={1000} rows={5} placeholder="어떤 사람을 만나고 싶은지 편하게 적어주세요." value={idealType} onChange={(e) => setIdealType(e.target.value)} />
          <p className="mt-1.5 text-right text-xs text-neutral-400">{idealType.length}/1000</p>
        </Field>
        <Field label="인스타그램 아이디" required><input className="input" maxLength={30} placeholder="@ 없이 입력" value={instagramId} onChange={(e) => setInstagramId(normalizeInstagramId(e.target.value))} /></Field>
        <p className="rounded-xl bg-neutral-50 px-3 py-3 text-xs leading-5 text-neutral-500">서로 수락된 뒤 상대에게 공개됩니다. 영문, 숫자, 마침표, 밑줄만 입력할 수 있어요.</p>
        </div>}

        {formStep === 3 && <div className="space-y-5">
        <label className="flex items-start gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={photoVisibility === "public"}
            onChange={(e) => setPhotoVisibility(e.target.checked ? "public" : "blur")}
            className="mt-1"
          />
          <span>
            사진을 블러 없이 공개합니다.
            <span className="block text-xs text-neutral-500 mt-1">체크 시 공개 목록/상세에 원본 사진 2장이 표시됩니다.</span>
          </span>
        </label>

        <div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-black text-neutral-900">오픈카드 사진 2장</p>
            <span className="text-xs font-bold text-neutral-400">{isEditMode && photos.every((photo) => !photo) ? "기존 사진 유지" : `${photos.filter(Boolean).length}장 변경`}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-neutral-500">선택한 사진이 실제 카드에 들어갈 모습으로 바로 표시됩니다.</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {[0, 1].map((slot) => {
              const previewUrl = previewUrls[slot] ?? existingPreviewUrls[slot] ?? null;
              const isNew = Boolean(previewUrls[slot]);
              return (
                <label key={slot} className="relative flex aspect-[4/5] cursor-pointer overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50">
                  {previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previewUrl} alt={`사진 ${slot + 1} 미리보기`} decoding="async" className="h-full w-full object-contain" />
                  ) : (
                    <span className="m-auto text-center text-sm font-black text-neutral-500"><span className="block text-2xl">+</span><span className="mt-2 block">사진 {slot + 1} 선택</span></span>
                  )}
                  <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-1 text-[11px] font-black text-white">{isNew ? "새 사진" : previewUrl ? "기존 사진" : `사진 ${slot + 1}`}</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { setPhotoSlot(slot, e.target.files?.[0] ?? null); e.currentTarget.value = ""; }} className="sr-only" />
                </label>
              );
            })}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {[0, 1].map((slot) => photos[slot] ? (
              <button key={slot} type="button" onClick={() => setPhotoSlot(slot, null)} className="text-xs font-black text-neutral-500 underline">사진 {slot + 1} 변경 취소</button>
            ) : <span key={slot} />)}
          </div>
          {isEditMode && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">새 사진을 선택하지 않은 칸은 화면에 보이는 기존 사진 그대로 유지됩니다.</p>}
          <p className="mt-3 text-xs leading-5 text-neutral-500">JPG, PNG, WebP / 사진당 10MB 이하. HEIC 사진은 캡처 후 올려주세요.</p>
        </div>
        </div>}

        {formStep === 4 && <div className="space-y-5">
          <div className="divide-y divide-neutral-100 rounded-2xl border border-neutral-200">
            {[
              { step: 1, label: "기본 정보", value: `${sex === "male" ? "남자" : "여자"}${age ? ` · ${age}세` : ""}${region ? ` · ${region}` : ""}${heightCm ? ` · ${heightCm}cm` : ""}${job ? ` · ${job}` : ""}` },
              { step: 2, label: "소개", value: `${strengthsText || "입력 없음"}${idealType ? `\n이상형: ${idealType}` : ""}\n인스타그램: @${normalizeInstagramId(instagramId)}` },
              { step: 3, label: "사진", value: isEditMode && photos.every((photo) => !photo) ? "기존 사진 2장 유지" : `사진 2장 확인 완료 · ${photoVisibility === "public" ? "블러 없이 공개" : "블러로 공개"}` },
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
          <p className="rounded-xl bg-neutral-50 px-3 py-3 text-xs leading-5 text-neutral-500">공개 카드 슬롯 상황에 따라 즉시 공개되거나 대기열에 등록됩니다. 등록 상태는 마이페이지에서 확인할 수 있어요.</p>
        </div>}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="mt-7 flex gap-2">
          {formStep > 1 && <button type="button" onClick={() => moveToStep(formStep - 1)} disabled={submitting} className="h-14 min-w-24 rounded-full border border-neutral-200 bg-white px-5 text-sm font-black text-neutral-700 disabled:opacity-50">이전</button>}
          {formStep < FORM_STEPS.length ? (
            <button type="button" onClick={handleNextStep} disabled={editLoading} className="h-14 flex-1 rounded-full bg-neutral-950 px-5 text-base font-black text-white disabled:opacity-50">다음</button>
          ) : (
            <button type="submit" disabled={submitting || editLoading || (!isEditMode && (writeSettingLoading || !writeEnabled))} className="h-14 flex-1 rounded-full bg-rose-500 px-5 text-base font-black text-white shadow-lg shadow-rose-100 disabled:opacity-50">
              {submitting ? "처리 중..." : isEditMode ? "수정 저장" : "오픈카드 등록"}
            </button>
          )}
        </div>
      </form>

      <style jsx>{`
        .input {
          width: 100%;
          min-height: 44px;
          border: 1px solid #d4d4d8;
          border-radius: 0.75rem;
          padding: 0 0.75rem;
          background: white;
          color: #171717;
        }
        .textarea {
          width: 100%;
          resize: none;
          border: 1px solid #e5e5e5;
          border-radius: 1rem;
          padding: 0.875rem 1rem;
          background: #fafafa;
          color: #171717;
          line-height: 1.5;
        }
        .textarea:focus {
          border-color: #fda4af;
          background: white;
          outline: none;
        }
        .input::placeholder {
          color: #737373;
        }
      `}</style>
    </main>
  );
}

function Field({ label, children, required = false }: { label: string; children: ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700 mb-1">
        {label} {required ? "*" : ""}
      </label>
      {children}
    </div>
  );
}
