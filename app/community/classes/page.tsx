"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type ClassStatus = "draft" | "published" | "closed" | "canceled";
type HostType = "trainer" | "gym" | "brand" | "individual" | "other";
type ApplicationStatus = "submitted" | "confirmed" | "canceled" | "attended" | "no_show";

type GymSchedule = {
  id?: string;
  label: string | null;
  starts_at: string;
  ends_at: string | null;
  capacity: number | null;
};

type GymApplication = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  memo: string | null;
  status: ApplicationStatus;
  admin_note: string | null;
  created_at: string;
};

type GymOperatorRequest = {
  id: string;
  applicant_name: string;
  email: string | null;
  phone: string | null;
  host_name: string;
  host_type: HostType;
  region: string | null;
  intro: string | null;
  status: "pending" | "approved" | "rejected";
  admin_note: string | null;
  created_at: string;
};

type GymOperator = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  host_name: string;
  host_type: HostType;
  region: string | null;
  status: "active" | "suspended";
};

type GymClass = {
  id: string;
  slug: string;
  title: string;
  host_name: string;
  host_type: HostType;
  status: ClassStatus;
  summary: string | null;
  description: string | null;
  region: string | null;
  venue: string | null;
  price_text: string | null;
  capacity: number | null;
  application_deadline: string | null;
  contact_url: string | null;
  cover_image_url: string | null;
  preparation_note: string | null;
  admin_note: string | null;
  operator_id: string | null;
  is_featured: boolean;
  created_at: string;
  schedules?: GymSchedule[];
  applications?: GymApplication[];
  application_stats?: {
    total: number;
    submitted: number;
    confirmed: number;
  };
};

type GymClassForm = {
  id: string | null;
  title: string;
  slug: string;
  host_name: string;
  host_type: HostType;
  status: ClassStatus;
  summary: string;
  description: string;
  region: string;
  venue: string;
  price_text: string;
  capacity: string;
  application_deadline: string;
  contact_url: string;
  cover_image_url: string;
  preparation_note: string;
  admin_note: string;
  operator_id: string;
  is_featured: boolean;
  schedules: ScheduleForm[];
};

type OperatorRequestForm = {
  applicant_name: string;
  email: string;
  phone: string;
  host_name: string;
  host_type: HostType;
  region: string;
  intro: string;
};

type ScheduleForm = {
  label: string;
  starts_at: string;
  ends_at: string;
  capacity: string;
};

type ApplicantForm = {
  name: string;
  phone: string;
  email: string;
  memo: string;
  schedule_id: string;
};

const STATUS_LABELS: Record<ClassStatus, string> = {
  draft: "준비중",
  published: "모집중",
  closed: "마감",
  canceled: "취소",
};

const HOST_LABELS: Record<HostType, string> = {
  trainer: "트레이너",
  gym: "헬스장",
  brand: "업체",
  individual: "개인",
  other: "기타",
};

const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  submitted: "신청",
  confirmed: "확정",
  canceled: "취소",
  attended: "참석",
  no_show: "불참",
};

const EMPTY_FORM: GymClassForm = {
  id: null,
  title: "",
  slug: "",
  host_name: "",
  host_type: "trainer",
  status: "draft",
  summary: "",
  description: "",
  region: "",
  venue: "",
  price_text: "",
  capacity: "",
  application_deadline: "",
  contact_url: "",
  cover_image_url: "",
  preparation_note: "",
  admin_note: "",
  operator_id: "",
  is_featured: false,
  schedules: [{ label: "", starts_at: "", ends_at: "", capacity: "" }],
};

const EMPTY_OPERATOR_REQUEST: OperatorRequestForm = {
  applicant_name: "",
  email: "",
  phone: "",
  host_name: "",
  host_type: "trainer",
  region: "",
  intro: "",
};

const EMPTY_APPLICANT: ApplicantForm = {
  name: "",
  phone: "",
  email: "",
  memo: "",
  schedule_id: "",
};

function toDateTimeLocal(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromClassToForm(item: GymClass): GymClassForm {
  const schedules = item.schedules?.length
    ? item.schedules.map((schedule) => ({
        label: schedule.label ?? "",
        starts_at: toDateTimeLocal(schedule.starts_at),
        ends_at: toDateTimeLocal(schedule.ends_at),
        capacity: schedule.capacity ? String(schedule.capacity) : "",
      }))
    : [{ label: "", starts_at: "", ends_at: "", capacity: "" }];

  return {
    id: item.id,
    title: item.title,
    slug: item.slug,
    host_name: item.host_name,
    host_type: item.host_type,
    status: item.status,
    summary: item.summary ?? "",
    description: item.description ?? "",
    region: item.region ?? "",
    venue: item.venue ?? "",
    price_text: item.price_text ?? "",
    capacity: item.capacity ? String(item.capacity) : "",
    application_deadline: toDateTimeLocal(item.application_deadline),
    contact_url: item.contact_url ?? "",
    cover_image_url: item.cover_image_url ?? "",
    preparation_note: item.preparation_note ?? "",
    admin_note: item.admin_note ?? "",
    operator_id: item.operator_id ?? "",
    is_featured: item.is_featured,
    schedules,
  };
}

function formToPayload(form: GymClassForm) {
  return {
    title: form.title,
    slug: form.slug,
    host_name: form.host_name,
    host_type: form.host_type,
    status: form.status,
    summary: form.summary,
    description: form.description,
    region: form.region,
    venue: form.venue,
    price_text: form.price_text,
    capacity: form.capacity,
    application_deadline: form.application_deadline,
    contact_url: form.contact_url,
    cover_image_url: form.cover_image_url,
    preparation_note: form.preparation_note,
    admin_note: form.admin_note,
    operator_id: form.operator_id,
    is_featured: form.is_featured,
    schedules: form.schedules
      .filter((schedule) => schedule.starts_at.trim())
      .map((schedule) => ({
        label: schedule.label,
        starts_at: schedule.starts_at,
        ends_at: schedule.ends_at,
        capacity: schedule.capacity,
      })),
  };
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

async function readError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string; detail?: string };
    return payload.error ?? payload.detail ?? "요청에 실패했습니다.";
  } catch {
    return "요청에 실패했습니다.";
  }
}

export default function CommunityClassesPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [items, setItems] = useState<GymClass[]>([]);
  const [operatorRequests, setOperatorRequests] = useState<GymOperatorRequest[]>([]);
  const [operators, setOperators] = useState<GymOperator[]>([]);
  const [selected, setSelected] = useState<GymClass | null>(null);
  const [form, setForm] = useState<GymClassForm>(EMPTY_FORM);
  const [operatorForm, setOperatorForm] = useState<OperatorRequestForm>(EMPTY_OPERATOR_REQUEST);
  const [applicantForm, setApplicantForm] = useState<ApplicantForm>(EMPTY_APPLICANT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [panel, setPanel] = useState<"classes" | "operators">("classes");

  const activeApplications = useMemo(() => selected?.applications ?? [], [selected]);
  const pendingRequestCount = operatorRequests.filter((item) => item.status === "pending").length;

  const refresh = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/gym-classes", { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response));
      const payload = (await response.json()) as { items?: GymClass[] };
      setItems(payload.items ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "운동 클래스를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setMessage("");
    try {
      const response = await fetch(`/api/admin/gym-classes/${id}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response));
      const payload = (await response.json()) as { item: GymClass };
      setSelected(payload.item);
      setForm(fromClassToForm(payload.item));
      setApplicantForm(EMPTY_APPLICANT);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "상세 정보를 불러오지 못했습니다.");
    }
  }, []);

  const loadOperators = useCallback(async () => {
    const response = await fetch("/api/admin/gym-classes/operators", { cache: "no-store" });
    if (!response.ok) throw new Error(await readError(response));
    const payload = (await response.json()) as {
      requests?: GymOperatorRequest[];
      operators?: GymOperator[];
    };
    setOperatorRequests(payload.requests ?? []);
    setOperators(payload.operators ?? []);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      try {
        const response = await fetch("/api/admin/me", { cache: "no-store" });
        const payload = (await response.json()) as { isAdmin?: boolean };
        if (!mounted) return;
        setIsAdmin(Boolean(payload.isAdmin));
        if (payload.isAdmin) {
          await Promise.all([refresh(), loadOperators()]);
        } else {
          setLoading(false);
        }
      } catch {
        if (!mounted) return;
        setIsAdmin(false);
        setLoading(false);
      }
    }

    void boot();
    return () => {
      mounted = false;
    };
  }, [loadOperators, refresh]);

  async function saveClass() {
    setSaving(true);
    setMessage("");

    try {
      const url = form.id ? `/api/admin/gym-classes/${form.id}` : "/api/admin/gym-classes";
      const method = form.id ? "PATCH" : "POST";
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToPayload(form)),
      });
      if (!response.ok) throw new Error(await readError(response));
      const payload = (await response.json()) as { item: GymClass };
      setSelected(payload.item);
      setForm(fromClassToForm(payload.item));
      setMessage("저장했습니다.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteClass() {
    if (!form.id || !confirm("이 운동 클래스를 삭제할까요?")) return;
    setSaving(true);
    setMessage("");

    try {
      const response = await fetch(`/api/admin/gym-classes/${form.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readError(response));
      setSelected(null);
      setForm(EMPTY_FORM);
      setMessage("삭제했습니다.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "삭제에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function addApplicant() {
    if (!form.id) return;
    setSaving(true);
    setMessage("");

    try {
      const response = await fetch(`/api/admin/gym-classes/${form.id}/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(applicantForm),
      });
      if (!response.ok) throw new Error(await readError(response));
      setApplicantForm(EMPTY_APPLICANT);
      await loadDetail(form.id);
      await refresh();
      setMessage("지원자를 추가했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "지원자 추가에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function submitOperatorRequest() {
    setSaving(true);
    setMessage("");

    try {
      const response = await fetch("/api/admin/gym-classes/operators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(operatorForm),
      });
      if (!response.ok) throw new Error(await readError(response));
      setOperatorForm(EMPTY_OPERATOR_REQUEST);
      await loadOperators();
      setMessage("운영 신청을 등록했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "운영 신청 등록에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function reviewOperatorRequest(id: string, status: "approved" | "rejected", adminNote?: string | null) {
    setSaving(true);
    setMessage("");

    try {
      const response = await fetch(`/api/admin/gym-classes/operator-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, admin_note: adminNote ?? "" }),
      });
      if (!response.ok) throw new Error(await readError(response));
      await loadOperators();
      setMessage(status === "approved" ? "운영자를 승인했습니다." : "운영 신청을 반려했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "운영 신청 처리에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function updateApplicant(id: string, patch: Partial<Pick<GymApplication, "status" | "admin_note">>) {
    if (!form.id) return;
    setMessage("");

    try {
      const response = await fetch(`/api/admin/gym-classes/applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error(await readError(response));
      await loadDetail(form.id);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "지원자 수정에 실패했습니다.");
    }
  }

  if (isAdmin === false) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-[28px] border border-neutral-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-black text-neutral-900">관리자 전용 메뉴입니다.</h1>
          <Link className="mt-4 inline-flex rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-bold text-white" href="/community">
            커뮤니티로 돌아가기
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-emerald-600">관리자 전용</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-neutral-950">운동 클래스</h1>
          <p className="mt-2 text-sm text-neutral-500">일일 PT·클래스 모집을 작게 관리합니다.</p>
        </div>
        <div className="flex gap-2">
          <Link className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-bold text-neutral-700" href="/community">
            커뮤니티
          </Link>
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setForm(EMPTY_FORM);
              setApplicantForm(EMPTY_APPLICANT);
              setMessage("");
            }}
            className="rounded-2xl bg-neutral-950 px-4 py-3 text-sm font-bold text-white"
          >
            새 클래스
          </button>
        </div>
      </div>

      {message ? (
        <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          {message}
        </div>
      ) : null}

      <div className="mt-4 flex gap-2 rounded-[22px] border border-neutral-200 bg-neutral-50 p-1">
        <button
          type="button"
          onClick={() => setPanel("classes")}
          className={`flex-1 rounded-2xl px-4 py-3 text-sm font-black transition ${
            panel === "classes" ? "bg-white text-neutral-950 shadow-sm" : "text-neutral-500"
          }`}
        >
          클래스
        </button>
        <button
          type="button"
          onClick={() => setPanel("operators")}
          className={`flex-1 rounded-2xl px-4 py-3 text-sm font-black transition ${
            panel === "operators" ? "bg-white text-neutral-950 shadow-sm" : "text-neutral-500"
          }`}
        >
          입점 신청 {pendingRequestCount ? `(${pendingRequestCount})` : ""}
        </button>
      </div>

      {panel === "operators" ? (
        <section className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-[28px] border border-neutral-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-neutral-950">운영 신청 등록</h2>
            <p className="mt-1 text-sm text-neutral-500">지금은 관리자만 테스트합니다.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <input className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm" placeholder="신청자명" value={operatorForm.applicant_name} onChange={(e) => setOperatorForm({ ...operatorForm, applicant_name: e.target.value })} />
              <input className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm" placeholder="운영명" value={operatorForm.host_name} onChange={(e) => setOperatorForm({ ...operatorForm, host_name: e.target.value })} />
              <input className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm" placeholder="이메일" value={operatorForm.email} onChange={(e) => setOperatorForm({ ...operatorForm, email: e.target.value })} />
              <input className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm" placeholder="연락처" value={operatorForm.phone} onChange={(e) => setOperatorForm({ ...operatorForm, phone: e.target.value })} />
              <select className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm" value={operatorForm.host_type} onChange={(e) => setOperatorForm({ ...operatorForm, host_type: e.target.value as HostType })}>
                {Object.entries(HOST_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <input className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm" placeholder="지역" value={operatorForm.region} onChange={(e) => setOperatorForm({ ...operatorForm, region: e.target.value })} />
            </div>
            <textarea className="mt-3 min-h-28 w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm" placeholder="운영 소개" value={operatorForm.intro} onChange={(e) => setOperatorForm({ ...operatorForm, intro: e.target.value })} />
            <button type="button" onClick={submitOperatorRequest} disabled={saving} className="mt-3 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white disabled:opacity-50">
              신청 등록
            </button>
          </div>

          <div className="space-y-4">
            <div className="rounded-[28px] border border-neutral-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black text-neutral-950">승인 대기</h2>
              <div className="mt-3 space-y-2">
                {operatorRequests.length === 0 ? (
                  <div className="rounded-2xl bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-500">운영 신청이 없습니다.</div>
                ) : (
                  operatorRequests.map((request) => (
                    <div key={request.id} className="rounded-2xl border border-neutral-100 bg-neutral-50 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-black text-neutral-900">{request.host_name}</p>
                          <p className="mt-1 text-sm text-neutral-500">{request.applicant_name} · {request.region || "지역 미정"}</p>
                          {request.intro ? <p className="mt-2 line-clamp-2 text-sm text-neutral-600">{request.intro}</p> : null}
                        </div>
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-neutral-600">{request.status}</span>
                      </div>
                      {request.status === "pending" ? (
                        <div className="mt-3 flex gap-2">
                          <button type="button" disabled={saving} onClick={() => reviewOperatorRequest(request.id, "approved", request.admin_note)} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white disabled:opacity-50">
                            승인
                          </button>
                          <button type="button" disabled={saving} onClick={() => reviewOperatorRequest(request.id, "rejected", request.admin_note)} className="rounded-xl border border-rose-200 px-4 py-2 text-xs font-black text-rose-600 disabled:opacity-50">
                            반려
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-[28px] border border-neutral-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black text-neutral-950">승인 운영자</h2>
              <div className="mt-3 space-y-2">
                {operators.length === 0 ? (
                  <div className="rounded-2xl bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-500">승인된 운영자가 없습니다.</div>
                ) : (
                  operators.map((operator) => (
                    <div key={operator.id} className="rounded-2xl bg-neutral-50 p-4">
                      <p className="font-black text-neutral-900">{operator.host_name}</p>
                      <p className="mt-1 text-sm text-neutral-500">{operator.name} · {operator.region || "지역 미정"}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {panel === "classes" ? (
      <div className="mt-5 grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="rounded-[28px] border border-neutral-200 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between px-2 py-2">
            <h2 className="text-sm font-black text-neutral-900">목록</h2>
            <button type="button" onClick={refresh} className="text-xs font-bold text-emerald-600">
              새로고침
            </button>
          </div>
          {loading ? (
            <div className="rounded-2xl bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-500">불러오는 중</div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-500">아직 등록된 클래스가 없습니다.</div>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => loadDetail(item.id)}
                  className={`w-full rounded-2xl border p-3 text-left transition ${
                    form.id === item.id
                      ? "border-emerald-300 bg-emerald-50"
                      : "border-neutral-100 bg-neutral-50 hover:border-neutral-200 hover:bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="line-clamp-1 text-sm font-black text-neutral-900">{item.title}</span>
                    <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[11px] font-bold text-emerald-700">
                      {STATUS_LABELS[item.status]}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-1 text-xs text-neutral-500">
                    {item.host_name} · {item.region || "지역 미정"}
                  </p>
                  <p className="mt-2 text-xs font-semibold text-neutral-400">
                    일정 {item.schedules?.length ?? 0}개 · 신청 {item.application_stats?.total ?? 0}명
                  </p>
                </button>
              ))}
            </div>
          )}
        </aside>

        <section className="space-y-4">
          <div className="rounded-[28px] border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-black text-neutral-950">{form.id ? "클래스 수정" : "새 클래스 등록"}</h2>
              <div className="flex gap-2">
                {form.id ? (
                  <Link
                    href={`/community/classes/${encodeURIComponent(form.slug)}`}
                    className="rounded-2xl border border-neutral-200 px-4 py-2 text-sm font-bold text-neutral-700"
                  >
                    미리보기
                  </Link>
                ) : null}
                {form.id ? (
                  <button
                    type="button"
                    onClick={deleteClass}
                    disabled={saving}
                    className="rounded-2xl border border-rose-200 px-4 py-2 text-sm font-bold text-rose-600 disabled:opacity-50"
                  >
                    삭제
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={saveClass}
                  disabled={saving}
                  className="rounded-2xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  저장
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <input className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none focus:border-emerald-400" placeholder="클래스명" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <input className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none focus:border-emerald-400" placeholder="진행자명" value={form.host_name} onChange={(e) => setForm({ ...form, host_name: e.target.value })} />
              <select className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none focus:border-emerald-400" value={form.host_type} onChange={(e) => setForm({ ...form, host_type: e.target.value as HostType })}>
                {Object.entries(HOST_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <select className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none focus:border-emerald-400" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ClassStatus })}>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <select className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none focus:border-emerald-400" value={form.operator_id} onChange={(e) => setForm({ ...form, operator_id: e.target.value })}>
                <option value="">운영자 연결 없음</option>
                {operators.map((operator) => (
                  <option key={operator.id} value={operator.id}>
                    {operator.host_name} · {operator.name}
                  </option>
                ))}
              </select>
              <input className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none focus:border-emerald-400" placeholder="지역" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
              <input className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none focus:border-emerald-400" placeholder="장소" value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} />
              <input className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none focus:border-emerald-400" placeholder="가격 예: 1회 30,000원" value={form.price_text} onChange={(e) => setForm({ ...form, price_text: e.target.value })} />
              <input className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none focus:border-emerald-400" placeholder="정원" inputMode="numeric" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
              <input className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none focus:border-emerald-400" placeholder="신청 마감" type="datetime-local" value={form.application_deadline} onChange={(e) => setForm({ ...form, application_deadline: e.target.value })} />
              <input className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none focus:border-emerald-400" placeholder="문의 링크" value={form.contact_url} onChange={(e) => setForm({ ...form, contact_url: e.target.value })} />
            </div>

            <textarea className="mt-3 min-h-20 w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none focus:border-emerald-400" placeholder="한 줄 소개" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
            <textarea className="mt-3 min-h-28 w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none focus:border-emerald-400" placeholder="상세 안내" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <textarea className="mt-3 min-h-20 w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none focus:border-emerald-400" placeholder="준비물/유의사항" value={form.preparation_note} onChange={(e) => setForm({ ...form, preparation_note: e.target.value })} />

            <div className="mt-4 rounded-[24px] bg-neutral-50 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-neutral-900">일정</h3>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, schedules: [...form.schedules, { label: "", starts_at: "", ends_at: "", capacity: "" }] })}
                  className="rounded-full bg-white px-3 py-2 text-xs font-bold text-emerald-600"
                >
                  일정 추가
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {form.schedules.map((schedule, index) => (
                  <div key={index} className="grid gap-2 rounded-2xl bg-white p-3 md:grid-cols-[1fr_1fr_1fr_80px_44px]">
                    <input className="rounded-xl border border-neutral-200 px-3 py-2 text-sm" placeholder="라벨" value={schedule.label} onChange={(e) => {
                      const schedules = [...form.schedules];
                      schedules[index] = { ...schedule, label: e.target.value };
                      setForm({ ...form, schedules });
                    }} />
                    <input className="rounded-xl border border-neutral-200 px-3 py-2 text-sm" type="datetime-local" value={schedule.starts_at} onChange={(e) => {
                      const schedules = [...form.schedules];
                      schedules[index] = { ...schedule, starts_at: e.target.value };
                      setForm({ ...form, schedules });
                    }} />
                    <input className="rounded-xl border border-neutral-200 px-3 py-2 text-sm" type="datetime-local" value={schedule.ends_at} onChange={(e) => {
                      const schedules = [...form.schedules];
                      schedules[index] = { ...schedule, ends_at: e.target.value };
                      setForm({ ...form, schedules });
                    }} />
                    <input className="rounded-xl border border-neutral-200 px-3 py-2 text-sm" placeholder="정원" value={schedule.capacity} onChange={(e) => {
                      const schedules = [...form.schedules];
                      schedules[index] = { ...schedule, capacity: e.target.value };
                      setForm({ ...form, schedules });
                    }} />
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, schedules: form.schedules.filter((_, itemIndex) => itemIndex !== index) })}
                      className="rounded-xl bg-neutral-100 text-xs font-bold text-neutral-500"
                    >
                      삭제
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {selected ? (
            <div className="rounded-[28px] border border-neutral-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black text-neutral-950">지원자</h2>
                  <p className="mt-1 text-sm text-neutral-500">신청 {activeApplications.length}명</p>
                </div>
                <div className="rounded-full bg-neutral-100 px-3 py-2 text-xs font-bold text-neutral-500">
                  {STATUS_LABELS[selected.status]}
                </div>
              </div>

              <div className="mt-4 grid gap-2 md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                <input className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm" placeholder="이름" value={applicantForm.name} onChange={(e) => setApplicantForm({ ...applicantForm, name: e.target.value })} />
                <input className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm" placeholder="연락처" value={applicantForm.phone} onChange={(e) => setApplicantForm({ ...applicantForm, phone: e.target.value })} />
                <input className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm" placeholder="이메일" value={applicantForm.email} onChange={(e) => setApplicantForm({ ...applicantForm, email: e.target.value })} />
                <select className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm" value={applicantForm.schedule_id} onChange={(e) => setApplicantForm({ ...applicantForm, schedule_id: e.target.value })}>
                  <option value="">일정 선택</option>
                  {(selected.schedules ?? []).map((schedule) => (
                    <option key={schedule.id} value={schedule.id}>
                      {schedule.label || formatDate(schedule.starts_at)}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={addApplicant} disabled={saving} className="rounded-2xl bg-neutral-950 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
                  추가
                </button>
              </div>
              <textarea className="mt-2 min-h-16 w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm" placeholder="메모" value={applicantForm.memo} onChange={(e) => setApplicantForm({ ...applicantForm, memo: e.target.value })} />

              <div className="mt-4 space-y-2">
                {activeApplications.length === 0 ? (
                  <div className="rounded-2xl bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-500">아직 지원자가 없습니다.</div>
                ) : (
                  activeApplications.map((application) => (
                    <div key={application.id} className="rounded-2xl border border-neutral-100 bg-neutral-50 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-black text-neutral-900">{application.name}</p>
                          <p className="mt-1 text-sm text-neutral-500">
                            {[application.phone, application.email].filter(Boolean).join(" · ") || "연락처 없음"}
                          </p>
                          {application.memo ? <p className="mt-2 text-sm text-neutral-600">{application.memo}</p> : null}
                        </div>
                        <select
                          className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-bold"
                          value={application.status}
                          onChange={(e) => updateApplicant(application.id, { status: e.target.value as ApplicationStatus, admin_note: application.admin_note })}
                        >
                          {Object.entries(APPLICATION_STATUS_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </div>
                      <input
                        className="mt-3 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm"
                        placeholder="관리 메모"
                        defaultValue={application.admin_note ?? ""}
                        onBlur={(e) => updateApplicant(application.id, { status: application.status, admin_note: e.target.value })}
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </section>
      </div>
      ) : null}
    </main>
  );
}
