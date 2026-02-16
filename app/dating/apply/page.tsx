"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Sex = "male" | "female";
type ApiErrorPayload = { error?: string; code?: string; details?: string };
type ExtendedError = Error & { code?: string; details?: string; status?: number };

const REGIONS = [
  "서울", "경기", "인천", "부산", "대구", "대전", "광주",
  "울산", "세종", "강원", "충북", "충남", "전북", "전남",
  "경북", "경남", "제주",
];

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

function normalizeSex(value: unknown): Sex | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["male", "m", "남", "남자", "남성"].includes(normalized)) return "male";
  if (["female", "f", "여", "여자", "여성"].includes(normalized)) return "female";
  return null;
}

function getFileExtension(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ext && ext.length > 0 ? ext : "";
}

function buildApiError(defaultMessage: string, body?: ApiErrorPayload, status?: number): ExtendedError {
  const message = body?.error ?? defaultMessage;
  const error = new Error(message) as ExtendedError;
  error.code = body?.code;
  error.details = body?.details;
  error.status = status;
  return error;
}

function getErrorInfo(err: unknown): { message: string; code?: string; details?: string } {
  if (err instanceof Error) {
    const extErr = err as ExtendedError;
    return { message: err.message, code: extErr.code, details: extErr.details };
  }
  return { message: "오류가 발생했습니다." };
}

function maskApplyPayload(payload: Record<string, unknown>) {
  const cloned = { ...payload };
  if (typeof cloned.name === "string") {
    const name = cloned.name;
    cloned.name = name.length <= 2 ? `${name[0]}*` : `${name[0]}*${name[name.length - 1]}`;
  }
  if (typeof cloned.phone === "string") {
    const phone = cloned.phone;
    cloned.phone = phone.length > 4 ? `${phone.slice(0, 3)}****${phone.slice(-2)}` : "***";
  }
  return cloned;
}

export default function DatingApplyPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const isDev = process.env.NODE_ENV !== "production";

  const [authChecked, setAuthChecked] = useState(false);
  const [sex, setSex] = useState<Sex | "">("");
  const [certChecked, setCertChecked] = useState(false);
  const [certApproved, setCertApproved] = useState(false);
  const [certLoading, setCertLoading] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [region, setRegion] = useState("");
  const [age, setAge] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [job, setJob] = useState("");
  const [trainingYears, setTrainingYears] = useState("");
  const [idealType, setIdealType] = useState("");

  const [photos, setPhotos] = useState<(File | null)[]>([null, null]);
  const [previews, setPreviews] = useState<(string | null)[]>([null, null]);

  const [consentPrivacy, setConsentPrivacy] = useState(false);
  const [consentContent, setConsentContent] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  // 인증 체크
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login?redirect=/dating/apply");
        return;
      }
      setAuthChecked(true);
    })();
  }, [router, supabase]);

  // 남자 선택 시 3대 인증 체크
  useEffect(() => {
    if (sex !== "male") {
      setCertChecked(false);
      setCertApproved(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setCertLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const { data } = await supabase
          .from("cert_requests")
          .select("id")
          .eq("user_id", user.id)
          .eq("status", "approved")
          .limit(1)
          .maybeSingle();
        if (cancelled) return;
        setCertApproved(!!data);
      } finally {
        if (!cancelled) {
          setCertChecked(true);
          setCertLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [sex, supabase]);

  const handlePhotoChange = (idx: number, file: File | null) => {
    if (file) {
      if (file.size > MAX_FILE_SIZE) {
        setError("사진은 5MB 이하만 가능합니다.");
        return;
      }
      const ext = getFileExtension(file.name);
      if (!ALLOWED_TYPES.includes(file.type) || !ALLOWED_EXTENSIONS.has(ext)) {
        setError("JPG, PNG, WebP만 업로드할 수 있습니다. (HEIC 불가)");
        return;
      }
    }
    setError("");
    const newPhotos = [...photos];
    newPhotos[idx] = file;
    setPhotos(newPhotos);

    const newPreviews = [...previews];
    if (newPreviews[idx]) URL.revokeObjectURL(newPreviews[idx]!);
    newPreviews[idx] = file ? URL.createObjectURL(file) : null;
    setPreviews(newPreviews);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const normalizedSex = normalizeSex(sex);
    if (!normalizedSex) { setError("성별을 선택해주세요."); return; }
    if (normalizedSex === "male" && !certApproved) { setError("남성은 3대 인증이 필요합니다."); return; }
    if (!age || Number(age) < 19 || Number(age) > 45) { setError("나이를 입력해주세요. (19~45세)"); return; }
    if (!photos[0] || !photos[1]) { setError("사진 2장을 모두 업로드해주세요."); return; }
    if (!consentPrivacy) { setError("개인정보 수집·이용에 동의해주세요."); return; }

    setSubmitting(true);
    try {
      // 1) 신청 생성
      const applyPayload = {
        sex: normalizedSex,
        name: name.trim(),
        phone: phone.trim(),
        region,
        age: Number(age),
        height_cm: Number(heightCm),
        job: job.trim(),
        training_years: Number(trainingYears),
        ideal_type: idealType.trim(),
        consent_privacy: consentPrivacy,
        consent_content: consentContent,
      };
      const res = await fetch("/api/dating/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(applyPayload),
      });
      const resBody = (await res.json().catch(() => ({}))) as ApiErrorPayload & { id?: string };
      if (!res.ok) {
        console.error("dating apply request failed", {
          url: "/api/dating/apply",
          method: "POST",
          payload: maskApplyPayload(applyPayload),
          responseStatus: res.status,
          responseBody: resBody,
        });
        throw buildApiError("신청에 실패했습니다.", resBody, res.status);
      }
      const applicationId = resBody.id;
      if (!applicationId) {
        throw buildApiError("신청 ID를 받지 못했습니다.", { code: "MISSING_APPLICATION_ID" }, res.status);
      }

      // 2) 사진 2장 업로드
      for (let i = 0; i < 2; i++) {
        const fd = new FormData();
        fd.append("file", photos[i]!);
        fd.append("applicationId", applicationId!);
        fd.append("index", String(i));
        const uploadRes = await fetch("/api/dating/upload", { method: "POST", body: fd });
        if (!uploadRes.ok) {
          const uploadBody = (await uploadRes.json().catch(() => ({}))) as ApiErrorPayload;
          console.error("dating upload request failed", {
            url: "/api/dating/upload",
            method: "POST",
            payload: {
              applicationId,
              index: i,
              fileName: photos[i]?.name,
              fileType: photos[i]?.type,
              fileSize: photos[i]?.size,
            },
            responseStatus: uploadRes.status,
            responseBody: uploadBody,
          });
          throw buildApiError(`사진 ${i + 1} 업로드 실패`, uploadBody, uploadRes.status);
        }
      }

      setDone(true);
    } catch (err) {
      const info = getErrorInfo(err);
      console.error("dating apply error", err, {
        message: info.message,
        code: info.code,
        details: info.details,
      });

      const isBusinessError = info.code === "MALE_CERT_REQUIRED" || info.code === "DUPLICATE_RECENT_APPLICATION";
      if (isDev || isBusinessError) {
        const detailText = info.details ? ` (${info.details})` : "";
        const codeText = info.code ? ` [${info.code}]` : "";
        setError(`${info.message}${codeText}${detailText}`);
      } else {
        setError(info.code ? `신청 실패(코드: ${info.code})` : "신청에 실패했습니다.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  // 완료 화면
  if (done) {
    return (
      <main className="max-w-md mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-neutral-900 mb-3">신청 완료</h1>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
          <p className="text-base font-semibold text-rose-700 mb-2">소개팅 신청이 접수되었습니다!</p>
          <p className="text-sm text-neutral-700">검토 후 개별 연락드리겠습니다.</p>
        </div>
        <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
          <p className="text-xs text-neutral-600">매칭은 보장되지 않으며, 외부 만남에서 발생하는 문제에 대해 플랫폼은 책임을 지지 않습니다.</p>
        </div>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="w-full mt-4 min-h-[48px] rounded-xl bg-rose-500 text-white font-medium hover:bg-rose-600"
        >
          홈으로 돌아가기
        </button>
      </main>
    );
  }

  if (!authChecked) {
    return (
      <main className="max-w-md mx-auto px-4 py-8">
        <p className="text-sm text-neutral-500">로그인 확인 중...</p>
      </main>
    );
  }

  return (
    <main className="max-w-md mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-neutral-900 mb-1">소개팅 신청</h1>
      <p className="text-sm text-neutral-500 mb-6">3대 인증자 매칭 서비스</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 성별 */}
        <div>
          <p className="text-sm font-medium text-neutral-700 mb-2">성별 (필수)</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSex("male")}
              className={`flex-1 h-11 rounded-xl border text-sm font-medium ${
                sex === "male" ? "bg-rose-500 text-white border-rose-500" : "bg-white border-neutral-300 text-neutral-700"
              }`}
            >
              남자
            </button>
            <button
              type="button"
              onClick={() => setSex("female")}
              className={`flex-1 h-11 rounded-xl border text-sm font-medium ${
                sex === "female" ? "bg-rose-500 text-white border-rose-500" : "bg-white border-neutral-300 text-neutral-700"
              }`}
            >
              여자
            </button>
          </div>
        </div>

        {/* 남자 인증 체크 */}
        {sex === "male" && certChecked && !certApproved && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-800 mb-2">3대 인증이 필요합니다</p>
            <p className="text-xs text-amber-700 mb-3">남성은 3대 공식 인증(승인 완료)을 받은 후에 소개팅 신청이 가능합니다.</p>
            <Link
              href="/certify"
              className="inline-block px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700"
            >
              3대 인증 신청하기
            </Link>
          </div>
        )}

        {sex === "male" && certLoading && (
          <p className="text-sm text-neutral-500">인증 상태 확인 중...</p>
        )}

        {/* 폼 필드 (성별 선택 + 남자면 인증 필요) */}
        {(sex === "female" || (sex === "male" && certApproved)) && (
          <>
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-neutral-700 mb-1">이름 (필수)</label>
              <input
                id="name"
                type="text"
                required
                maxLength={20}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full h-12 rounded-xl border border-neutral-300 bg-white px-3"
                placeholder="실명"
              />
            </div>

            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-neutral-700 mb-1">전화번호 (필수)</label>
              <input
                id="phone"
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full h-12 rounded-xl border border-neutral-300 bg-white px-3"
                placeholder="01012345678"
              />
            </div>

            <div>
              <label htmlFor="region" className="block text-sm font-medium text-neutral-700 mb-1">지역 (필수)</label>
              <select
                id="region"
                required
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="w-full h-12 rounded-xl border border-neutral-300 bg-white px-3"
              >
                <option value="">선택</option>
                {REGIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="height" className="block text-sm font-medium text-neutral-700 mb-1">키 (cm, 필수)</label>
              <input
                id="height"
                type="number"
                required
                min={120}
                max={220}
                value={heightCm}
                onChange={(e) => setHeightCm(e.target.value)}
                className="w-full h-12 rounded-xl border border-neutral-300 bg-white px-3"
                placeholder="175"
              />
            </div>

            <div>
              <label htmlFor="age" className="block text-sm font-medium text-neutral-700 mb-1">나이 (필수)</label>
              <input
                id="age"
                type="number"
                required
                min={19}
                max={45}
                value={age}
                onChange={(e) => setAge(e.target.value)}
                className="w-full h-12 rounded-xl border border-neutral-300 bg-white px-3"
                placeholder="29"
              />
            </div>

            <div>
              <label htmlFor="job" className="block text-sm font-medium text-neutral-700 mb-1">직업 (필수)</label>
              <input
                id="job"
                type="text"
                required
                maxLength={50}
                value={job}
                onChange={(e) => setJob(e.target.value)}
                className="w-full h-12 rounded-xl border border-neutral-300 bg-white px-3"
                placeholder="직업"
              />
            </div>

            <div>
              <label htmlFor="trainingYears" className="block text-sm font-medium text-neutral-700 mb-1">운동경력 (필수)</label>
              <input
                id="trainingYears"
                type="number"
                required
                min={0}
                max={30}
                value={trainingYears}
                onChange={(e) => setTrainingYears(e.target.value)}
                className="w-full h-12 rounded-xl border border-neutral-300 bg-white px-3"
                placeholder="년 (0년 = 입문)"
              />
              <p className="text-xs text-neutral-400 mt-1">0년(입문)도 가능합니다.</p>
            </div>

            <div>
              <label htmlFor="idealType" className="block text-sm font-medium text-neutral-700 mb-1">이상형 (필수)</label>
              <textarea
                id="idealType"
                required
                maxLength={1000}
                rows={4}
                value={idealType}
                onChange={(e) => setIdealType(e.target.value)}
                className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2"
                placeholder="원하는 이상형을 자유롭게 적어주세요."
              />
              <p className="text-xs text-neutral-400 mt-1">{idealType.length}/1000</p>
            </div>

            {/* 사진 업로드 */}
            <div>
              <p className="text-sm font-medium text-neutral-700 mb-2">본인 사진 2장 (필수)</p>
              <p className="text-xs text-neutral-500 mb-3">사진은 관리자만 확인합니다. JPG/PNG/WebP, 장당 5MB 이하.</p>
              <div className="flex gap-3">
                {[0, 1].map((idx) => (
                  <label
                    key={idx}
                    className="flex-1 aspect-square rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 flex items-center justify-center cursor-pointer overflow-hidden hover:border-rose-400 transition-colors"
                  >
                    {previews[idx] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={previews[idx]!} alt={`사진 ${idx + 1}`} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-neutral-400 text-sm">사진 {idx + 1}</span>
                    )}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => handlePhotoChange(idx, e.target.files?.[0] ?? null)}
                    />
                  </label>
                ))}
              </div>
            </div>

            {/* 동의 */}
            <div className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consentPrivacy}
                  onChange={(e) => setConsentPrivacy(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-neutral-300"
                />
                <span className="text-xs text-neutral-700">
                  <strong>[필수]</strong> 개인정보 수집·이용에 동의합니다. (이름, 연락처, 사진, 지역, 키, 직업, 이상형 — 매칭 및 연락 목적, 90일 후 자동 삭제)
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consentContent}
                  onChange={(e) => setConsentContent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-neutral-300"
                />
                <span className="text-xs text-neutral-700">
                  <strong>[선택]</strong> 콘텐츠 활용에 동의합니다. (인터뷰/후기 제작 가능성, 얼굴·목소리 공개는 별도 동의)
                </span>
              </label>
            </div>

            {/* 고지 문구 */}
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 space-y-1">
              <p className="text-xs text-neutral-600">• 만 19세 이상만 신청 가능합니다.</p>
              <p className="text-xs text-neutral-600">• 매칭은 보장되지 않습니다.</p>
              <p className="text-xs text-neutral-600">• 외부 연락/만남에서 발생하는 문제에 대해 플랫폼은 책임을 지지 않습니다.</p>
              <p className="text-xs text-neutral-600">• 허위 정보 제출 시 이용이 제한될 수 있습니다.</p>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[48px] rounded-xl bg-rose-500 text-white font-medium hover:bg-rose-600 disabled:opacity-50"
            >
              {submitting ? "신청 중..." : "소개팅 신청하기"}
            </button>
          </>
        )}
      </form>
    </main>
  );
}
