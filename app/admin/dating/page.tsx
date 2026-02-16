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
  age: number | null;
  display_nickname: string | null;
  total_3lift: number | null;
  percent_all: number | null;
  approved_for_public: boolean;
  thumb_blur_path: string | null;
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

  // Community fields editing
  const [editNickname, setEditNickname] = useState("");
  const [editAge, setEditAge] = useState("");
  const [editTotal3lift, setEditTotal3lift] = useState("");
  const [editPercentAll, setEditPercentAll] = useState("");
  const [saving, setSaving] = useState(false);
  const [thumbUploading, setThumbUploading] = useState(false);

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
      setEditNickname(body.display_nickname ?? "");
      setEditAge(body.age != null ? String(body.age) : "");
      setEditTotal3lift(body.total_3lift != null ? String(body.total_3lift) : "");
      setEditPercentAll(body.percent_all != null ? String(body.percent_all) : "");
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

                {/* 커뮤니티 공개 설정 */}
                <div className="mt-5 pt-4 border-t border-neutral-200">
                  <h3 className="text-sm font-bold text-neutral-800 mb-3">커뮤니티 공개 설정</h3>

                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <label className="text-sm text-neutral-600 w-24 shrink-0">공개 여부</label>
                      <button
                        type="button"
                        onClick={async () => {
                          const next = !detail.approved_for_public;
                          const res = await fetch(`/api/admin/dating/${detail.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ approved_for_public: next }),
                          });
                          if (res.ok) setDetail({ ...detail, approved_for_public: next });
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          detail.approved_for_public
                            ? "bg-emerald-100 text-emerald-700 border-emerald-300"
                            : "bg-neutral-100 text-neutral-500 border-neutral-300"
                        }`}
                      >
                        {detail.approved_for_public ? "공개 중" : "비공개"}
                      </button>
                    </div>

                    <div className="flex items-center gap-3">
                      <label className="text-sm text-neutral-600 w-24 shrink-0">닉네임</label>
                      <input
                        type="text"
                        value={editNickname}
                        onChange={(e) => setEditNickname(e.target.value)}
                        placeholder="공개 닉네임"
                        className="flex-1 h-8 rounded-lg border border-neutral-300 px-2 text-sm"
                      />
                    </div>

                    <div className="flex items-center gap-3">
                      <label className="text-sm text-neutral-600 w-24 shrink-0">나이</label>
                      <input
                        type="number"
                        value={editAge}
                        onChange={(e) => setEditAge(e.target.value)}
                        placeholder="나이"
                        min={18}
                        max={99}
                        className="w-24 h-8 rounded-lg border border-neutral-300 px-2 text-sm"
                      />
                    </div>

                    <div className="flex items-center gap-3">
                      <label className="text-sm text-neutral-600 w-24 shrink-0">3대 합계</label>
                      <input
                        type="number"
                        value={editTotal3lift}
                        onChange={(e) => setEditTotal3lift(e.target.value)}
                        placeholder="kg"
                        className="w-24 h-8 rounded-lg border border-neutral-300 px-2 text-sm"
                      />
                    </div>

                    <div className="flex items-center gap-3">
                      <label className="text-sm text-neutral-600 w-24 shrink-0">상위 %</label>
                      <input
                        type="number"
                        value={editPercentAll}
                        onChange={(e) => setEditPercentAll(e.target.value)}
                        placeholder="%"
                        step="0.1"
                        className="w-24 h-8 rounded-lg border border-neutral-300 px-2 text-sm"
                      />
                    </div>

                    <div className="flex items-center gap-3">
                      <label className="text-sm text-neutral-600 w-24 shrink-0">블러 썸네일</label>
                      <div className="flex items-center gap-2">
                        {detail.thumb_blur_path ? (
                          <span className="text-xs text-emerald-600">업로드됨</span>
                        ) : (
                          <span className="text-xs text-neutral-400">없음</span>
                        )}
                        <label className="px-3 py-1.5 rounded-lg text-xs font-medium border border-neutral-300 bg-neutral-50 hover:bg-neutral-100 cursor-pointer transition-colors">
                          {thumbUploading ? "업로드 중..." : "업로드"}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              setThumbUploading(true);
                              const fd = new FormData();
                              fd.append("file", file);
                              try {
                                const res = await fetch(`/api/admin/dating/${detail.id}/upload-thumb`, {
                                  method: "POST",
                                  body: fd,
                                });
                                if (res.ok) {
                                  const data = await res.json();
                                  setDetail({ ...detail, thumb_blur_path: data.path });
                                } else {
                                  alert("업로드 실패");
                                }
                              } catch {
                                alert("업로드 오류");
                              }
                              setThumbUploading(false);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={saving}
                      onClick={async () => {
                        setSaving(true);
                        const updates: Record<string, unknown> = {};
                        if (editNickname.trim()) updates.display_nickname = editNickname.trim();
                        if (editAge) updates.age = Number(editAge);
                        if (editTotal3lift) updates.total_3lift = Number(editTotal3lift);
                        if (editPercentAll) updates.percent_all = Number(editPercentAll);

                        if (Object.keys(updates).length > 0) {
                          const res = await fetch(`/api/admin/dating/${detail.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(updates),
                          });
                          if (res.ok) {
                            setDetail({
                              ...detail,
                              display_nickname: (updates.display_nickname as string) ?? detail.display_nickname,
                              age: (updates.age as number) ?? detail.age,
                              total_3lift: (updates.total_3lift as number) ?? detail.total_3lift,
                              percent_all: (updates.percent_all as number) ?? detail.percent_all,
                            });
                            alert("저장 완료");
                          } else {
                            alert("저장 실패");
                          }
                        }
                        setSaving(false);
                      }}
                      className="w-full py-2 rounded-xl bg-rose-500 text-white text-sm font-medium hover:bg-rose-600 disabled:opacity-50 transition-all"
                    >
                      {saving ? "저장 중..." : "커뮤니티 정보 저장"}
                    </button>
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
