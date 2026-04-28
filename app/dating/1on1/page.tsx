"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import DatingAdultNotice from "@/components/DatingAdultNotice";
import { isDatingOneOnOneLegacyPhoneShareMatch } from "@/lib/dating-1on1";

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

type OneOnOneCandidateCard = {
  id: string;
  sex: "male" | "female";
  name: string;
  age: number | null;
  birth_year: number;
  height_cm: number;
  job: string;
  region: string;
  intro_text: string;
  strengths_text: string;
  preferred_partner_text: string;
  smoking: "non_smoker" | "occasional" | "smoker";
  workout_frequency: "none" | "1_2" | "3_4" | "5_plus" | null;
  status: "submitted" | "reviewing" | "approved" | "rejected";
  created_at: string;
  photo_signed_urls?: string[];
};

type OneOnOneMatch = {
  id: string;
  role: "source" | "candidate";
  state:
    | "proposed"
    | "source_selected"
    | "source_skipped"
    | "candidate_accepted"
    | "candidate_rejected"
    | "source_declined"
    | "admin_canceled"
    | "mutual_accepted";
  contact_exchange_status:
    | "none"
    | "awaiting_applicant_payment"
    | "payment_pending_admin"
    | "approved"
    | "canceled";
  contact_exchange_requested_at: string | null;
  contact_exchange_paid_at: string | null;
  contact_exchange_paid_by_user_id: string | null;
  contact_exchange_approved_at: string | null;
  contact_exchange_approved_by_user_id: string | null;
  contact_exchange_note: string | null;
  source_phone_share_consented_at: string | null;
  candidate_phone_share_consented_at: string | null;
  action_required: boolean;
  source_card_id: string;
  candidate_card_id: string;
  source_selected_at: string | null;
  candidate_responded_at: string | null;
  source_final_responded_at: string | null;
  created_at: string;
  updated_at: string;
  counterparty_card: OneOnOneCandidateCard | null;
  counterparty_phone: string | null;
};

type OneOnOneAutoRecommendationGroup = {
  source_card_id: string;
  source_card_status?: "submitted" | "reviewing" | "approved" | "rejected";
  refresh_used?: boolean;
  refresh_used_at?: string | null;
  next_refresh_at?: string | null;
  can_refresh?: boolean;
  recommendations: OneOnOneCandidateCard[];
};

const OPEN_KAKAO_URL = process.env.NEXT_PUBLIC_OPENKAKAO_URL ?? "https://open.kakao.com/o/s2gvTdhi";

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
  const [myOneOnOneMatches, setMyOneOnOneMatches] = useState<OneOnOneMatch[]>([]);
  const [myOneOnOneAutoRecommendations, setMyOneOnOneAutoRecommendations] = useState<OneOnOneAutoRecommendationGroup[]>([]);
  const [progressLoading, setProgressLoading] = useState(false);
  const [processingOneOnOneMatchIds, setProcessingOneOnOneMatchIds] = useState<string[]>([]);
  const [processingOneOnOneContactExchangeIds, setProcessingOneOnOneContactExchangeIds] = useState<string[]>([]);
  const [processingOneOnOneAutoKeys, setProcessingOneOnOneAutoKeys] = useState<string[]>([]);
  const [refreshingOneOnOneRecommendationIds, setRefreshingOneOnOneRecommendationIds] = useState<string[]>([]);

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

  const loadOneOnOneProgress = useCallback(async () => {
    setProgressLoading(true);
    try {
      const [recommendationsRes, matchesRes] = await Promise.all([
        fetch("/api/dating/1on1/recommendations/my", { cache: "no-store" }),
        fetch("/api/dating/1on1/matches/my", { cache: "no-store" }),
      ]);

      const recommendationsBody = (await recommendationsRes.json().catch(() => ({}))) as {
        items?: OneOnOneAutoRecommendationGroup[];
        error?: string;
      };
      const matchesBody = (await matchesRes.json().catch(() => ({}))) as {
        items?: OneOnOneMatch[];
        error?: string;
      };

      if (!recommendationsRes.ok) {
        throw new Error(recommendationsBody.error ?? "1:1 추천 후보를 불러오지 못했습니다.");
      }
      if (!matchesRes.ok) {
        throw new Error(matchesBody.error ?? "1:1 진행 상태를 불러오지 못했습니다.");
      }

      setMyOneOnOneAutoRecommendations(recommendationsBody.items ?? []);
      setMyOneOnOneMatches(matchesBody.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "1:1 진행 상태를 불러오지 못했습니다.");
    } finally {
      setProgressLoading(false);
    }
  }, []);

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

        if (!mounted) return;
        await loadOneOnOneProgress();

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
  }, [editId, isEditMode, loadOneOnOneProgress, router, supabase]);

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

  const handleOneOnOneMatchAction = async (
    matchId: string,
    action:
      | "select_candidate"
      | "candidate_accept"
      | "candidate_reject"
      | "source_accept"
      | "source_reject"
      | "cancel_mutual"
  ) => {
    setError("");
    setInfo("");
    setProcessingOneOnOneMatchIds((current) => [...current, matchId]);
    try {
      const res = await fetch(`/api/dating/1on1/matches/${matchId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "1:1 매칭 처리에 실패했습니다.");
      }
      await loadOneOnOneProgress();
    } catch (e) {
      setError(e instanceof Error ? e.message : "1:1 매칭 처리에 실패했습니다.");
    } finally {
      setProcessingOneOnOneMatchIds((current) => current.filter((id) => id !== matchId));
    }
  };

  const handleRequestOneOnOneContactExchange = async (matchId: string) => {
    setError("");
    setInfo("");
    setProcessingOneOnOneContactExchangeIds((current) => [...current, matchId]);
    try {
      const res = await fetch(`/api/dating/1on1/matches/${matchId}/contact-exchange`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "번호 교환 요청 처리에 실패했습니다.");
      }
      await loadOneOnOneProgress();
    } catch (e) {
      setError(e instanceof Error ? e.message : "번호 교환 요청 처리에 실패했습니다.");
    } finally {
      setProcessingOneOnOneContactExchangeIds((current) => current.filter((id) => id !== matchId));
    }
  };

  const handleOneOnOneAutoRecommendationSelect = async (sourceCardId: string, candidateCardId: string) => {
    setError("");
    setInfo("");
    const actionKey = `${sourceCardId}:${candidateCardId}`;
    setProcessingOneOnOneAutoKeys((current) => [...current, actionKey]);
    try {
      const res = await fetch("/api/dating/1on1/matches/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_card_id: sourceCardId, candidate_card_id: candidateCardId }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "자동 추천 후보 선택에 실패했습니다.");
      }
      await loadOneOnOneProgress();
      setInfo("후보 선택이 전달되었습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "자동 추천 후보 선택에 실패했습니다.");
    } finally {
      setProcessingOneOnOneAutoKeys((current) => current.filter((key) => key !== actionKey));
    }
  };

  const handleRefreshOneOnOneRecommendations = async (sourceCardId: string) => {
    if (!confirm("자동 추천 후보 10명을 새로 불러올까요? 1일에 한 번 새로고침할 수 있습니다.")) return;

    setError("");
    setInfo("");
    setRefreshingOneOnOneRecommendationIds((current) => [...current, sourceCardId]);
    try {
      const res = await fetch("/api/dating/1on1/recommendations/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_card_id: sourceCardId }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "자동 추천 후보를 새로고침하지 못했습니다.");
      }
      await loadOneOnOneProgress();
      setInfo("자동 추천 후보를 새로 섞어드렸습니다. 다음 새로고침은 1일 뒤에 가능합니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "자동 추천 후보를 새로고침하지 못했습니다.");
    } finally {
      setRefreshingOneOnOneRecommendationIds((current) => current.filter((id) => id !== sourceCardId));
    }
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
      await loadOneOnOneProgress();
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

  const oneOnOneMatchStateText: Record<OneOnOneMatch["state"], string> = {
    proposed: "후보 도착",
    source_selected: "수락 대기",
    source_skipped: "건너뜀",
    candidate_accepted: "최종 수락 대기",
    candidate_rejected: "거절됨",
    source_declined: "최종 거절",
    admin_canceled: "매칭 취소",
    mutual_accepted: "쌍방 수락",
  };

  const oneOnOneMatchStateColor: Record<OneOnOneMatch["state"], string> = {
    proposed: "bg-sky-100 text-sky-700",
    source_selected: "bg-amber-100 text-amber-700",
    source_skipped: "bg-neutral-200 text-neutral-700",
    candidate_accepted: "bg-violet-100 text-violet-700",
    candidate_rejected: "bg-rose-100 text-rose-700",
    source_declined: "bg-rose-100 text-rose-700",
    admin_canceled: "bg-neutral-200 text-neutral-700",
    mutual_accepted: "bg-emerald-100 text-emerald-700",
  };

  const oneOnOneContactExchangeColor: Record<OneOnOneMatch["contact_exchange_status"], string> = {
    none: "bg-neutral-200 text-neutral-700",
    awaiting_applicant_payment: "bg-amber-100 text-amber-700",
    payment_pending_admin: "bg-sky-100 text-sky-700",
    approved: "bg-emerald-100 text-emerald-700",
    canceled: "bg-neutral-200 text-neutral-700",
  };

  const isLegacyOneOnOneContactFlow = (match: Pick<OneOnOneMatch, "state" | "source_final_responded_at" | "created_at">) =>
    isDatingOneOnOneLegacyPhoneShareMatch(match);

  const getOneOnOneConsentState = (match: OneOnOneMatch) => {
    const selfConsented =
      match.role === "source" ? Boolean(match.source_phone_share_consented_at) : Boolean(match.candidate_phone_share_consented_at);
    const otherConsented =
      match.role === "source" ? Boolean(match.candidate_phone_share_consented_at) : Boolean(match.source_phone_share_consented_at);
    return { selfConsented, otherConsented };
  };

  const getOneOnOneContactExchangeBadgeText = (match: OneOnOneMatch) => {
    if (!isLegacyOneOnOneContactFlow(match) || match.contact_exchange_status !== "none") {
      if (isLegacyOneOnOneContactFlow(match) && match.contact_exchange_status === "awaiting_applicant_payment") {
        return "동의/결제 대기";
      }
      if (match.contact_exchange_status === "awaiting_applicant_payment") return "번호 교환 대기";
      if (match.contact_exchange_status === "payment_pending_admin") return "입금 확인 중";
      if (match.contact_exchange_status === "approved") return "번호 공개 완료";
      if (match.contact_exchange_status === "canceled") return "번호 교환 취소";
      return "번호 공개 전";
    }

    const { selfConsented, otherConsented } = getOneOnOneConsentState(match);
    if (selfConsented && otherConsented) return "동의 완료";
    if (selfConsented) return "상대 동의 대기";
    if (otherConsented) return "내 동의 필요";
    return "번호 공개 동의";
  };

  const incomingCandidates = myOneOnOneMatches.filter((match) => match.role === "source" && match.state === "proposed");
  const candidateDecisionRequests = myOneOnOneMatches.filter((match) => match.role === "candidate" && match.state === "source_selected");
  const waitingCandidateResponses = myOneOnOneMatches.filter((match) => match.role === "source" && match.state === "source_selected");
  const finalAcceptRequests = myOneOnOneMatches.filter((match) => match.role === "source" && match.state === "candidate_accepted");
  const mutualAcceptedMatches = myOneOnOneMatches.filter((match) => match.state === "mutual_accepted");
  const hasProgressSection =
    myOneOnOneAutoRecommendations.length > 0 ||
    incomingCandidates.length > 0 ||
    candidateDecisionRequests.length > 0 ||
    waitingCandidateResponses.length > 0 ||
    finalAcceptRequests.length > 0 ||
    mutualAcceptedMatches.length > 0;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h1 className="text-2xl font-bold text-neutral-900">
          {isEditMode ? "1:1 오프라인 소개팅 신청서 수정" : "1:1 오프라인 소개팅"}
        </h1>
        <p className="mt-2 text-sm text-neutral-700">운영자가 매칭을 관리하고, 서로 수락되면 번호 교환이 진행되는 1:1 소개팅입니다.</p>
        <p className="text-sm text-neutral-700">신청은 무료이며, 번호 교환 단계에서만 매칭비 20,000원이 발생합니다.</p>
        <p className="text-sm text-neutral-700">신청 내용은 외부 공개 없이 매칭 진행에만 사용되며, 쌍방 수락 후 승인되면 양쪽 번호가 공개될 수 있습니다.</p>
        <p className="mt-2 text-sm font-medium text-emerald-700">
          지금까지 {Number(status?.totalApplications ?? 0).toLocaleString("ko-KR")}명이 1:1 소개팅을 신청했습니다.
        </p>
        <p className="mt-2 text-xs text-neutral-500">
          카드 내용에는 소개에 필요한 정보만 담기고, 전화번호는 쌍방 수락 후 관리자 승인 전까지 상대에게 공개되지 않습니다.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3">
            <p className="text-[11px] font-semibold tracking-wide text-neutral-500">1단계</p>
            <p className="mt-1 text-sm font-semibold text-neutral-900">신청은 무료</p>
            <p className="mt-1 text-xs leading-5 text-neutral-600">프로필을 작성하면 운영자가 후보를 연결합니다.</p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3">
            <p className="text-[11px] font-semibold tracking-wide text-neutral-500">2단계</p>
            <p className="mt-1 text-sm font-semibold text-neutral-900">서로 수락</p>
            <p className="mt-1 text-xs leading-5 text-neutral-600">쌍방 수락이 되면 지원자에게 번호 교환 안내가 열립니다.</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-3">
            <p className="text-[11px] font-semibold tracking-wide text-emerald-700">3단계</p>
            <p className="mt-1 text-sm font-semibold text-emerald-900">번호 교환</p>
            <p className="mt-1 text-xs leading-5 text-emerald-800">매칭비 20,000원 확인 후 양쪽 번호가 공개될 수 있습니다.</p>
          </div>
        </div>
      </section>

      {hasProgressSection && (
        <section className="mt-4 rounded-2xl border border-neutral-200 bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-neutral-900">내 1:1 진행</h2>
              <p className="mt-1 text-sm text-neutral-600">후보 확인부터 수락, 번호 교환 요청까지 여기서 바로 진행할 수 있어요.</p>
            </div>
            {progressLoading ? <span className="text-xs text-neutral-400">불러오는 중...</span> : null}
          </div>

          {myOneOnOneAutoRecommendations.map((item) => {
            const refreshing = refreshingOneOnOneRecommendationIds.includes(item.source_card_id);
            const canRefreshAutoRecommendations = Boolean(item.can_refresh);
            const autoRecommendations = item.recommendations ?? [];
            return (
              <div key={item.source_card_id} className="mt-4 rounded-xl border border-pink-200 bg-pink-50/50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-pink-900">자동 추천 후보</p>
                    <p className="mt-1 text-xs text-pink-700">가까운 지역과 비슷한 나이를 먼저 보고 추천해드려요.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRefreshOneOnOneRecommendations(item.source_card_id)}
                    disabled={!canRefreshAutoRecommendations || refreshing}
                    className="inline-flex h-8 shrink-0 items-center rounded-md border border-pink-300 bg-white px-3 text-xs font-medium text-pink-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {refreshing ? "새로고침 중..." : canRefreshAutoRecommendations ? "추천 새로고침" : "1일 쿨다운"}
                  </button>
                </div>
                {item.refresh_used && !canRefreshAutoRecommendations && item.next_refresh_at ? (
                  <p className="mt-1 text-xs text-pink-700">다음 새로고침 가능 시각: {new Date(item.next_refresh_at).toLocaleString("ko-KR")}</p>
                ) : null}
                {autoRecommendations.length === 0 ? (
                  <div className="mt-3 rounded-lg border border-dashed border-pink-200 bg-white p-3 text-sm text-neutral-500">
                    지금 바로 보여줄 자동 추천 후보가 없어요. 진행 중인 매칭이 있거나 새 후보가 잡히면 여기서 보여드릴게요.
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {autoRecommendations.map((card) => {
                      const actionKey = `${item.source_card_id}:${card.id}`;
                      const processing = processingOneOnOneAutoKeys.includes(actionKey);
                      return (
                        <div key={actionKey} className="rounded-lg border border-pink-200 bg-white p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium text-neutral-900">{card.name} / {card.age ?? "-"}세 / {card.region}</p>
                            <span className="inline-flex rounded-full bg-pink-100 px-2 py-0.5 text-[11px] font-medium text-pink-700">자동 추천</span>
                          </div>
                          <p className="mt-1 text-xs text-neutral-600">{card.height_cm}cm / {card.job}</p>
                          <p className="mt-2 text-xs text-neutral-700 whitespace-pre-wrap break-words">{card.intro_text}</p>
                          <button
                            type="button"
                            disabled={processing}
                            onClick={() => void handleOneOnOneAutoRecommendationSelect(item.source_card_id, card.id)}
                            className="mt-3 inline-flex h-8 items-center rounded-md bg-pink-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                          >
                            {processing ? "처리 중..." : "이 후보 선택"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {incomingCandidates.length > 0 && (
            <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50/50 p-3">
              <p className="text-sm font-semibold text-sky-900">운영자가 보낸 후보</p>
              <div className="mt-3 space-y-2">
                {incomingCandidates.map((match) => {
                  const card = match.counterparty_card;
                  const processing = processingOneOnOneMatchIds.includes(match.id);
                  if (!card) return null;
                  return (
                    <div key={match.id} className="rounded-lg border border-sky-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-neutral-900">{card.name} / {card.age ?? "-"}세 / {card.region}</p>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${oneOnOneMatchStateColor[match.state]}`}>{oneOnOneMatchStateText[match.state]}</span>
                      </div>
                      <p className="mt-1 text-xs text-neutral-600">{card.height_cm}cm / {card.job}</p>
                      <p className="mt-2 text-xs text-neutral-700 whitespace-pre-wrap break-words">{card.intro_text}</p>
                      <button
                        type="button"
                        disabled={processing}
                        onClick={() => void handleOneOnOneMatchAction(match.id, "select_candidate")}
                        className="mt-3 inline-flex h-8 items-center rounded-md bg-sky-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                      >
                        {processing ? "처리 중..." : "이 후보 선택"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {candidateDecisionRequests.length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              <p className="text-sm font-semibold text-amber-900">상대가 나를 선택함</p>
              <div className="mt-3 space-y-2">
                {candidateDecisionRequests.map((match) => {
                  const card = match.counterparty_card;
                  const processing = processingOneOnOneMatchIds.includes(match.id);
                  if (!card) return null;
                  return (
                    <div key={match.id} className="rounded-lg border border-amber-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-neutral-900">{card.name} / {card.age ?? "-"}세 / {card.region}</p>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${oneOnOneMatchStateColor[match.state]}`}>{oneOnOneMatchStateText[match.state]}</span>
                      </div>
                      <p className="mt-1 text-xs text-neutral-600">{card.height_cm}cm / {card.job}</p>
                      <p className="mt-2 text-xs text-neutral-700 whitespace-pre-wrap break-words">{card.intro_text}</p>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          disabled={processing}
                          onClick={() => void handleOneOnOneMatchAction(match.id, "candidate_accept")}
                          className="inline-flex h-8 items-center rounded-md bg-emerald-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                        >
                          {processing ? "처리 중..." : "수락"}
                        </button>
                        <button
                          type="button"
                          disabled={processing}
                          onClick={() => void handleOneOnOneMatchAction(match.id, "candidate_reject")}
                          className="inline-flex h-8 items-center rounded-md border border-red-300 bg-white px-3 text-xs font-medium text-red-700 disabled:opacity-50"
                        >
                          거절
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {waitingCandidateResponses.length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
              <p className="text-sm font-semibold text-amber-900">내가 선택한 후보</p>
              <div className="mt-2 space-y-2">
                {waitingCandidateResponses.map((match) => {
                  const card = match.counterparty_card;
                  if (!card) return null;
                  return (
                    <div key={match.id} className="rounded-lg border border-amber-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-neutral-900">{card.name} / {card.age ?? "-"}세 / {card.region}</p>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${oneOnOneMatchStateColor[match.state]}`}>{oneOnOneMatchStateText[match.state]}</span>
                      </div>
                      <p className="mt-1 text-xs text-neutral-600">상대가 수락하면 내 최종 수락 단계로 넘어갑니다.</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {finalAcceptRequests.length > 0 && (
            <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50/50 p-3">
              <p className="text-sm font-semibold text-violet-900">최종 수락 요청</p>
              <div className="mt-3 space-y-2">
                {finalAcceptRequests.map((match) => {
                  const card = match.counterparty_card;
                  const processing = processingOneOnOneMatchIds.includes(match.id);
                  if (!card) return null;
                  return (
                    <div key={match.id} className="rounded-lg border border-violet-200 bg-white p-3">
                      <p className="text-sm font-medium text-neutral-900">{card.name}님도 수락했습니다. 최종 수락할까요?</p>
                      <p className="mt-1 text-xs text-neutral-600">{card.age ?? "-"}세 / {card.region} / {card.job}</p>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          disabled={processing}
                          onClick={() => void handleOneOnOneMatchAction(match.id, "source_accept")}
                          className="inline-flex h-8 items-center rounded-md bg-emerald-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                        >
                          {processing ? "처리 중..." : "최종 수락"}
                        </button>
                        <button
                          type="button"
                          disabled={processing}
                          onClick={() => void handleOneOnOneMatchAction(match.id, "source_reject")}
                          className="inline-flex h-8 items-center rounded-md border border-red-300 bg-white px-3 text-xs font-medium text-red-700 disabled:opacity-50"
                        >
                          거절
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {mutualAcceptedMatches.length > 0 && (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
              <p className="text-sm font-semibold text-emerald-900">쌍방 수락 완료</p>
              <div className="mt-3 space-y-2">
                {mutualAcceptedMatches.map((match) => {
                  const card = match.counterparty_card;
                  const processing = processingOneOnOneMatchIds.includes(match.id);
                  const contactProcessing = processingOneOnOneContactExchangeIds.includes(match.id);
                  if (!card) return null;
                  const isApplicant = match.role === "source";
                  const isLegacyContactFlow = isLegacyOneOnOneContactFlow(match);
                  const { selfConsented, otherConsented } = getOneOnOneConsentState(match);
                  return (
                    <div key={match.id} className="rounded-lg border border-emerald-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-neutral-900">{card.name} / {card.age ?? "-"}세 / {card.region}</p>
                        <div className="flex flex-wrap gap-1">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${oneOnOneMatchStateColor[match.state]}`}>{oneOnOneMatchStateText[match.state]}</span>
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${oneOnOneContactExchangeColor[match.contact_exchange_status]}`}>{getOneOnOneContactExchangeBadgeText(match)}</span>
                        </div>
                      </div>
                      <div className="mt-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-xs text-neutral-700">
                        {isLegacyContactFlow && match.contact_exchange_status === "none" ? (
                          <>
                            <p className="font-semibold text-neutral-900">기존 매칭 번호 공개 동의</p>
                            <p className="mt-1">기존 쌍방 매칭은 지원 받은 사람이 먼저 번호 공개에 동의하고, 이후 지원한 사람이 입금 확인 요청을 하면 관리자 승인 후 번호가 공개됩니다.</p>
                            <p className="mt-2 text-[11px] text-neutral-500">{selfConsented ? "내 동의 완료" : "내 동의 필요"} · {otherConsented ? "상대 동의 완료" : "상대 동의 대기"}</p>
                            {!selfConsented && match.role === "candidate" ? (
                              <button
                                type="button"
                                disabled={contactProcessing}
                                onClick={() => void handleRequestOneOnOneContactExchange(match.id)}
                                className="mt-2 inline-flex h-8 items-center rounded-md bg-emerald-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                              >
                                {contactProcessing ? "동의 저장 중..." : "번호 공개 동의"}
                              </button>
                            ) : null}
                            {!selfConsented && match.role === "source" ? <p className="mt-2">상대가 먼저 번호 공개 동의를 하면, 그다음에 입금 확인 요청을 진행할 수 있습니다.</p> : null}
                            {!selfConsented && otherConsented && match.role === "source" ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                <a href={OPEN_KAKAO_URL} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded-md border border-amber-300 bg-white px-3 text-xs font-medium text-amber-700 hover:bg-amber-50">오픈카톡 문의</a>
                                <button
                                  type="button"
                                  disabled={contactProcessing}
                                  onClick={() => void handleRequestOneOnOneContactExchange(match.id)}
                                  className="inline-flex h-8 items-center rounded-md bg-emerald-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                                >
                                  {contactProcessing ? "요청 중..." : "입금 확인 요청"}
                                </button>
                              </div>
                            ) : null}
                          </>
                        ) : null}
                        {isLegacyContactFlow && match.contact_exchange_status === "awaiting_applicant_payment" ? (
                          isApplicant ? (
                            <>
                              <p className="font-semibold text-neutral-900">입금 확인 대기</p>
                              <p className="mt-1">상대가 번호 공개에 동의했습니다. 오픈카톡으로 문의한 뒤 입금 확인 요청을 보내 주세요.</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <a href={OPEN_KAKAO_URL} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded-md border border-amber-300 bg-white px-3 text-xs font-medium text-amber-700 hover:bg-amber-50">오픈카톡 문의</a>
                                <button
                                  type="button"
                                  disabled={contactProcessing}
                                  onClick={() => void handleRequestOneOnOneContactExchange(match.id)}
                                  className="inline-flex h-8 items-center rounded-md bg-emerald-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                                >
                                  {contactProcessing ? "요청 중..." : "입금 확인 요청"}
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <p className="font-semibold text-neutral-900">입금 확인 대기</p>
                              <p className="mt-1">번호 공개 동의가 저장되었습니다. 상대가 입금 확인 요청을 하면 관리자 승인 후 번호가 공개됩니다.</p>
                            </>
                          )
                        ) : null}
                        {!isLegacyContactFlow && match.contact_exchange_status === "awaiting_applicant_payment" ? (
                          isApplicant ? (
                            <>
                              <p className="font-semibold text-neutral-900">번호 교환 대기</p>
                              <p className="mt-1">번호 교환을 원하면 오픈카톡으로 문의해 주세요. 닉네임과 매칭 ID를 보내주시면 확인 후 연결을 열어드립니다.</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <a href={OPEN_KAKAO_URL} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded-md border border-amber-300 bg-white px-3 text-xs font-medium text-amber-700 hover:bg-amber-50">오픈카톡 문의</a>
                                <button
                                  type="button"
                                  disabled={contactProcessing}
                                  onClick={() => void handleRequestOneOnOneContactExchange(match.id)}
                                  className="inline-flex h-8 items-center rounded-md bg-emerald-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                                >
                                  {contactProcessing ? "요청 중..." : "입금 확인 요청"}
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <p className="font-semibold text-neutral-900">번호 교환 대기</p>
                              <p className="mt-1">상대가 연결 오픈을 요청하면 관리자 확인 후 번호가 공개됩니다.</p>
                            </>
                          )
                        ) : null}
                        {match.contact_exchange_status === "payment_pending_admin" ? (
                          <>
                            <p className="font-semibold text-neutral-900">입금 확인 중</p>
                            <p className="mt-1">관리자 확인 후 양쪽 번호가 자동으로 공개됩니다. 잠시만 기다려 주세요.</p>
                          </>
                        ) : null}
                        {match.contact_exchange_status === "approved" ? (
                          <>
                            <p className="font-semibold text-neutral-900">번호 교환 완료</p>
                            <p className="mt-1 text-sm font-semibold text-emerald-700">{match.counterparty_phone ?? "번호 정보를 불러오는 중입니다."}</p>
                            <p className="mt-1 text-[11px] text-neutral-500">공개된 번호의 외부 공유, 무단 저장, 불쾌한 연락은 제재 대상입니다.</p>
                          </>
                        ) : null}
                      </div>
                      {match.contact_exchange_status !== "approved" ? (
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            disabled={processing}
                            onClick={() => void handleOneOnOneMatchAction(match.id, "cancel_mutual")}
                            className="inline-flex h-8 items-center rounded-md border border-rose-300 bg-white px-3 text-xs font-medium text-rose-700 disabled:opacity-50"
                          >
                            {processing ? "취소 중..." : "매칭 취소"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      <DatingAdultNotice />

      <section className="mt-4 rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-neutral-900">이용 전 확인</h2>
        <div className="mt-3 space-y-2 text-sm text-neutral-700">
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={consentFakeInfo} onChange={(e) => setConsentFakeInfo(e.target.checked)} className="mt-1" />
            허위 정보 작성 시 이용이 제한될 수 있음을 확인했습니다.
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={consentNoShow} onChange={(e) => setConsentNoShow(e.target.checked)} className="mt-1" />
            노쇼나 무단 취소 시 재이용이 제한될 수 있음을 확인했습니다.
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={consentFee} onChange={(e) => setConsentFee(e.target.checked)} className="mt-1" />
            번호 교환 진행 시 매칭비가 발생하고, 쌍방 수락 후 승인되면 전화번호가 공개될 수 있음을 확인했습니다.
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={consentPrivacy} onChange={(e) => setConsentPrivacy(e.target.checked)} className="mt-1" />
            개인정보가 매칭 진행 목적에 한해 사용됨을 확인했습니다.
          </label>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-neutral-900">{isEditMode ? "신청서 수정" : "신청 작성"}</h2>
        <p className="mt-1 text-xs text-neutral-500">로그인 + 휴대폰 인증 + 작성 권한 승인 상태에서만 신청이 가능합니다.</p>
        <p className="mt-1 text-xs text-neutral-500">접수중 상태일 때만 본인 신청서를 수정할 수 있습니다.</p>
        <details className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-neutral-800">1:1 진행 방식 간단히 보기</summary>
          <div className="mt-2 space-y-1 text-xs leading-5 text-neutral-600">
            <p>1. 신청서를 올리면 운영자가 후보 연결을 진행합니다.</p>
            <p>2. 서로 수락되면 지원한 사람에게 번호 교환 안내가 뜹니다.</p>
            <p>3. 매칭비 확인 후 관리자 승인으로 양쪽 번호가 공개됩니다.</p>
          </div>
        </details>
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
