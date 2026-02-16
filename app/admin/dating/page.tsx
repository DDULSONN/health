"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Application = {
  id: string;
  sex: string;
  name: string;
  phone: string;
  phone_masked: string;
  region: string;
  height_cm: number;
  job: string;
  status: string;
  created_at: string;
};

type Detail = Application & {
  ideal_type: string;
  user_id: string;
  consent_privacy: boolean;
  consent_content: boolean;
  photo_urls: string[];
  signed_photos: string[];
};

const STATUS_LABELS: Record<string, string> = {
  submitted: "대기",
  reviewing: "검토중",
  matched: "매칭됨",
  rejected: "거절",
};

const STATUS_COLORS: Record<string, string> = {
  submitted: "bg-neutral-100 text-neutral-700",
  reviewing: "bg-blue-100 text-blue-700",
  matched: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
};

export default function AdminDatingPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [authChecked, setAuthChecked] = useState(false);
  const [list, setList] = useState<Application[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSex, setFilterSex] = useState("");
  const [loading, setLoading] = useState(false);

  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [revealPhone, setRevealPhone] = useState(false);

  // 인증 체크
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login?redirect=/admin/dating");
        return;
      }
      // admin 체크는 middleware에서 이미 처리
      setAuthChecked(true);
    })();
  }, [router, supabase]);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (filterStatus) params.set("status", filterStatus);
      if (filterSex) params.set("sex", filterSex);
      const res = await fetch(`/api/admin/dating?${params}`, { cache: "no-store" });
      if (!res.ok) return;
      const body = await res.json();
      setList(body.data ?? []);
      setTotal(body.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [page, filterStatus, filterSex]);

  useEffect(() => {
    if (authChecked) fetchList();
  }, [authChecked, fetchList]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setDetail(null);
    setRevealPhone(false);
    try {
      const res = await fetch(`/api/admin/dating/${id}`, { cache: "no-store" });
      if (!res.ok) return;
      const body = await res.json();
      setDetail(body);
    } finally {
      setDetailLoading(false);
    }
  };

  const changeStatus = async (id: string, newStatus: string) => {
    const res = await fetch(`/api/admin/dating/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
      fetchList();
      if (detail?.id === id) setDetail({ ...detail!, status: newStatus });
    }
  };

  if (!authChecked) {
    return <main className="max-w-4xl mx-auto px-4 py-8"><p className="text-sm text-neutral-500">로딩 중...</p></main>;
  }

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-neutral-900 mb-6">소개팅 신청 관리</h1>

      {/* 필터 */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
          className="h-9 rounded-lg border border-neutral-300 px-2 text-sm"
        >
          <option value="">전체 상태</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={filterSex}
          onChange={(e) => { setFilterSex(e.target.value); setPage(1); }}
          className="h-9 rounded-lg border border-neutral-300 px-2 text-sm"
        >
          <option value="">전체 성별</option>
          <option value="male">남자</option>
          <option value="female">여자</option>
        </select>
        <span className="text-sm text-neutral-500 self-center ml-2">총 {total}건</span>
      </div>

      {/* 목록 */}
      {loading ? (
        <p className="text-sm text-neutral-500">로딩 중...</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-neutral-500">신청 내역이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-neutral-500">
                <th className="py-2 pr-3">성별</th>
                <th className="py-2 pr-3">이름</th>
                <th className="py-2 pr-3">전화번호</th>
                <th className="py-2 pr-3">지역</th>
                <th className="py-2 pr-3">키</th>
                <th className="py-2 pr-3">직업</th>
                <th className="py-2 pr-3">상태</th>
                <th className="py-2 pr-3">날짜</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((item) => (
                <tr key={item.id} className="border-b border-neutral-100 hover:bg-neutral-50">
                  <td className="py-2 pr-3">{item.sex === "male" ? "남" : "여"}</td>
                  <td className="py-2 pr-3 font-medium">{item.name}</td>
                  <td className="py-2 pr-3 text-neutral-500">{item.phone_masked}</td>
                  <td className="py-2 pr-3">{item.region}</td>
                  <td className="py-2 pr-3">{item.height_cm}cm</td>
                  <td className="py-2 pr-3">{item.job}</td>
                  <td className="py-2 pr-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[item.status] ?? ""}`}>
                      {STATUS_LABELS[item.status] ?? item.status}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-neutral-400">{new Date(item.created_at).toLocaleDateString("ko-KR")}</td>
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={() => openDetail(item.id)}
                      className="text-xs text-rose-600 hover:underline"
                    >
                      상세
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 페이지네이션 */}
      {total > 20 && (
        <div className="flex gap-2 mt-4 justify-center">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="px-3 py-1 rounded border text-sm disabled:opacity-40"
          >
            이전
          </button>
          <span className="text-sm self-center text-neutral-600">
            {page} / {Math.ceil(total / 20)}
          </span>
          <button
            type="button"
            disabled={page >= Math.ceil(total / 20)}
            onClick={() => setPage(page + 1)}
            className="px-3 py-1 rounded border text-sm disabled:opacity-40"
          >
            다음
          </button>
        </div>
      )}

      {/* 상세 모달 */}
      {(detail || detailLoading) && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
          <div
            className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            {detailLoading ? (
              <p className="text-sm text-neutral-500">로딩 중...</p>
            ) : detail ? (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold">{detail.name}</h2>
                  <button type="button" onClick={() => setDetail(null)} className="text-neutral-400 hover:text-neutral-700 text-xl">×</button>
                </div>

                <div className="space-y-2 text-sm">
                  <p><span className="text-neutral-500">성별:</span> {detail.sex === "male" ? "남자" : "여자"}</p>
                  <p>
                    <span className="text-neutral-500">전화번호:</span>{" "}
                    {revealPhone ? detail.phone : maskPhone(detail.phone)}
                    {!revealPhone && (
                      <button type="button" onClick={() => setRevealPhone(true)} className="ml-2 text-xs text-blue-600 hover:underline">
                        보기
                      </button>
                    )}
                  </p>
                  <p><span className="text-neutral-500">지역:</span> {detail.region}</p>
                  <p><span className="text-neutral-500">키:</span> {detail.height_cm}cm</p>
                  <p><span className="text-neutral-500">직업:</span> {detail.job}</p>
                  <p><span className="text-neutral-500">이상형:</span></p>
                  <p className="bg-neutral-50 rounded-lg p-3 text-neutral-700 whitespace-pre-wrap">{detail.ideal_type}</p>
                  <p><span className="text-neutral-500">개인정보 동의:</span> {detail.consent_privacy ? "O" : "X"}</p>
                  <p><span className="text-neutral-500">콘텐츠 동의:</span> {detail.consent_content ? "O" : "X"}</p>
                </div>

                {/* 사진 */}
                {detail.signed_photos.length > 0 && (
                  <div className="mt-4">
                    <p className="text-sm font-medium text-neutral-700 mb-2">사진</p>
                    <div className="flex gap-3">
                      {detail.signed_photos.map((url, i) => (
                        url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={i} src={url} alt={`사진 ${i + 1}`} className="w-40 h-40 object-cover rounded-xl border" />
                        ) : null
                      ))}
                    </div>
                  </div>
                )}

                {/* 상태 변경 */}
                <div className="mt-5 pt-4 border-t border-neutral-200">
                  <p className="text-sm font-medium text-neutral-700 mb-2">
                    상태: <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[detail.status] ?? ""}`}>
                      {STATUS_LABELS[detail.status] ?? detail.status}
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {["submitted", "reviewing", "matched", "rejected"]
                      .filter((s) => s !== detail.status)
                      .map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => changeStatus(detail.id, s)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${STATUS_COLORS[s]}`}
                        >
                          {STATUS_LABELS[s]}으로 변경
                        </button>
                      ))}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </main>
  );
}

function maskPhone(phone: string): string {
  if (!phone || phone.length < 7) return phone ?? "";
  return phone.slice(0, 3) + "****" + phone.slice(-4);
}
