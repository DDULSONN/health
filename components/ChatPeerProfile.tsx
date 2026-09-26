"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchClientJson } from "@/lib/client-json-request";
import { createLatestRequest } from "@/lib/latest-request";
import { isChatPeerProfile, type ChatPeerProfile as PeerProfile } from "@/lib/chat-peer-profile";

export default function ChatPeerProfile({ query }: { query: string }) {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<PeerProfile | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [failedPhotos, setFailedPhotos] = useState<string[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useMemo(() => createLatestRequest(), []);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    void request.run({
      start: () => { setLoading(true); setError(""); setProfile(null); setFailedPhotos([]); },
      load: async signal => {
        const { response, body } = await fetchClientJson<{ ok?: boolean; profile?: unknown; message?: string }>(`/api/dating/chat/profile?${query}`, { signal, cache: "no-store" });
        if (!response.ok || !body?.ok) throw new Error(body?.message ?? "프로필을 불러오지 못했어요.");
        if (!isChatPeerProfile(body.profile)) throw new Error("프로필 정보를 확인하지 못했어요.");
        return body.profile;
      },
      commit: setProfile,
      fail: e => setError(e instanceof Error && e.name !== "AbortError" && !(e instanceof TypeError) ? e.message : "프로필을 불러오지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요."),
      finish: () => setLoading(false),
    });
    return () => { request.cancel(); element?.close(); };
  }, [open, query, request, retry]);
  return <>
    <button type="button" onClick={() => setOpen(true)} className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">프로필 보기</button>
    <dialog ref={dialog} aria-label="상대 프로필" onCancel={() => setOpen(false)} className="m-auto w-[calc(100%_-_2rem)] max-w-md max-h-[80svh] overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-5 text-neutral-900 shadow-xl backdrop:bg-black/40">
      <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-base font-bold">상대 프로필</h2><button type="button" onClick={() => setOpen(false)} className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm">닫기</button></div>
      {loading && <p role="status" className="py-8 text-center text-sm text-neutral-500">프로필을 불러오는 중...</p>}
      {error && <div role="alert" className="space-y-3 text-sm text-neutral-600"><p>{error}</p><button type="button" onClick={() => setRetry(v => v + 1)} className="min-h-10 rounded-lg border border-neutral-300 px-3 font-semibold">다시 시도</button></div>}
      {profile && <div className="space-y-4">
        <div><p className="break-words text-lg font-bold">{profile.name}</p><p className="mt-1 break-words text-sm text-neutral-500">{[profile.age !== null ? `${profile.age}세` : null, profile.region, profile.height_cm !== null ? `${profile.height_cm}cm` : null, profile.job, profile.training_years !== null ? `운동 ${profile.training_years}년` : null].filter(Boolean).join(" · ")}</p></div>
        {profile.photo_urls.length > 0 && <div className="grid grid-cols-2 gap-2">{profile.photo_urls.map((url, index) => failedPhotos.includes(url)
          ? <div key={url + index} className="flex aspect-[3/4] items-center justify-center rounded-xl bg-neutral-100 p-3 text-center text-xs text-neutral-500">사진을 불러오지 못했어요.</div>
          // Existing authenticated image proxy; never upgrade a blurred photo to its original.
          // eslint-disable-next-line @next/next/no-img-element
          : <img key={url + index} src={url} alt={`상대 프로필 사진 ${index + 1}`} loading="lazy" decoding="async" onError={() => setFailedPhotos(v => [...v, url])} className="aspect-[3/4] w-full rounded-xl bg-neutral-100 object-cover" />)}</div>}
        {[["소개", profile.intro_text], ["장점", profile.strengths_text], ["이상형", profile.ideal_type]].map(([label, value]) => value ? <section key={label}><h3 className="mb-1 text-xs font-semibold text-neutral-500">{label}</h3><p className="whitespace-pre-wrap break-words text-sm leading-6">{value}</p></section> : null)}
      </div>}
    </dialog>
  </>;
}
