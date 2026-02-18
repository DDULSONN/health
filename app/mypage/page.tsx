"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/community";
import { formatRemainingToKorean } from "@/lib/dating-open";
import { normalizeNickname, validateNickname } from "@/lib/nickname";
import MyLiftGrowthChart from "@/components/MyLiftGrowthChart";
import AdminCertReviewPanel from "@/components/AdminCertReviewPanel";

type MyPageTab = "my_cert" | "request_status" | "admin_review";

type BodycheckPost = {
  id: string;
  title: string;
  created_at: string;
  score_sum: number;
  vote_count: number;
  average_score: number;
  images: string[] | null;
};

type SummaryResponse = {
  profile: {
    nickname: string | null;
    nickname_changed_count: number;
    nickname_change_credits: number;
    email: string | null;
  };
  weekly_win_count: number;
  bodycheck_posts: BodycheckPost[];
};

type DatingApplicationStatus = {
  id: string;
  created_at: string;
  status: string;
  approved_for_public: boolean;
  display_nickname: string | null;
  age: number | null;
  training_years: number | null;
};

type MyDatingCard = {
  id: string;
  sex: "male" | "female";
  display_nickname: string;
  age: number | null;
  region: string | null;
  status: "pending" | "public" | "expired" | "hidden";
  published_at: string | null;
  expires_at: string | null;
  created_at: string;
};

type ReceivedCardApplication = {
  id: string;
  card_id: string;
  applicant_user_id: string;
  applicant_display_nickname: string | null;
  age: number | null;
  height_cm: number | null;
  region: string | null;
  job: string | null;
  training_years: number | null;
  intro_text: string | null;
  status: "submitted" | "accepted" | "rejected" | "canceled";
  created_at: string;
  instagram_id: string | null;
  photo_signed_urls?: string[];
};

type DatingConnection = {
  application_id: string;
  card_id: string;
  created_at: string;
  role: "owner" | "applicant";
  other_user_id: string;
  other_nickname: string;
  my_instagram_id: string | null;
  other_instagram_id: string | null;
};

type AdminOpenCard = {
  id: string;
  owner_user_id: string;
  owner_nickname: string | null;
  sex: "male" | "female";
  display_nickname: string | null;
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  ideal_type: string | null;
  instagram_id: string | null;
  total_3lift: number | null;
  percent_all: number | null;
  is_3lift_verified: boolean;
  photo_paths: string[] | null;
  blur_thumb_path: string | null;
  status: "pending" | "public" | "expired" | "hidden";
  published_at: string | null;
  expires_at: string | null;
  created_at: string;
};

type AdminOpenCardApplication = {
  id: string;
  card_id: string;
  applicant_user_id: string;
  applicant_nickname: string | null;
  applicant_display_nickname: string | null;
  age: number | null;
  height_cm: number | null;
  region: string | null;
  job: string | null;
  training_years: number | null;
  intro_text: string | null;
  instagram_id: string;
  photo_paths: string[];
  status: "submitted" | "accepted" | "rejected" | "canceled";
  created_at: string;
};

type AdminCardSort = "public_first" | "pending_first" | "newest" | "oldest";

type MyCertificate = {
  id: string;
  certificate_no: string;
  slug: string;
  pdf_url: string;
  issued_at: string;
};

type MyCertRequest = {
  id: string;
  submit_code: string;
  status: "pending" | "needs_info" | "approved" | "rejected";
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  sex: "male" | "female";
  bodyweight: number | null;
  squat: number;
  bench: number;
  deadlift: number;
  total: number;
  video_url?: string | null;
  certificates?: MyCertificate[] | null;
};

type ChangeNicknameResult = {
  success: boolean;
  code: string;
  message: string;
  nickname?: string;
  nickname_changed_count?: number;
  nickname_change_credits?: number;
};

export default function MyPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [certRequests, setCertRequests] = useState<MyCertRequest[]>([]);
  const [datingApplication, setDatingApplication] = useState<DatingApplicationStatus | null>(null);
  const [myDatingCards, setMyDatingCards] = useState<MyDatingCard[]>([]);
  const [receivedApplications, setReceivedApplications] = useState<ReceivedCardApplication[]>([]);
  const [datingConnections, setDatingConnections] = useState<DatingConnection[]>([]);
  const [adminOpenCards, setAdminOpenCards] = useState<AdminOpenCard[]>([]);
  const [adminOpenCardApplications, setAdminOpenCardApplications] = useState<AdminOpenCardApplication[]>([]);
  const [adminCardSort, setAdminCardSort] = useState<AdminCardSort>("public_first");
  const [isAdmin, setIsAdmin] = useState(false);
  const [activeTab, setActiveTab] = useState<MyPageTab>("my_cert");
  const [error, setError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

  const [nicknameOpen, setNicknameOpen] = useState(false);
  const [newNickname, setNewNickname] = useState("");
  const [nicknameError, setNicknameError] = useState("");
  const [nicknameInfo, setNicknameInfo] = useState("");
  const [savingNickname, setSavingNickname] = useState(false);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          router.replace("/login?redirect=/mypage");
          return;
        }

        const [summaryRes, certRes, adminRes, datingRes, receivedRes, connectionsRes] = await Promise.all([
          fetch("/api/mypage/summary", { cache: "no-store" }),
          fetch("/api/cert-requests", { cache: "no-store" }),
          fetch("/api/admin/me", { cache: "no-store" }),
          fetch("/api/dating/my-application", { cache: "no-store" }),
          fetch("/api/dating/cards/my/received", { cache: "no-store" }),
          fetch("/api/dating/cards/my/connections", { cache: "no-store" }),
        ]);

        const summaryBody = (await summaryRes.json().catch(() => ({}))) as SummaryResponse & {
          error?: string;
        };
        const certBody = (await certRes.json().catch(() => ({}))) as {
          error?: string;
          requests?: MyCertRequest[];
        };
        const adminBody = (await adminRes.json().catch(() => ({}))) as { isAdmin?: boolean };
        const datingBody = (await datingRes.json().catch(() => ({}))) as {
          error?: string;
          application?: DatingApplicationStatus | null;
        };
        const receivedBody = (await receivedRes.json().catch(() => ({}))) as {
          error?: string;
          cards?: MyDatingCard[];
          applications?: ReceivedCardApplication[];
        };
        const connectionsBody = (await connectionsRes.json().catch(() => ({}))) as {
          error?: string;
          items?: DatingConnection[];
        };

        if (!summaryRes.ok) {
          throw new Error(summaryBody.error ?? "留덉씠?섏씠吏 ?뺣낫瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??");
        }
        if (!certRes.ok) {
          throw new Error(certBody.error ?? "?몄쬆 ?붿껌 ?뺣낫瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??");
        }
        if (!receivedRes.ok) {
          throw new Error(receivedBody.error ?? "??移대뱶 吏?먯옄瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??");
        }
        if (!connectionsRes.ok) {
          throw new Error(connectionsBody.error ?? "?몄뒪? 援먰솚 ?뺣낫瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??");
        }

        if (isMounted) {
          const adminFlag = Boolean(adminBody.isAdmin);
          setSummary(summaryBody);
          setCertRequests(certBody.requests ?? []);
          setIsAdmin(adminFlag);
          setDatingApplication(datingBody.application ?? null);
          setMyDatingCards(receivedBody.cards ?? []);
          setReceivedApplications(receivedBody.applications ?? []);
          setDatingConnections(connectionsBody.items ?? []);
          setError("");

          if (adminFlag) {
            const overviewRes = await fetch("/api/dating/cards/admin/overview", { cache: "no-store" });
            const overviewBody = (await overviewRes.json().catch(() => ({}))) as {
              error?: string;
              cards?: AdminOpenCard[];
              applications?: AdminOpenCardApplication[];
            };
            if (!overviewRes.ok) {
              throw new Error(overviewBody.error ?? "愿由ъ옄 ?ㅽ뵂移대뱶 ?곗씠?곕? 遺덈윭?ㅼ? 紐삵뻽?듬땲??");
            }
            if (isMounted) {
              setAdminOpenCards(overviewBody.cards ?? []);
              setAdminOpenCardApplications(overviewBody.applications ?? []);
            }
          } else {
            setAdminOpenCards([]);
            setAdminOpenCardApplications([]);
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (isMounted) setError(message);
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [router, supabase]);

  useEffect(() => {
    if (!isAdmin && activeTab === "admin_review") {
      setActiveTab("my_cert");
    }
  }, [isAdmin, activeTab]);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  const handleCardApplicationStatus = async (
    applicationId: string,
    nextStatus: "accepted" | "rejected"
  ) => {
    const res = await fetch(`/api/dating/cards/applications/${applicationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      alert(body.error ?? "?곹깭 蹂寃쎌뿉 ?ㅽ뙣?덉뒿?덈떎.");
      return;
    }

    setReceivedApplications((prev) =>
      prev.map((app) =>
        app.id === applicationId
          ? {
              ...app,
              status: nextStatus,
            }
          : app
      )
    );
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert("蹂듭궗?섏뿀?듬땲??");
    } catch {
      alert("蹂듭궗???ㅽ뙣?덉뒿?덈떎.");
    }
  };

  const handleAdminDeleteOpenCard = async (cardId: string) => {
    if (!confirm("해당 오픈카드를 삭제할까요?")) return;
    const res = await fetch(`/api/admin/dating/cards/${cardId}`, {
      method: "DELETE",
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      alert(body.error ?? "카드 삭제에 실패했습니다.");
      return;
    }
    setAdminOpenCards((prev) => prev.filter((card) => card.id !== cardId));
    setAdminOpenCardApplications((prev) => prev.filter((app) => app.card_id !== cardId));
  };

  const handleChangeNickname = async () => {
    const normalized = normalizeNickname(newNickname);
    const invalid = validateNickname(normalized);
    if (invalid) {
      setNicknameError(invalid);
      return;
    }

    setSavingNickname(true);
    setNicknameError("");
    setNicknameInfo("");

    try {
      const { data, error: rpcError } = await supabase.rpc("change_nickname", {
        new_nickname: normalized,
      });

      if (rpcError) {
        setNicknameError(rpcError.message);
        return;
      }

      const result = data as ChangeNicknameResult | null;
      if (!result?.success) {
        const message = result?.message ?? "?됰꽕??蹂寃쎌뿉 ?ㅽ뙣?덉뒿?덈떎.";
        setNicknameError(message);
        return;
      }

      setNicknameInfo("?됰꽕?꾩씠 蹂寃쎈릺?덉뒿?덈떎.");
      setNicknameOpen(false);
      setNewNickname("");

      setSummary((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          profile: {
            ...prev.profile,
            nickname: result.nickname ?? prev.profile.nickname,
            nickname_changed_count:
              typeof result.nickname_changed_count === "number"
                ? result.nickname_changed_count
                : prev.profile.nickname_changed_count,
            nickname_change_credits:
              typeof result.nickname_change_credits === "number"
                ? result.nickname_change_credits
                : prev.profile.nickname_change_credits,
          },
        };
      });
    } catch (e) {
      setNicknameError(e instanceof Error ? e.message : "?됰꽕??蹂寃쎌뿉 ?ㅽ뙣?덉뒿?덈떎.");
    } finally {
      setSavingNickname(false);
    }
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-center text-neutral-400">遺덈윭?ㅻ뒗 以?..</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-center text-red-600">{error}</p>
      </main>
    );
  }

  const nickname = summary?.profile.nickname ?? "닉네임 미설정";
  const email = summary?.profile.email ?? "이메일 없음";
  const posts = summary?.bodycheck_posts ?? [];
  const weeklyWinCount = summary?.weekly_win_count ?? 0;
  const changedCount = summary?.profile.nickname_changed_count ?? 0;
  const credits = summary?.profile.nickname_change_credits ?? 0;
  const canChangeNickname = changedCount < 1 || credits > 0;
  const remainingFree = Math.max(0, 1 - changedCount);

  const approvedRequests = certRequests.filter(
    (item) => item.status === "approved" && (item.certificates?.length ?? 0) > 0
  );
  const datingStatusText: Record<string, string> = {
    submitted: "접수",
    reviewing: "검토 중",
    interview: "인터뷰",
    matched: "매칭 완료",
    rejected: "보류/거절",
  };
  const datingStatusColor: Record<string, string> = {
    submitted: "bg-neutral-100 text-neutral-700",
    reviewing: "bg-blue-100 text-blue-700",
    interview: "bg-purple-100 text-purple-700",
    matched: "bg-emerald-100 text-emerald-700",
    rejected: "bg-red-100 text-red-700",
  };
  const cardAppStatusText: Record<string, string> = {
    submitted: "대기",
    accepted: "수락",
    rejected: "거절",
    canceled: "취소",
  };
  const cardAppStatusColor: Record<string, string> = {
    submitted: "bg-neutral-100 text-neutral-700",
    accepted: "bg-emerald-100 text-emerald-700",
    rejected: "bg-red-100 text-red-700",
    canceled: "bg-neutral-200 text-neutral-600",
  };
  const myCardsById = new Map(myDatingCards.map((card) => [card.id, card]));
  const sortedAdminOpenCards = useMemo(() => {
    const statusRankPublicFirst: Record<AdminOpenCard["status"], number> = {
      public: 0,
      pending: 1,
      hidden: 2,
      expired: 3,
    };
    const statusRankPendingFirst: Record<AdminOpenCard["status"], number> = {
      pending: 0,
      public: 1,
      hidden: 2,
      expired: 3,
    };

    const items = [...adminOpenCards];
    items.sort((a, b) => {
      if (adminCardSort === "newest") {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      if (adminCardSort === "oldest") {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      if (adminCardSort === "public_first") {
        const diff = statusRankPublicFirst[a.status] - statusRankPublicFirst[b.status];
        if (diff !== 0) return diff;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      const diff = statusRankPendingFirst[a.status] - statusRankPendingFirst[b.status];
      if (diff !== 0) return diff;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    return items;
  }, [adminOpenCards, adminCardSort]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5">
        <h1 className="text-2xl font-bold text-neutral-900">留덉씠?섏씠吏</h1>
        <p className="mt-1 text-sm text-neutral-600">{nickname}</p>
        <p className="mt-0.5 text-xs text-neutral-500">{email}</p>

        <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-neutral-800">닉네임</p>
              <p className="mt-1 text-xs text-neutral-600">
                {remainingFree > 0
                  ? `臾대즺 蹂寃?${remainingFree}???⑥쓬`
                  : credits > 0
                  ? `異붽? 蹂寃쎄텒 ${credits}媛?蹂댁쑀`
                  : "臾대즺 蹂寃??꾨즺"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setNicknameOpen(true);
                setNicknameError("");
                setNicknameInfo("");
                setNewNickname("");
              }}
              disabled={!canChangeNickname}
              className="min-h-[40px] rounded-lg border border-neutral-300 px-3 text-sm font-medium text-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ?됰꽕??蹂寃?            </button>
          </div>
          {!canChangeNickname && (
            <p className="mt-2 text-xs text-amber-700">
              ?됰꽕??蹂寃쎌? 1??臾대즺?낅땲?? 異붽? 蹂寃쎌? 以鍮?以묒엯?덈떎.
            </p>
          )}
          {nicknameInfo && <p className="mt-2 text-xs text-emerald-700">{nicknameInfo}</p>}
        </div>

        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-800">二쇨컙 紐몄㎟ ?좎젙 ?잛닔</p>
          <p className="mt-1 text-xl font-bold text-amber-900">{weeklyWinCount}회</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/my-records"
            className="flex min-h-[44px] items-center rounded-xl border border-neutral-200 px-4 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            ??3? 湲곕줉
          </Link>
          <Link
            href="/certify"
            className="flex min-h-[44px] items-center rounded-xl border border-neutral-200 px-4 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            怨듭떇 ?몄쬆 ?붿껌
          </Link>
          {isAdmin && (
            <>
              <Link
                href="/admin/dating"
                className="flex min-h-[44px] items-center rounded-xl border border-pink-200 bg-pink-50 px-4 text-sm font-medium text-pink-700 hover:bg-pink-100"
              >
                ?뚭컻??愿由?              </Link>
              <Link
                href="/admin/dating/cards"
                className="flex min-h-[44px] items-center rounded-xl border border-violet-200 bg-violet-50 px-4 text-sm font-medium text-violet-700 hover:bg-violet-100"
              >
                移대뱶 紐⑤뜑?덉씠??              </Link>
            </>
          )}
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="min-h-[44px] rounded-xl bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            濡쒓렇?꾩썐
          </button>
        </div>
      </section>

      <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="text-lg font-bold text-neutral-900 mb-3">?뚭컻???좎껌 ?꾪솴</h2>
        {datingApplication ? (
          <div className="space-y-2 text-sm">
            <p className="text-neutral-600">
              ?좎껌?? <span className="text-neutral-900">{new Date(datingApplication.created_at).toLocaleString("ko-KR")}</span>
            </p>
            <p className="text-neutral-600">
              ?곹깭:{" "}
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${datingStatusColor[datingApplication.status] ?? "bg-neutral-100 text-neutral-700"}`}>
                {datingStatusText[datingApplication.status] ?? datingApplication.status}
              </span>
            </p>
            <p className="text-neutral-600">
              怨듦컻 ?뱀씤:{" "}
              <span className={datingApplication.approved_for_public ? "text-emerald-700 font-medium" : "text-neutral-500"}>
                {datingApplication.approved_for_public ? "승인됨" : "미승인"}
              </span>
            </p>
            <div className="flex flex-wrap gap-2 text-xs text-neutral-600">
              {datingApplication.display_nickname && <span>?됰꽕?? {datingApplication.display_nickname}</span>}
              {datingApplication.age != null && <span>?섏씠: {datingApplication.age}세</span>}
              {datingApplication.training_years != null && <span>?대룞寃쎈젰: {datingApplication.training_years}년</span>}
            </div>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">?뚭컻???좎껌 ?댁뿭???놁뒿?덈떎.</p>
        )}
        <div className="mt-4">
          <Link
            href="/dating/apply"
            className="inline-flex min-h-[42px] items-center rounded-lg bg-pink-500 px-4 text-sm font-medium text-white hover:bg-pink-600"
          >
            ?좎껌?섎윭 媛湲?          </Link>
        </div>
      </section>

      <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="text-lg font-bold text-neutral-900 mb-3">???ㅽ뵂移대뱶 ?곹깭</h2>
        {myDatingCards.length === 0 ? (
          <p className="text-sm text-neutral-500">?깅줉???ㅽ뵂移대뱶媛 ?놁뒿?덈떎.</p>
        ) : (
          <div className="space-y-3">
            {myDatingCards.map((card) => (
              <div key={card.id} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-neutral-900">
                    {card.display_nickname} / {card.sex === "male" ? "?⑥옄" : "?ъ옄"}
                  </p>
                  <span className="inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
                    {card.status}
                  </span>
                </div>
                <p className="text-xs text-neutral-500 mt-1">
                  ?앹꽦?? {new Date(card.created_at).toLocaleDateString("ko-KR")}
                </p>
                {card.status === "public" && card.expires_at && (
                  <p className="text-sm text-amber-700 font-medium mt-1">
                    怨듦컻 以?쨌 ?⑥? ?쒓컙 {formatRemainingToKorean(card.expires_at)}
                  </p>
                )}
                {card.status === "pending" && (
                  <p className="text-sm text-neutral-600 mt-1">?湲곗뿴???깅줉?섏뼱 ?덉뒿?덈떎.</p>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <Link
            href="/dating/card/new"
            className="inline-flex min-h-[42px] items-center rounded-lg bg-pink-500 px-4 text-sm font-medium text-white hover:bg-pink-600"
          >
            ?ㅽ뵂移대뱶 ?묒꽦?섍린
          </Link>
          <Link
            href="/community/dating/cards"
            className="inline-flex min-h-[42px] items-center rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            ?ㅽ뵂移대뱶 蹂닿린
          </Link>
        </div>
      </section>

      <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="text-lg font-bold text-neutral-900 mb-3">??移대뱶 吏?먯옄</h2>
        {receivedApplications.length === 0 ? (
          <p className="text-sm text-neutral-500">?꾩쭅 諛쏆? 吏?먯꽌媛 ?놁뒿?덈떎.</p>
        ) : (
          <div className="space-y-3">
            {receivedApplications.map((app) => {
              const card = myCardsById.get(app.card_id);
              return (
                <div key={app.id} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-neutral-900">
                      移대뱶 {card?.sex === "male" ? "?⑥옄" : card?.sex === "female" ? "?ъ옄" : ""} / 吏?먯씪{" "}
                      {new Date(app.created_at).toLocaleDateString("ko-KR")}
                    </div>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        cardAppStatusColor[app.status] ?? "bg-neutral-100 text-neutral-700"
                      }`}
                    >
                      {cardAppStatusText[app.status] ?? app.status}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-600">
                    {app.applicant_display_nickname && <span>?됰꽕??{app.applicant_display_nickname}</span>}
                    {app.age != null && <span>?섏씠 {app.age}</span>}
                    {app.height_cm != null && <span>??{app.height_cm}cm</span>}
                    {app.region && <span>吏??{app.region}</span>}
                    {app.job && <span>吏곸뾽 {app.job}</span>}
                    {app.training_years != null && <span>?대룞 {app.training_years}년</span>}
                  </div>

                  {app.intro_text && (
                    <p className="mt-2 text-sm text-neutral-700 whitespace-pre-wrap break-words">{app.intro_text}</p>
                  )}

                  {Array.isArray(app.photo_signed_urls) && app.photo_signed_urls.length > 0 && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {app.photo_signed_urls.map((url, idx) => (
                        <a
                          key={`${app.id}-${idx}`}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="block overflow-hidden rounded-lg border border-neutral-200 bg-white"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={`吏?먯옄 ?ъ쭊 ${idx + 1}`}
                            className="h-32 w-full object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  )}

                  {app.status === "accepted" && app.instagram_id && (
                    <p className="mt-2 text-sm text-emerald-700 font-medium">吏?먯옄 ?몄뒪?: @{app.instagram_id}</p>
                  )}

                  {app.status === "submitted" && (
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleCardApplicationStatus(app.id, "accepted")}
                        className="h-9 rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white"
                      >
                        ?섎씫
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCardApplicationStatus(app.id, "rejected")}
                        className="h-9 rounded-lg bg-red-600 px-3 text-xs font-medium text-white"
                      >
                        嫄곗젅
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="text-lg font-bold text-neutral-900 mb-3">留ㅼ묶 ?몄뒪? 援먰솚</h2>
        {datingConnections.length === 0 ? (
          <p className="text-sm text-neutral-500">?꾩쭅 ?섎씫???곌껐???놁뒿?덈떎.</p>
        ) : (
          <div className="space-y-3">
            {datingConnections.map((item) => (
              <div key={item.application_id} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-sm font-medium text-neutral-900">{item.other_nickname}</p>
                <p className="text-xs text-neutral-500 mt-1">
                  ?곌껐?? {new Date(item.created_at).toLocaleDateString("ko-KR")}
                </p>
                {item.my_instagram_id && (
                  <p className="text-sm text-neutral-700 mt-2">???몄뒪?: @{item.my_instagram_id}</p>
                )}
                {item.other_instagram_id && (
                  <p className="text-sm text-emerald-700 font-medium mt-1">
                    ?곷? ?몄뒪?: @{item.other_instagram_id}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {isAdmin && (
        <section className="mb-5 rounded-2xl border border-violet-200 bg-violet-50/40 p-5">
          <h2 className="text-lg font-bold text-violet-900 mb-3">?ㅽ뵂移대뱶 ?꾩껜 ?댁슜 (愿由ъ옄)</h2>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-violet-800">
                移대뱶 {adminOpenCards.length}嫄?/ 吏?먯꽌 {adminOpenCardApplications.length}嫄?
              </h3>
              <select
                value={adminCardSort}
                onChange={(e) => setAdminCardSort(e.target.value as AdminCardSort)}
                className="h-8 rounded-md border border-violet-200 bg-white px-2 text-xs text-violet-800"
              >
                <option value="public_first">공개중 우선</option>
                <option value="pending_first">대기 우선</option>
                <option value="newest">최신순</option>
                <option value="oldest">오래된순</option>
              </select>
            </div>

            {adminOpenCards.length === 0 ? (
              <p className="text-sm text-neutral-600">?깅줉???ㅽ뵂移대뱶媛 ?놁뒿?덈떎.</p>
            ) : (
              <div className="space-y-2">
                {sortedAdminOpenCards.map((card) => (
                  <div key={card.id} className="rounded-xl border border-violet-200 bg-white p-3">
                    <p className="text-sm font-semibold text-neutral-900">
                      移대뱶 {card.id.slice(0, 8)}... / {card.display_nickname ?? "(?됰꽕???놁쓬)"} / {card.sex} / ?곹깭 {card.status}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-neutral-600">
                      <span>owner: {card.owner_nickname ?? card.owner_user_id.slice(0, 8)}</span>
                      {card.age != null && <span>?섏씠 {card.age}</span>}
                      {card.height_cm != null && <span>??{card.height_cm}cm</span>}
                      {card.region && <span>吏??{card.region}</span>}
                      {card.job && <span>吏곸뾽 {card.job}</span>}
                      {card.training_years != null && <span>?대룞 {card.training_years}년</span>}
                      {card.total_3lift != null && <span>3? {card.total_3lift}kg</span>}
                      {card.percent_all != null && <span>?곸쐞 {card.percent_all}%</span>}
                      <span>3??몄쬆 {card.is_3lift_verified ? "Y" : "N"}</span>
                    </div>
                    {card.instagram_id && (
                      <p className="mt-1 text-xs font-medium text-violet-700">
                        移대뱶 ?뚯쑀???몄뒪?: @{card.instagram_id}
                      </p>
                    )}
                    {card.ideal_type && (
                      <p className="mt-1 text-xs text-neutral-700 whitespace-pre-wrap break-words">
                        ?댁긽?? {card.ideal_type}
                      </p>
                    )}
                    {card.published_at && (
                      <p className="mt-1 text-xs text-emerald-700">
                        怨듦컻 ?쒖옉: {new Date(card.published_at).toLocaleString("ko-KR")}
                      </p>
                    )}
                    {card.expires_at && (
                      <p className="mt-1 text-xs text-amber-700">
                        留뚮즺 ?덉젙: {new Date(card.expires_at).toLocaleString("ko-KR")}
                      </p>
                    )}
                    {card.blur_thumb_path && (
                      <p className="mt-1 text-xs text-neutral-500 break-all">
                        blur 寃쎈줈: {card.blur_thumb_path}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-neutral-500 break-all">
                      ?ъ쭊 寃쎈줈: {Array.isArray(card.photo_paths) ? card.photo_paths.join(", ") : "-"}
                    </p>
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => void handleAdminDeleteOpenCard(card.id)}
                        className="h-8 rounded-md bg-red-600 px-3 text-xs font-medium text-white"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {adminOpenCardApplications.length === 0 ? (
              <p className="text-sm text-neutral-600">?깅줉??吏?먯꽌媛 ?놁뒿?덈떎.</p>
            ) : (
              <div className="space-y-2">
                {adminOpenCardApplications.map((app) => (
                  <div key={app.id} className="rounded-xl border border-violet-200 bg-white p-3">
                    <p className="text-sm font-semibold text-neutral-900">
                      吏?먯꽌 {app.id.slice(0, 8)}... / 移대뱶 {app.card_id.slice(0, 8)}... / ?곹깭 {app.status}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-neutral-600">
                      <span>吏?먯옄: {app.applicant_nickname ?? app.applicant_user_id.slice(0, 8)}</span>
                      {app.applicant_display_nickname && <span>?쒖떆 ?됰꽕?? {app.applicant_display_nickname}</span>}
                      {app.age != null && <span>?섏씠 {app.age}</span>}
                      {app.height_cm != null && <span>??{app.height_cm}cm</span>}
                      {app.region && <span>吏??{app.region}</span>}
                      {app.job && <span>吏곸뾽 {app.job}</span>}
                      {app.training_years != null && <span>?대룞 {app.training_years}년</span>}
                    </div>
                    <p className="mt-1 text-xs font-medium text-violet-700">?몄뒪?: @{app.instagram_id}</p>
                    {app.intro_text && (
                      <p className="mt-1 text-xs text-neutral-700 whitespace-pre-wrap break-words">
                        ?먭린?뚭컻: {app.intro_text}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-neutral-500 break-all">
                      ?ъ쭊 寃쎈줈: {Array.isArray(app.photo_paths) ? app.photo_paths.join(", ") : "-"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      <div className="mb-5">
        <MyLiftGrowthChart />
      </div>

      <section className="mb-5">
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("my_cert")}
            className={`h-10 rounded-xl border px-4 text-sm font-medium ${
              activeTab === "my_cert"
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-neutral-300 bg-white text-neutral-700"
            }`}
          >
            ???몄쬆
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("request_status")}
            className={`h-10 rounded-xl border px-4 text-sm font-medium ${
              activeTab === "request_status"
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-neutral-300 bg-white text-neutral-700"
            }`}
          >
            ?붿껌 ?꾪솴
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setActiveTab("admin_review")}
              className={`h-10 rounded-xl border px-4 text-sm font-medium ${
                activeTab === "admin_review"
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-300 bg-white text-neutral-700"
              }`}
            >
              愿由ъ옄 ?ъ궗
            </button>
          )}
        </div>

        {activeTab === "my_cert" && (
          <>
            <h2 className="mb-3 text-lg font-bold text-neutral-900">???몄쬆</h2>
            {approvedRequests.length === 0 ? (
              <p className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">
                諛쒓툒???몄쬆?쒓? ?놁뒿?덈떎.
              </p>
            ) : (
              <div className="space-y-3">
                {approvedRequests.map((item) => {
                  const cert = item.certificates?.[0];
                  if (!cert) return null;
                  const verifyPath = `/cert/${cert.slug}`;
                  return (
                    <div key={item.id} className="rounded-2xl border border-neutral-200 bg-white p-4">
                      <p className="text-sm font-semibold text-neutral-900">?몄쬆踰덊샇: {cert.certificate_no}</p>
                      <p className="mt-1 text-xs text-neutral-500">諛쒓툒?? {timeAgo(cert.issued_at)}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <a
                          href={cert.pdf_url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex h-9 items-center rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white"
                        >
                          PDF ?ㅼ슫濡쒕뱶
                        </a>
                        <button
                          type="button"
                          onClick={() => {
                            const origin = typeof window !== "undefined" ? window.location.origin : "";
                            copyToClipboard(`${origin}${verifyPath}`);
                          }}
                          className="h-9 rounded-lg bg-neutral-900 px-3 text-xs font-medium text-white"
                        >
                          寃利?留곹겕 蹂듭궗
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {activeTab === "request_status" && (
          <>
            <h2 className="mb-3 text-lg font-bold text-neutral-900">?붿껌 ?꾪솴</h2>
            {certRequests.length === 0 ? (
              <p className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">
                ?몄쬆 ?붿껌 ?댁뿭???놁뒿?덈떎.
              </p>
            ) : (
              <div className="space-y-3">
                {certRequests.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-neutral-200 bg-white p-4">
                    <p className="text-sm font-semibold text-neutral-900">
                      ?쒖텧肄붾뱶: <span className="font-bold">{item.submit_code}</span>
                    </p>
                    <p className="mt-1 text-xs text-neutral-500">
                      ?곹깭: {item.status} / ?⑷퀎 {item.total}kg / {timeAgo(item.created_at)}
                    </p>
                    {item.video_url && (
                      <p className="mt-1 break-all text-xs text-neutral-600">
                        ?곸긽 留곹겕:{" "}
                        <a href={item.video_url} target="_blank" rel="noreferrer" className="text-blue-600 underline">
                          {item.video_url}
                        </a>
                      </p>
                    )}
                    {item.status === "needs_info" && item.admin_note && (
                      <p className="mt-2 text-xs text-amber-700">愿由ъ옄 ?붿껌: {item.admin_note}</p>
                    )}
                    {item.status === "rejected" && item.admin_note && (
                      <p className="mt-2 text-xs text-red-700">嫄곗젅 ?ъ쑀: {item.admin_note}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === "admin_review" && (
          <>
            {isAdmin ? (
              <>
                <h2 className="mb-3 text-lg font-bold text-neutral-900">愿由ъ옄 ?ъ궗</h2>
                <AdminCertReviewPanel />
              </>
            ) : (
              <p className="text-sm text-red-600">403: ?묎렐 沅뚰븳???놁뒿?덈떎.</p>
            )}
          </>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold text-neutral-900">???ъ쭊 紐명룊 寃뚯떆湲</h2>

        {posts.length === 0 ? (
          <p className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">
            ?꾩쭅 ?깅줉???ъ쭊 紐명룊 寃뚯떆湲???놁뒿?덈떎.
          </p>
        ) : (
          <div className="space-y-3">
            {posts.map((post) => (
              <Link
                key={post.id}
                href={`/community/${post.id}`}
                className="block rounded-2xl border border-neutral-200 bg-white p-4 transition-all hover:border-emerald-300"
              >
                <div className="flex gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-neutral-400">{timeAgo(post.created_at)}</p>
                    <p className="mt-1 truncate text-sm font-semibold text-neutral-900">{post.title}</p>
                    <p className="mt-1 text-xs text-indigo-700">
                      ?됯퇏 {post.average_score.toFixed(2)} / ?ы몴 {post.vote_count}
                    </p>
                  </div>
                  {(post.images?.length ?? 0) > 0 && (
                    <img
                      src={post.images?.[0]}
                      alt=""
                      className="h-16 w-16 shrink-0 rounded-lg border border-neutral-100 object-cover"
                    />
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {nicknameOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-4 sm:items-center sm:justify-center">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4">
            <h3 className="text-base font-semibold text-neutral-900">닉네임 변경</h3>
            <p className="mt-1 text-xs text-neutral-600">2~12?? ?쒓?/?곷Ц/?レ옄/_留??ъ슜 媛?ν빀?덈떎.</p>

            <input
              type="text"
              value={newNickname}
              onChange={(e) => setNewNickname(e.target.value)}
              placeholder="새 닉네임"
              maxLength={12}
              className="mt-3 w-full min-h-[44px] rounded-lg border border-neutral-300 px-3 text-sm"
            />

            {nicknameError && <p className="mt-2 text-xs text-red-600">{nicknameError}</p>}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setNicknameOpen(false)}
                className="min-h-[42px] rounded-lg border border-neutral-300 text-sm font-medium text-neutral-700"
              >
                痍⑥냼
              </button>
              <button
                type="button"
                onClick={handleChangeNickname}
                disabled={savingNickname}
                className="min-h-[42px] rounded-lg bg-emerald-600 text-sm font-medium text-white disabled:opacity-50"
              >
                {savingNickname ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

