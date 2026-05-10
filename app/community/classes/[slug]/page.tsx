"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Schedule = {
  id: string;
  label: string | null;
  starts_at: string;
  ends_at: string | null;
  capacity: number | null;
};

type GymClassPreview = {
  id: string;
  title: string;
  host_name: string;
  status: "draft" | "published" | "closed" | "canceled";
  summary: string | null;
  description: string | null;
  target_audience: string | null;
  service_process: string | null;
  curriculum: string | null;
  available_days: string | null;
  included_items: string | null;
  faq: string | null;
  expert_profile: string | null;
  region: string | null;
  venue: string | null;
  price_text: string | null;
  capacity: number | null;
  male_capacity: number | null;
  female_capacity: number | null;
  min_participants: number | null;
  application_deadline: string | null;
  contact_url: string | null;
  cover_image_url: string | null;
  preparation_note: string | null;
  refund_policy_text: string | null;
  photo_consent_required: boolean;
  safety_notice: string | null;
  schedules: Schedule[];
  application_count: number;
  application_stats?: {
    active: number;
    paid: number;
    male: number;
    female: number;
    remaining: number | null;
    maleRemaining: number | null;
    femaleRemaining: number | null;
    isFull: boolean;
    maleFull: boolean;
    femaleFull: boolean;
    minParticipantsMet: boolean;
  };
};

type ApplyForm = {
  name: string;
  phone: string;
  email: string;
  gender: "male" | "female" | "other" | "";
  memo: string;
  schedule_id: string;
  privacy_accepted: boolean;
  broker_notice_accepted: boolean;
  refund_policy_accepted: boolean;
  photo_consent_accepted: boolean;
};

const EMPTY_APPLY_FORM: ApplyForm = {
  name: "",
  phone: "",
  email: "",
  gender: "",
  memo: "",
  schedule_id: "",
  privacy_accepted: false,
  broker_notice_accepted: false,
  refund_policy_accepted: false,
  photo_consent_accepted: false,
};

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function textLines(value: string | null | undefined) {
  return (value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function DetailBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[28px] border border-neutral-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black text-neutral-950">{title}</h2>
      <div className="mt-3 text-sm leading-7 text-neutral-700">{children}</div>
    </section>
  );
}

function BulletText({ value }: { value: string | null | undefined }) {
  const lines = textLines(value);
  if (lines.length === 0) return null;
  return (
    <ul className="space-y-2">
      {lines.map((line, index) => (
        <li key={`${line}-${index}`} className="flex gap-2">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

async function readError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string; detail?: string };
    return payload.error ?? payload.detail ?? "요청에 실패했습니다.";
  } catch {
    return "요청에 실패했습니다.";
  }
}

export default function GymClassPreviewPage() {
  const params = useParams<{ slug: string }>();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [item, setItem] = useState<GymClassPreview | null>(null);
  const [form, setForm] = useState<ApplyForm>(EMPTY_APPLY_FORM);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      try {
        const adminResponse = await fetch("/api/admin/me", { cache: "no-store" });
        const adminPayload = (await adminResponse.json()) as { isAdmin?: boolean };
        if (!mounted) return;
        setIsAdmin(Boolean(adminPayload.isAdmin));
        if (!adminPayload.isAdmin) {
          setLoading(false);
          return;
        }

        const slug = encodeURIComponent(params.slug);
        const response = await fetch(`/api/admin/gym-classes/slug/${slug}`, { cache: "no-store" });
        if (!response.ok) throw new Error(await readError(response));
        const payload = (await response.json()) as { item: GymClassPreview };
        if (!mounted) return;
        setItem(payload.item);
      } catch (error) {
        if (!mounted) return;
        setMessage(error instanceof Error ? error.message : "클래스를 불러오지 못했습니다.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void boot();
    return () => {
      mounted = false;
    };
  }, [params.slug]);

  async function submitApplication() {
    if (!item) return;
    setSubmitting(true);
    setMessage("");

    try {
      const response = await fetch(`/api/admin/gym-classes/${item.id}/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok) throw new Error(await readError(response));
      setForm(EMPTY_APPLY_FORM);
      setMessage("신청이 접수되었습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "신청에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  if (isAdmin === false) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-[28px] border border-neutral-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-black text-neutral-900">관리자 미리보기 페이지입니다.</h1>
          <Link href="/community" className="mt-4 inline-flex rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-bold text-white">
            커뮤니티로 돌아가기
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href="/community/classes/manage" className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-bold text-neutral-700">
          관리로 돌아가기
        </Link>
        <span className="rounded-full bg-amber-50 px-3 py-2 text-xs font-black text-amber-700">관리자 미리보기</span>
      </div>

      {loading ? (
        <div className="rounded-[28px] border border-neutral-200 bg-white px-4 py-12 text-center text-sm text-neutral-500 shadow-sm">
          불러오는 중
        </div>
      ) : item ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            <section className="overflow-hidden rounded-[32px] border border-neutral-200 bg-white shadow-sm">
              {item.cover_image_url ? (
                <img src={item.cover_image_url} alt="" className="h-80 w-full object-cover" loading="lazy" />
              ) : (
                <div className="flex h-72 w-full items-center justify-center bg-gradient-to-br from-neutral-950 to-emerald-700 text-sm font-black text-white">
                  GymTools Class
                </div>
              )}
              <div className="p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
                    {item.region || "지역 미정"}
                  </span>
                  <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-black text-neutral-600">
                    {item.venue || "장소 협의"}
                  </span>
                </div>
                <h1 className="mt-4 text-3xl font-black tracking-tight text-neutral-950 sm:text-4xl">{item.title}</h1>
                <p className="mt-2 text-sm font-semibold text-neutral-500">{item.host_name}</p>
                {item.summary ? <p className="mt-5 text-base leading-7 text-neutral-700">{item.summary}</p> : null}
              </div>
            </section>

            {item.target_audience ? (
              <DetailBlock title="이런 분께 추천해요">
                <BulletText value={item.target_audience} />
              </DetailBlock>
            ) : null}

            {item.description ? (
              <DetailBlock title="서비스 소개">
                <p className="whitespace-pre-wrap">{item.description}</p>
              </DetailBlock>
            ) : null}

            {item.service_process || item.curriculum ? (
              <DetailBlock title="진행 방식">
                {item.service_process ? <BulletText value={item.service_process} /> : null}
                {item.curriculum ? <p className="mt-4 whitespace-pre-wrap rounded-2xl bg-neutral-50 p-4">{item.curriculum}</p> : null}
              </DetailBlock>
            ) : null}

            {item.available_days || item.included_items || item.preparation_note ? (
              <DetailBlock title="일정/준비 안내">
                {item.available_days ? (
                  <div>
                    <p className="font-black text-neutral-900">가능 일정</p>
                    <BulletText value={item.available_days} />
                  </div>
                ) : null}
                {item.included_items ? (
                  <div className="mt-4">
                    <p className="font-black text-neutral-900">포함 항목</p>
                    <BulletText value={item.included_items} />
                  </div>
                ) : null}
                {item.preparation_note ? <p className="mt-4 whitespace-pre-wrap rounded-2xl bg-neutral-50 p-4">{item.preparation_note}</p> : null}
              </DetailBlock>
            ) : null}

            {item.expert_profile ? (
              <DetailBlock title="전문가 소개">
                <p className="whitespace-pre-wrap">{item.expert_profile}</p>
              </DetailBlock>
            ) : null}

            {item.faq ? (
              <DetailBlock title="자주 묻는 질문">
                <BulletText value={item.faq} />
              </DetailBlock>
            ) : null}

            <section className="rounded-[24px] border border-neutral-200 bg-neutral-50 p-4 text-xs leading-6 text-neutral-500">
              <p className="font-bold text-neutral-700">환불/운영 안내</p>
              <p className="mt-1">{item.refund_policy_text}</p>
              {item.safety_notice ? <p className="mt-2">{item.safety_notice}</p> : null}
              <p className="mt-2">GymTools는 클래스 모집과 신청 연결을 돕는 플랫폼입니다. 실제 클래스 내용, 일정, 환불, 현장 안전 및 운영 책임은 각 입점 운영자에게 있습니다.</p>
            </section>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-5 lg:self-start">
            <section className="rounded-[32px] border border-neutral-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-black text-emerald-600">클래스 신청</p>
              <p className="mt-2 text-2xl font-black text-neutral-950">{item.price_text || "가격 미정"}</p>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-2xl bg-neutral-50 px-2 py-3">
                  <p className="text-base font-black text-neutral-950">
                    {item.capacity ? `${item.application_stats?.active ?? 0}/${item.capacity}` : `${item.application_stats?.active ?? 0}명`}
                  </p>
                  <p className="mt-1 text-neutral-500">{item.application_stats?.isFull ? "정원마감" : "신청"}</p>
                </div>
                <div className="rounded-2xl bg-neutral-50 px-2 py-3">
                  <p className="text-base font-black text-neutral-950">
                    남 {item.application_stats?.male ?? 0}
                    {item.male_capacity !== null && item.male_capacity !== undefined ? `/${item.male_capacity}` : ""}
                  </p>
                  <p className="mt-1 text-neutral-500">{item.application_stats?.maleFull ? "마감" : "남성"}</p>
                </div>
                <div className="rounded-2xl bg-neutral-50 px-2 py-3">
                  <p className="text-base font-black text-neutral-950">
                    여 {item.application_stats?.female ?? 0}
                    {item.female_capacity !== null && item.female_capacity !== undefined ? `/${item.female_capacity}` : ""}
                  </p>
                  <p className="mt-1 text-neutral-500">{item.application_stats?.femaleFull ? "마감" : "여성"}</p>
                </div>
              </div>
              {item.min_participants ? (
                <p className="mt-3 rounded-2xl bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-700">
                  최소 {item.min_participants}명 진행 · {item.application_stats?.minParticipantsMet ? "진행 기준 충족" : "진행 기준 대기"}
                </p>
              ) : null}
            </section>

            <section className="rounded-[28px] border border-neutral-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black text-neutral-950">일정 선택</h2>
              <div className="mt-3 space-y-2">
                {item.schedules.length === 0 ? (
                  <div className="rounded-2xl bg-neutral-50 px-4 py-6 text-center text-sm text-neutral-500">일정 준비중입니다.</div>
                ) : (
                  item.schedules.map((schedule) => (
                    <label key={schedule.id} className="flex cursor-pointer items-center gap-3 rounded-2xl border border-neutral-100 bg-neutral-50 p-4">
                      <input
                        type="radio"
                        name="schedule"
                        value={schedule.id}
                        checked={form.schedule_id === schedule.id}
                        onChange={(event) => setForm({ ...form, schedule_id: event.target.value })}
                      />
                      <span>
                        <span className="block text-sm font-black text-neutral-900">{schedule.label || formatDate(schedule.starts_at)}</span>
                        <span className="mt-1 block text-xs text-neutral-500">{formatDate(schedule.starts_at)}</span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-[28px] border border-neutral-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black text-neutral-950">신청하기</h2>
              <p className="mt-1 text-sm text-neutral-500">이름과 연락처만 남기면 신청이 접수됩니다.</p>
              <div className="mt-4 grid gap-2">
                <input className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm" placeholder="이름" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <input className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm" placeholder="연락처" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                <input className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm" placeholder="이메일" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                <select className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value as ApplyForm["gender"] })}>
                  <option value="">성별 선택</option>
                  <option value="male">남성</option>
                  <option value="female">여성</option>
                  <option value="other">기타</option>
                </select>
              </div>
              <textarea className="mt-2 min-h-20 w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm" placeholder="메모" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} />
              <div className="mt-3 space-y-2 rounded-[22px] border border-neutral-100 bg-neutral-50 p-4">
                <p className="text-sm font-black text-neutral-900">신청 전 확인</p>
                <label className="flex gap-2 text-sm text-neutral-700">
                  <input type="checkbox" checked={form.privacy_accepted} onChange={(e) => setForm({ ...form, privacy_accepted: e.target.checked })} />
                  <span>신청 정보가 운영자에게 전달되는 것에 동의합니다.</span>
                </label>
                <label className="flex gap-2 text-sm text-neutral-700">
                  <input type="checkbox" checked={form.broker_notice_accepted} onChange={(e) => setForm({ ...form, broker_notice_accepted: e.target.checked })} />
                  <span>GymTools는 연결 플랫폼이며 현장 운영은 입점 운영자가 담당합니다.</span>
                </label>
                <label className="flex gap-2 text-sm text-neutral-700">
                  <input type="checkbox" checked={form.refund_policy_accepted} onChange={(e) => setForm({ ...form, refund_policy_accepted: e.target.checked })} />
                  <span>환불 규정과 노쇼/지각 안내를 확인했습니다.</span>
                </label>
                {item.photo_consent_required ? (
                  <label className="flex gap-2 text-sm text-neutral-700">
                    <input type="checkbox" checked={form.photo_consent_accepted} onChange={(e) => setForm({ ...form, photo_consent_accepted: e.target.checked })} />
                    <span>사진/영상 촬영 안내를 확인했습니다.</span>
                  </label>
                ) : null}
              </div>
              <button type="button" disabled={submitting} onClick={submitApplication} className="mt-3 w-full rounded-2xl bg-emerald-600 px-5 py-4 text-sm font-black text-white disabled:opacity-50">
                신청 접수
              </button>
            </section>
          </aside>
        </div>
      ) : (
        <div className="rounded-[28px] border border-neutral-200 bg-white px-4 py-12 text-center text-sm text-neutral-500 shadow-sm">
          클래스를 찾지 못했습니다.
        </div>
      )}

      {message ? (
        <div className="fixed inset-x-4 bottom-5 mx-auto max-w-md rounded-2xl bg-neutral-950 px-4 py-3 text-center text-sm font-bold text-white shadow-xl">
          {message}
        </div>
      ) : null}
    </main>
  );
}
