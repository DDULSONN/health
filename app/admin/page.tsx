"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { timeAgo, type Post, type Report } from "@/lib/community";

type Tab = "reports" | "posts";

export default function AdminPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("reports");
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<Report[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);

  // admin 체크
  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login?redirect=/admin"); return; }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", user.id)
        .single();

      if (profile?.role !== "admin") { router.push("/"); return; }
      setAuthorized(true);
      setLoading(false);
    })();
  }, [router]);

  const loadReports = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("reports")
      .select("*")
      .order("created_at", { ascending: false });
    setReports(data ?? []);
  }, []);

  const loadPosts = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("posts")
      .select("*, profiles(nickname)")
      .order("created_at", { ascending: false })
      .limit(50);
    setPosts((data as Post[]) ?? []);
  }, []);

  useEffect(() => {
    if (!authorized) return;
    if (tab === "reports") loadReports();
    else loadPosts();
  }, [tab, authorized, loadReports, loadPosts]);

  const resolveReport = async (reportId: string) => {
    await fetch(`/api/admin/reports/${reportId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved: true }),
    });
    loadReports();
  };

  const toggleHidden = async (postId: string, currentHidden: boolean) => {
    await fetch(`/api/admin/posts/${postId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_hidden: !currentHidden }),
    });
    loadPosts();
  };

  if (loading || !authorized) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-10">
        <p className="text-neutral-400 text-center">확인 중...</p>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-neutral-900 mb-4">관리자</h1>

      <div className="flex rounded-xl border border-neutral-300 overflow-hidden mb-5">
        {(["reports", "posts"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 h-11 text-sm font-medium transition-colors ${
              tab === t ? "bg-neutral-800 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            {t === "reports" ? "신고 목록" : "게시글 관리"}
          </button>
        ))}
      </div>

      {/* 신고 */}
      {tab === "reports" && (
        <div className="space-y-2">
          {reports.length === 0 ? (
            <p className="text-neutral-400 text-center py-10">신고 내역이 없습니다.</p>
          ) : (
            reports.map((r) => (
              <div key={r.id} className={`rounded-xl border p-3 ${r.resolved ? "bg-neutral-50 border-neutral-100" : "bg-white border-neutral-200"}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${r.resolved ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                    {r.resolved ? "처리됨" : "미처리"}
                  </span>
                  <span className="text-xs text-neutral-400">{r.target_type} · {timeAgo(r.created_at)}</span>
                </div>
                <p className="text-sm text-neutral-800">{r.reason}</p>
                <p className="text-xs text-neutral-400 mt-1">대상 ID: {r.target_id}</p>
                {!r.resolved && (
                  <button
                    type="button"
                    onClick={() => resolveReport(r.id)}
                    className="mt-2 px-3 py-1 text-xs rounded-lg bg-green-600 text-white hover:bg-green-700"
                  >
                    처리 완료
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* 게시글 관리 */}
      {tab === "posts" && (
        <div className="space-y-2">
          {posts.length === 0 ? (
            <p className="text-neutral-400 text-center py-10">게시글이 없습니다.</p>
          ) : (
            posts.map((p) => (
              <div key={p.id} className={`rounded-xl border p-3 ${p.is_hidden ? "bg-red-50 border-red-100" : "bg-white border-neutral-200"}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-neutral-500">[{p.type}]</span>
                  <span className="text-sm font-medium text-neutral-900 truncate flex-1">{p.title}</span>
                  {p.is_hidden && <span className="text-xs text-red-600 font-medium">숨김</span>}
                </div>
                <p className="text-xs text-neutral-400">
                  {p.profiles?.nickname ?? "?"} · {timeAgo(p.created_at)}
                </p>
                <button
                  type="button"
                  onClick={() => toggleHidden(p.id, p.is_hidden)}
                  className={`mt-2 px-3 py-1 text-xs rounded-lg font-medium ${
                    p.is_hidden
                      ? "bg-emerald-600 text-white hover:bg-emerald-700"
                      : "bg-red-600 text-white hover:bg-red-700"
                  }`}
                >
                  {p.is_hidden ? "숨김 해제" : "숨기기"}
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </main>
  );
}
