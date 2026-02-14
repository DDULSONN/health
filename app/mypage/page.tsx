"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/community";
import MyLiftGrowthChart from "@/components/MyLiftGrowthChart";

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
    email: string | null;
  };
  weekly_win_count: number;
  bodycheck_posts: BodycheckPost[];
};

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
  certificates?: MyCertificate[] | null;
};

export default function MyPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [certRequests, setCertRequests] = useState<MyCertRequest[]>([]);
  const [error, setError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

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

        const [summaryRes, certRes] = await Promise.all([
          fetch("/api/mypage/summary", { cache: "no-store" }),
          fetch("/api/cert-requests", { cache: "no-store" }),
        ]);

        const summaryBody = (await summaryRes.json().catch(() => ({}))) as SummaryResponse & {
          error?: string;
        };
        const certBody = (await certRes.json().catch(() => ({}))) as {
          error?: string;
          requests?: MyCertRequest[];
        };

        if (!summaryRes.ok) {
          throw new Error(summaryBody.error ?? "마이페이지 정보를 불러오지 못했습니다.");
        }
        if (!certRes.ok) {
          throw new Error(certBody.error ?? "인증 신청 정보를 불러오지 못했습니다.");
        }

        if (isMounted) {
          setSummary(summaryBody);
          setCertRequests(certBody.requests ?? []);
          setError("");
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

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert("복사되었습니다.");
    } catch {
      alert("복사에 실패했습니다.");
    }
  };

  if (loading) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-10">
        <p className="text-neutral-400 text-center">불러오는 중...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-10">
        <p className="text-red-600 text-center">{error}</p>
      </main>
    );
  }

  const nickname = summary?.profile.nickname ?? "닉네임 미설정";
  const email = summary?.profile.email ?? "이메일 없음";
  const posts = summary?.bodycheck_posts ?? [];
  const weeklyWinCount = summary?.weekly_win_count ?? 0;

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <section className="rounded-2xl border border-neutral-200 bg-white p-5 mb-5">
        <h1 className="text-2xl font-bold text-neutral-900">마이페이지</h1>
        <p className="text-sm text-neutral-600 mt-1">{nickname}</p>
        <p className="text-xs text-neutral-500 mt-0.5">{email}</p>

        <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 p-3">
          <p className="text-sm font-semibold text-amber-800">내 주간 몸짱 선정 횟수</p>
          <p className="text-xl font-bold text-amber-900 mt-1">{weeklyWinCount}회</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/mypage#cert"
            className="px-4 min-h-[44px] rounded-xl border border-neutral-200 text-sm text-neutral-700 hover:bg-neutral-50 flex items-center"
          >
            내 인증 신청
          </Link>
          <Link
            href="/my-records"
            className="px-4 min-h-[44px] rounded-xl border border-neutral-200 text-sm text-neutral-700 hover:bg-neutral-50 flex items-center"
          >
            내 3대 기록
          </Link>
          <Link
            href="/certify"
            className="px-4 min-h-[44px] rounded-xl border border-neutral-200 text-sm text-neutral-700 hover:bg-neutral-50 flex items-center"
          >
            공식 인증 신청
          </Link>
          <Link
            href="/hall-of-fame"
            className="px-4 min-h-[44px] rounded-xl border border-neutral-200 text-sm text-neutral-700 hover:bg-neutral-50 flex items-center"
          >
            명예의 전당
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="px-4 min-h-[44px] rounded-xl bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-60"
          >
            로그아웃
          </button>
        </div>
      </section>

      <div className="mb-5">
        <MyLiftGrowthChart />
      </div>

      <section id="cert" className="mb-5">
        <h2 className="text-lg font-bold text-neutral-900 mb-3">내 인증 신청</h2>
        {certRequests.length === 0 ? (
          <p className="text-sm text-neutral-500 rounded-xl border border-neutral-200 bg-white p-4">
            인증 신청 내역이 없습니다.
          </p>
        ) : (
          <div className="space-y-3">
            {certRequests.map((item) => {
              const cert = item.certificates?.[0] ?? null;
              const verifyPath = cert ? `/cert/${cert.slug}` : "";
              return (
                <div key={item.id} className="rounded-2xl border border-neutral-200 bg-white p-4">
                  <p className="text-sm font-semibold text-neutral-900">
                    제출코드: <span className="font-bold">{item.submit_code}</span>
                  </p>
                  <p className="text-xs text-neutral-500 mt-1">
                    상태: {item.status} / 합계 {item.total}kg / {timeAgo(item.created_at)}
                  </p>
                  {item.status === "needs_info" && item.admin_note && (
                    <p className="text-xs text-amber-700 mt-2">관리자 요청: {item.admin_note}</p>
                  )}
                  {item.status === "rejected" && item.admin_note && (
                    <p className="text-xs text-red-700 mt-2">거절 사유: {item.admin_note}</p>
                  )}
                  {item.status === "approved" && cert && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <a
                        href={cert.pdf_url}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 h-9 rounded-lg bg-emerald-600 text-white text-xs font-medium flex items-center"
                      >
                        PDF 다운로드
                      </a>
                      <button
                        type="button"
                        onClick={() => {
                          const origin = typeof window !== "undefined" ? window.location.origin : "";
                          copyToClipboard(`${origin}${verifyPath}`);
                        }}
                        className="px-3 h-9 rounded-lg bg-neutral-900 text-white text-xs font-medium"
                      >
                        검증 링크 복사
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-bold text-neutral-900 mb-3">내 사진 몸평 게시글</h2>

        {posts.length === 0 ? (
          <p className="text-sm text-neutral-500 rounded-xl border border-neutral-200 bg-white p-4">
            아직 등록한 사진 몸평 게시글이 없습니다.
          </p>
        ) : (
          <div className="space-y-3">
            {posts.map((post) => (
              <Link
                key={post.id}
                href={`/community/${post.id}`}
                className="block rounded-2xl border border-neutral-200 bg-white p-4 hover:border-emerald-300 transition-all"
              >
                <div className="flex gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-neutral-400">{timeAgo(post.created_at)}</p>
                    <p className="text-sm font-semibold text-neutral-900 truncate mt-1">{post.title}</p>
                    <p className="text-xs text-indigo-700 mt-1">
                      평균 {post.average_score.toFixed(2)} / 투표 {post.vote_count}
                    </p>
                  </div>
                  {(post.images?.length ?? 0) > 0 && (
                    <img
                      src={post.images?.[0]}
                      alt=""
                      className="w-16 h-16 rounded-lg object-cover border border-neutral-100 shrink-0"
                    />
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
