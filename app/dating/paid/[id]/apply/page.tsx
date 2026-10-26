"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ApplicationCompleteNotice from "@/components/dating/ApplicationCompleteNotice";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatRemainingToKorean } from "@/lib/dating-open";
import { paidApplicationPrefill } from "@/lib/paid-application-prefill";
import { importOwnOpenCardPhoto } from "@/lib/dating-open-card-photo-import";
import { DATING_PHOTO_ACCEPT, DATING_PHOTO_UPLOAD_MAX_BYTES, HEIC_HELP } from "@/lib/dating-photo-preparation";
import { useDatingPhotoPreparation } from "@/lib/use-dating-photo-preparation";

type PaidCardDetail = {
  id: string;
  nickname: string;
  gender: "M" | "F";
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  strengths_text: string | null;
  ideal_text: string | null;
  intro_text: string | null;
  expires_at: string;
  image_urls: string[];
  photo_visibility: "blur" | "public";
};

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 12 * 1024 * 1024;

function normalizeInstagramId(value: string) {
  return value.trim().replace(/^@+/, "").replace(/\s+/g, "").slice(0, 30);
}

function validInstagramId(value: string) {
  return /^[A-Za-z0-9._]{1,30}$/.test(value);
}

export default function PaidCardApplyPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [card, setCard] = useState<PaidCardDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState("");
  const [profileEditUrl, setProfileEditUrl] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const importRequest = useRef<AbortController | null>(null);
  const submitLock = useRef(false);
  const photoPreparation = useDatingPhotoPreparation(MAX_FILE_SIZE);

  const [age, setAge] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [region, setRegion] = useState("");
  const [job, setJob] = useState("");
  const [trainingYears, setTrainingYears] = useState("");
  const [introText, setIntroText] = useState("");
  const [instagramId, setInstagramId] = useState("");
  const [consent, setConsent] = useState(false);
  const [photos, setPhotos] = useState<(File | null)[]>([null, null]);

  useEffect(() => () => { importRequest.current?.abort(); importRequest.current = null; }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    queueMicrotask(async () => {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (!active) return;
        if (authError) throw authError;
        if (!user) {
          router.replace(`/login?redirect=/dating/paid/${id}/apply`);
          return;
        }
        const res = await fetch(`/api/dating/paid/${id}`, { cache: "no-store", signal: controller.signal });
        if (!active) return;
        if (!res.ok) {
          if (res.status === 404 || res.status === 410) { router.replace("/community/dating/cards?tab=open_cards"); return; }
          throw new Error("CARD_UNAVAILABLE");
        }
        const data = (await res.json()) as { card?: PaidCardDetail };
        if (!active) return;
        if (!data.card) {
          throw new Error("CARD_UNAVAILABLE");
        }
        setCard(data.card);
      } catch {
        if (active) setLoadError(true);
      }
      if (active) setLoading(false);
    });
    return () => { active = false; controller.abort(); };
  }, [id, router, supabase]);

  const handlePhotoChange = (index: number, file: File | null) => {
    if (!file) return;
    setConsent(false);
    void photoPreparation.select(index, file, prepared => {
      setPhotos(current => current.map((photo, slot) => slot === index ? prepared : photo));
    }, () => {
      // A failed replacement must not silently submit the previous photo.
      setPhotos(current => current.map((photo, slot) => slot === index ? null : photo));
    });
  };

  const loadOwnOpenCard = async () => {
    if (importRequest.current || submitLock.current || photoPreparation.isProcessing()) return;
    const controller = new AbortController();
    importRequest.current = controller;
    const current = () => importRequest.current === controller && !controller.signal.aborted;
    setImporting(true);
    setImportMessage("");
    setConsent(false);
    const timer = setTimeout(() => {
      if (!current()) return;
      controller.abort();
      importRequest.current = null;
      setImporting(false);
      setImportMessage("불러오기가 지연되고 있어요. 다시 시도하거나 직접 입력해 주세요.");
    }, 25000);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (!current()) return;
      if (authError || !user) throw new Error("로그인 상태를 확인하지 못했어요. 다시 시도해 주세요.");
      const res = await fetch("/api/dating/paid/create?source=open_card", { cache: "no-store", signal: controller.signal });
      const body = await res.json().catch(() => ({}));
      if (!current()) return;
      if (res.status === 404) throw new Error("불러올 오픈카드가 없어요. 아래에서 직접 작성해 주세요.");
      if (!res.ok || !body.card) throw new Error("내 오픈카드를 불러오지 못했어요. 다시 시도하거나 직접 입력해 주세요.");
      const profile = paidApplicationPrefill(body.card);
      setAge(value => value || profile.age);
      setHeightCm(value => value || profile.heightCm);
      setRegion(value => value || profile.region);
      setJob(value => value || profile.job);
      setTrainingYears(value => value || profile.trainingYears);
      setInstagramId(value => value || profile.instagramId);
      setIntroText(value => value || profile.introText);
      // Download only the authenticated owner's raw photos; upload as new application photos on submit.
      const results = await Promise.allSettled(profile.photoUrls.map((url, slot) => photos[slot]
        ? Promise.resolve(photos[slot]!)
        : importOwnOpenCardPhoto(url, user.id, slot, MAX_FILE_SIZE, controller.signal)));
      if (!current()) return;
      results.forEach((result, slot) => {
        if (!photos[slot] && result.status === "fulfilled") photoPreparation.cancel(slot);
      });
      setPhotos(previous => previous.map((photo, slot) => {
        const result = results[slot];
        return photo || (result.status === "fulfilled" ? result.value : null);
      }));
      setImportMessage(results.some(result => result.status === "rejected")
        ? "빈 항목에 내 정보를 채웠어요. 불러오지 못한 사진은 직접 선택해 주세요."
        : "빈 항목에 내 정보와 사진을 채웠어요. 내용을 확인하고 지원해 주세요.");
    } catch (error) {
      if (current()) setImportMessage(error instanceof Error ? error.message : "불러오지 못했어요. 직접 입력해 주세요.");
    } finally {
      clearTimeout(timer);
      if (current()) { importRequest.current = null; setImporting(false); }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (completed || submitLock.current || importRequest.current || photoPreparation.isProcessing()) return;
    setError("");
    setProfileEditUrl(null);

    const normalizedInstagramId = normalizeInstagramId(instagramId);
    if (!validInstagramId(normalizedInstagramId)) {
      setError("인스타 아이디 형식을 확인해주세요. (@ 없이 최대 30자)");
      return;
    }
    if (!consent) {
      setError("동의가 필요합니다.");
      return;
    }
    if (!photos[0] || !photos[1]) {
      setError("지원 사진 2장이 필요합니다.");
      return;
    }

    for (const photo of photos) {
      if (!photo) continue;
      if (!ALLOWED_TYPES.includes(photo.type)) {
        setError("사진은 JPG/PNG/WebP만 가능합니다.");
        return;
      }
      if (photo.size > DATING_PHOTO_UPLOAD_MAX_BYTES) {
        setError("사진 용량을 줄이지 못했어요. 다시 선택해 주세요.");
        return;
      }
    }

    submitLock.current = true;
    setSubmitting(true);
    try {
      const uploadedPaths: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        const fd = new FormData();
        fd.append("file", photos[i]!);
        fd.append("paidCardId", id);
        fd.append("index", String(i));
        const uploadRes = await fetch("/api/dating/paid/upload", { method: "POST", body: fd });
        const uploadBody = (await uploadRes.json().catch(() => ({}))) as { path?: string; error?: string };
        if (!uploadRes.ok || !uploadBody.path) {
          setError(uploadBody.error ?? "사진 업로드 실패");
          setSubmitting(false);
          return;
        }
        uploadedPaths.push(uploadBody.path);
      }

      const payload = {
        paid_card_id: id,
        age: Number(age),
        height_cm: Number(heightCm),
        region: region.trim(),
        job: job.trim(),
        training_years: Number(trainingYears),
        intro_text: introText.trim(),
        instagram_id: normalizedInstagramId,
        photo_paths: uploadedPaths,
        consent,
      };

      const res = await fetch("/api/dating/paid/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const parsed: unknown = await res.json().catch(() => null);
      const body = (parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}) as {
        ok?: boolean;
        error?: string;
        code?: string;
        message?: string;
        requestId?: string;
        profile_edit_url?: string;
      };
      if (!res.ok) {
        if (body.profile_edit_url) setProfileEditUrl(body.profile_edit_url);
        const mapped: Record<string, string> = {
          NICKNAME_REQUIRED: "닉네임 설정 후 이용 가능합니다.",
          DUPLICATE_APPLICATION: "이미 해당 카드에 지원하셨어요.",
          FORBIDDEN: "권한이 없어 지원할 수 없습니다.",
          CARD_EXPIRED: "카드가 만료되었거나 비공개입니다.",
        };
        const msg = (body.code && mapped[body.code]) ?? body.error ?? body.message ?? "지원 처리 중 오류가 발생했습니다.";
        setError(body.requestId ? `${msg} (요청ID: ${body.requestId})` : msg);
        setSubmitting(false);
        return;
      }
      if (body.ok !== true) {
        setError("지원 결과를 확인하지 못했어요. 마이페이지의 ‘내 지원’을 먼저 확인해 주세요.");
        return;
      }

      setCompleted(true);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };

  if (completed) return <ApplicationCompleteNotice historyHref="/mypage?section=matching&match=applied#paid-card-applied" listHref="/community/dating/cards?tab=open_cards" />;

  if (loading || !card) {
    return (
      <main className="max-w-lg mx-auto px-4 py-8">
        <p className="text-sm text-neutral-500">{loadError ? "카드를 불러오지 못했어요. 잠시 후 다시 확인해 주세요." : "불러오는 중..."}</p>
        {loadError ? <button type="button" onClick={() => window.location.reload()} className="mt-3 min-h-10 text-sm font-semibold text-neutral-800">다시 불러오기</button> : null}
      </main>
    );
  }

  return (
    <main className="max-w-lg mx-auto px-4 py-8">
      <Link href={`/dating/paid/${id}`} className="inline-flex min-h-[44px] items-center text-sm text-neutral-500 hover:text-neutral-700">
        뒤로가기
      </Link>

      <h1 className="text-2xl font-bold text-neutral-900 mt-3">오픈카드 지원하기</h1>
      <p className="mt-2 text-xs leading-5 text-neutral-500">지원권 소모 없이 지원할 수 있어요.</p>

      <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-neutral-900">{card.nickname}</p>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            ⏳ {formatRemainingToKorean(card.expires_at)}
          </span>
        </div>
        {Array.isArray(card.image_urls) && card.image_urls[0] && (
          <div className="mt-2 h-40 rounded-lg overflow-hidden bg-neutral-50 border border-neutral-100 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={card.image_urls[0]}
              alt=""
              decoding="async"
              className={`h-full w-full object-contain ${card.photo_visibility === "public" ? "" : "blur-[9px]"}`}
            />
          </div>
        )}
      </div>

      <div className="mt-5 rounded-xl border border-neutral-200 px-3 py-2.5">
        <button type="button" disabled={importing || submitting || photoPreparation.busy} onClick={() => void loadOwnOpenCard()} className="min-h-10 text-sm font-semibold text-neutral-800 disabled:opacity-50">
          {importing ? "내 정보와 사진 불러오는 중…" : "내 오픈카드 불러오기"}
        </button>
        <p className="text-xs leading-5 text-neutral-500">빈 항목만 채워요. 이미 적은 내용과 선택한 사진은 유지돼요.</p>
        {importing ? <button type="button" className="min-h-9 text-xs text-neutral-500 underline" onClick={() => {
          importRequest.current?.abort(); importRequest.current = null; setImporting(false);
          setImportMessage("불러오기를 취소했어요. 아래에서 직접 입력할 수 있어요.");
        }}>불러오기 취소</button> : null}
        {importMessage ? <p role="status" className="mt-1 text-xs leading-5 text-neutral-600">{importMessage}</p> : null}
      </div>
      <form onSubmit={handleSubmit} className="mt-5">
        <fieldset disabled={importing || submitting} className="min-w-0 space-y-4">
        <Field label="나이" required>
          <input className="input" type="number" min={19} max={99} required value={age} onChange={(e) => setAge(e.target.value)} />
        </Field>
        <Field label="키(cm)" required>
          <input className="input" type="number" min={120} max={230} required value={heightCm} onChange={(e) => setHeightCm(e.target.value)} />
        </Field>
        <Field label="지역" required>
          <input className="input" required maxLength={30} value={region} onChange={(e) => setRegion(e.target.value)} />
        </Field>
        <Field label="직업" required>
          <input className="input" required maxLength={50} value={job} onChange={(e) => setJob(e.target.value)} />
        </Field>
        <Field label="운동경력(년)" required>
          <input className="input" type="number" min={0} max={50} required value={trainingYears} onChange={(e) => setTrainingYears(e.target.value)} />
        </Field>
        <Field label="인스타 아이디(@ 없이)" required>
          <input className="input" required maxLength={30} value={instagramId} onChange={(e) => setInstagramId(normalizeInstagramId(e.target.value))} />
        </Field>
        <Field label="자기소개" required>
          <textarea className="w-full rounded-xl border border-neutral-300 px-3 py-2" required maxLength={1000} rows={4} value={introText} onChange={(e) => setIntroText(e.target.value)} />
        </Field>
        {[0, 1].map(slot => <Field key={slot} label={`지원 사진 ${slot + 1}`} required>
          {photos[slot] ? <PhotoPreview file={photos[slot]!} slot={slot} /> : null}
          <input className="w-full min-w-0 text-xs" type="file" accept={DATING_PHOTO_ACCEPT} required={!photos[slot]} onChange={(e) => handlePhotoChange(slot, e.target.files?.[0] ?? null)} />
          {photoPreparation.pending.includes(slot) ? <p role="status" className="mt-1 text-xs text-neutral-500">사진을 준비하고 있어요…</p> : null}
          {photoPreparation.errors[slot] ? <p role="alert" className="mt-1 text-xs text-red-600">{photoPreparation.errors[slot]}</p> : null}
        </Field>)}
        <p className="text-xs leading-5 text-neutral-500">{HEIC_HELP}</p>

        <label className="flex items-start gap-2 text-sm text-neutral-700">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
          <span>지원 정보(인스타/사진 포함) 제출 및 매칭 진행에 동의합니다.</span>
        </label>

        {error && (
          <div className="space-y-2">
            <p className="text-sm text-red-600">{error}</p>
            {profileEditUrl && (
              <Link href={profileEditUrl} className="inline-block text-sm text-pink-700 underline">
                닉네임 설정하러 가기
              </Link>
            )}
          </div>
        )}

        <button type="submit" disabled={submitting || importing || photoPreparation.busy} className="w-full min-h-[46px] rounded-xl bg-rose-600 text-white text-sm font-medium hover:bg-rose-700 disabled:opacity-50">
          {submitting ? "지원 중..." : "지원하기"}
        </button>
        </fieldset>
      </form>

      <style jsx>{`
        .input {
          width: 100%;
          min-height: 44px;
          border: 1px solid #d4d4d8;
          border-radius: 0.75rem;
          padding: 0 0.75rem;
          background: white;
        }
      `}</style>
    </main>
  );
}

function Field({ label, required = false, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-neutral-700 mb-1">
        {label} {required ? "*" : ""}
      </span>
      {children}
    </label>
  );
}

function PhotoPreview({ file, slot }: { file: File; slot: number }) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const next = URL.createObjectURL(file);
    if (image.current) image.current.src = next;
    return () => URL.revokeObjectURL(next);
  }, [file]);
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={image} alt={`지원 사진 ${slot + 1} 미리보기`} className="mb-2 h-28 w-24 rounded-lg border border-neutral-200 object-contain" />;
}
