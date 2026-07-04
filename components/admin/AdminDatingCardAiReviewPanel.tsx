"use client";

import { useCallback, useEffect, useState } from "react";

type SourceType =
  | "all"
  | "open_card"
  | "paid_card"
  | "one_on_one"
  | "open_card_application"
  | "paid_card_application"
  | "one_on_one_application";
type ReviewMode = "rules" | "ai";
type SuspicionLevel = "clear" | "low" | "medium" | "high";

type ReviewItem = {
  sourceType?: Exclude<SourceType, "all">;
  source_type?: Exclude<SourceType, "all">;
  cardId?: string;
  card_id?: string;
  userId?: string | null;
  user_id?: string | null;
  status?: string | null;
  card_status?: string | null;
  displayName?: string | null;
  display_name?: string | null;
  age?: number | null;
  region?: string | null;
  previewUrls?: string[];
  texts?: Record<string, string>;
  editableFields?: Partial<EditableFields>;
  createdAt?: string | null;
  scanned_at?: string | null;
  raw_result?: { provider?: string; [key: string]: unknown };
  review?: {
    suspicionLevel: SuspicionLevel;
    flags: string[];
    summary: string;
    photoFlags: string[];
    textFlags: string[];
    raw?: { provider?: string; [key: string]: unknown };
  };
  suspicion_level?: SuspicionLevel;
  flags?: string[];
  summary?: string;
  photo_flags?: string[];
  text_flags?: string[];
  editLocked?: boolean;
  edit_locked?: boolean;
};

type ScanResponse = {
  ok?: boolean;
  mode?: ReviewMode;
  model?: string;
  scannedCount?: number;
  suspiciousCount?: number;
  items?: ReviewItem[];
  message?: string;
  detail?: string;
};

type ActionResponse = {
  ok?: boolean;
  message?: string;
  detail?: string;
  displayName?: string | null;
  editLocked?: boolean;
};

type EditableFields = {
  displayName: string;
  job: string;
  region: string;
  intro: string;
  strengths: string;
  ideal: string;
  preferredPartner: string;
  instagramId: string;
};

const SOURCE_LABEL: Record<string, string> = {
  open_card: "오픈카드",
  paid_card: "유료카드",
  one_on_one: "1대1 카드",
  open_card_application: "오픈카드 지원",
  paid_card_application: "유료카드 지원",
  one_on_one_application: "1대1 지원",
};

const LEVEL_LABEL: Record<SuspicionLevel, string> = {
  clear: "정상",
  low: "낮음",
  medium: "확인 필요",
  high: "강한 의심",
};

function itemSource(item: ReviewItem) {
  return item.sourceType ?? item.source_type ?? "open_card";
}

function isApplicationSource(sourceType: string) {
  return sourceType === "open_card_application" || sourceType === "paid_card_application" || sourceType === "one_on_one_application";
}

function itemCardId(item: ReviewItem) {
  return item.cardId ?? item.card_id ?? "";
}

function itemUserId(item: ReviewItem) {
  return item.userId ?? item.user_id ?? "";
}

function itemStatus(item: ReviewItem) {
  return item.status ?? item.card_status ?? "";
}

function itemEditLocked(item: ReviewItem) {
  return item.editLocked ?? item.edit_locked ?? false;
}

function itemDisplayName(item: ReviewItem) {
  return item.displayName ?? item.display_name ?? "이름 없음";
}

function itemReview(item: ReviewItem) {
  return {
    suspicionLevel: item.review?.suspicionLevel ?? item.suspicion_level ?? "low",
    flags: item.review?.flags ?? item.flags ?? [],
    summary: item.review?.summary ?? item.summary ?? "",
    photoFlags: item.review?.photoFlags ?? item.photo_flags ?? [],
    textFlags: item.review?.textFlags ?? item.text_flags ?? [],
    provider: item.review?.raw?.provider ?? item.raw_result?.provider ?? "",
  };
}

function itemKey(item: ReviewItem) {
  return `${itemSource(item)}:${itemCardId(item)}`;
}

function editableFieldsFromItem(item: ReviewItem): EditableFields {
  const editable = item.editableFields ?? {};
  const texts = item.texts ?? {};
  const displayName = item.displayName ?? item.display_name ?? "";
  return {
    displayName: editable.displayName ?? displayName,
    job: editable.job ?? texts.job ?? "",
    region: editable.region ?? item.region ?? "",
    intro: editable.intro ?? texts.intro ?? "",
    strengths: editable.strengths ?? texts.strengths ?? "",
    ideal: editable.ideal ?? texts.ideal ?? texts.idealType ?? "",
    preferredPartner: editable.preferredPartner ?? texts.preferredPartner ?? "",
    instagramId: editable.instagramId ?? texts.instagramId ?? "",
  };
}

function updateItemWithFields(item: ReviewItem, fields: EditableFields, displayName?: string | null): ReviewItem {
  const nextTexts = { ...(item.texts ?? {}) };
  if ("job" in nextTexts || fields.job) nextTexts.job = fields.job;
  if ("intro" in nextTexts || fields.intro) nextTexts.intro = fields.intro;
  if ("strengths" in nextTexts || fields.strengths) nextTexts.strengths = fields.strengths;
  if ("ideal" in nextTexts || fields.ideal) nextTexts.ideal = fields.ideal;
  if ("idealType" in nextTexts || fields.ideal) nextTexts.idealType = fields.ideal;
  if ("preferredPartner" in nextTexts || fields.preferredPartner) nextTexts.preferredPartner = fields.preferredPartner;
  if ("instagramId" in nextTexts || fields.instagramId) nextTexts.instagramId = fields.instagramId;

  return {
    ...item,
    displayName: displayName ?? fields.displayName,
    display_name: displayName ?? fields.displayName,
    region: fields.region,
    texts: nextTexts,
    editableFields: fields,
  };
}

function levelClass(level: SuspicionLevel) {
  if (level === "high") return "border-red-200 bg-red-50 text-red-700";
  if (level === "medium") return "border-amber-200 bg-amber-50 text-amber-700";
  if (level === "low") return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-neutral-200 bg-neutral-50 text-neutral-600";
}

function modeLabel(mode: ReviewMode) {
  return mode === "rules" ? "일반 검수" : "AI 검수";
}

export default function AdminDatingCardAiReviewPanel() {
  const [source, setSource] = useState<SourceType>("all");
  const [limit, setLimit] = useState("50");
  const [includeClear, setIncludeClear] = useState(false);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loadingMode, setLoadingMode] = useState<ReviewMode | null>(null);
  const [processingKey, setProcessingKey] = useState("");
  const [editingKey, setEditingKey] = useState("");
  const [editDrafts, setEditDrafts] = useState<Record<string, EditableFields>>({});
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const loadLatest = useCallback(async () => {
    setError("");
    try {
      const query = new URLSearchParams();
      if (source !== "all") query.set("source", source);
      if (includeClear) query.set("includeClear", "true");
      const res = await fetch(`/api/admin/dating/card-ai-review${query.size ? `?${query.toString()}` : ""}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as ScanResponse;
      if (!res.ok || body.ok === false) throw new Error(body.message || "최근 검수 목록을 불러오지 못했습니다.");
      setItems(body.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "최근 검수 목록을 불러오지 못했습니다.");
    }
  }, [includeClear, source]);

  useEffect(() => {
    void loadLatest();
  }, [loadLatest]);

  const runScan = async (mode: ReviewMode) => {
    setLoadingMode(mode);
    setError("");
    setInfo("");
    try {
      const res = await fetch("/api/admin/dating/card-ai-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          limit: Number(limit) || 50,
          mode,
          includeClear,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as ScanResponse;
      if (!res.ok || body.ok === false) {
        throw new Error([body.message, body.detail].filter(Boolean).join(" ") || "카드 검수에 실패했습니다.");
      }
      setItems(body.items ?? []);
      setInfo(
        `${modeLabel(mode)} 완료: ${body.scannedCount ?? 0}개 검사, 의심 ${body.suspiciousCount ?? 0}개 표시` +
          (body.model ? ` (${body.model})` : "")
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "카드 검수에 실패했습니다.");
    } finally {
      setLoadingMode(null);
    }
  };

  const handleAction = async (item: ReviewItem, action: "delete_card" | "send_warning_email" | "set_one_on_one_edit_lock") => {
    const sourceType = itemSource(item);
    const cardId = itemCardId(item);
    const review = itemReview(item);
    const nextEditLocked = !itemEditLocked(item);
    if (!cardId) return;

    const targetLabel = isApplicationSource(sourceType) ? "지원 내역" : "카드";
    if (action === "delete_card" && !window.confirm(`이 의심 ${targetLabel}을 삭제할까요? 삭제 후 복구가 어렵습니다.`)) {
      return;
    }

    const key = `${action}:${sourceType}:${cardId}`;
    setProcessingKey(key);
    setError("");
    setInfo("");

    try {
      const res = await fetch("/api/admin/dating/card-ai-review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          sourceType,
          cardId,
          summary: review.summary,
          flags: review.flags,
          locked: action === "set_one_on_one_edit_lock" ? nextEditLocked : undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as ActionResponse;
      if (!res.ok || body.ok === false) {
        throw new Error([body.message, body.detail].filter(Boolean).join(" ") || "처리에 실패했습니다.");
      }

      if (action === "delete_card") {
        setItems((prev) => prev.filter((candidate) => `${itemSource(candidate)}:${itemCardId(candidate)}` !== `${sourceType}:${cardId}`));
        setInfo(`${targetLabel}을 삭제했습니다.`);
      } else if (action === "set_one_on_one_edit_lock") {
        const locked = body.editLocked ?? nextEditLocked;
        setItems((prev) =>
          prev.map((candidate) =>
            `${itemSource(candidate)}:${itemCardId(candidate)}` === `${sourceType}:${cardId}`
              ? { ...candidate, editLocked: locked, edit_locked: locked }
              : candidate
          )
        );
        setInfo(locked ? "1대1 카드 사용자 수정을 잠갔습니다." : "1대1 카드 사용자 수정 잠금을 해제했습니다.");
      } else {
        setInfo("수정 경고 메일을 보냈습니다.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "처리에 실패했습니다.");
    } finally {
      setProcessingKey("");
    }
  };

  const startEdit = (item: ReviewItem) => {
    const key = itemKey(item);
    setEditingKey(key);
    setEditDrafts((prev) => ({ ...prev, [key]: prev[key] ?? editableFieldsFromItem(item) }));
    setError("");
    setInfo("");
  };

  const updateDraft = (key: string, field: keyof EditableFields, value: string) => {
    setEditDrafts((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] ?? {
          displayName: "",
          job: "",
          region: "",
          intro: "",
          strengths: "",
          ideal: "",
          preferredPartner: "",
          instagramId: "",
        }),
        [field]: value,
      },
    }));
  };

  const saveEdit = async (item: ReviewItem) => {
    const sourceType = itemSource(item);
    const cardId = itemCardId(item);
    const key = itemKey(item);
    const fields = editDrafts[key] ?? editableFieldsFromItem(item);
    if (!cardId) return;

    setProcessingKey(`update_fields:${key}`);
    setError("");
    setInfo("");
    try {
      const res = await fetch("/api/admin/dating/card-ai-review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_fields",
          sourceType,
          cardId,
          fields,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as ActionResponse;
      if (!res.ok || body.ok === false) {
        throw new Error([body.message, body.detail].filter(Boolean).join(" ") || "수정 저장에 실패했습니다.");
      }
      setItems((prev) =>
        prev.map((candidate) => (itemKey(candidate) === key ? updateItemWithFields(candidate, fields, body.displayName) : candidate))
      );
      setEditingKey("");
      setInfo("검수 항목 내용을 수정했습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "수정 저장에 실패했습니다.");
    } finally {
      setProcessingKey("");
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-violet-900">카드/지원 내역 검수</p>
            <p className="mt-1 text-xs text-neutral-500">
              일반 검수는 글자수·특정 문장·금칙어만 빠르게 보고, AI 검수는 사진까지 확인합니다. 카드와 지원 내역 모두 자동 조치는 하지 않습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadLatest()}
            className="h-9 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700"
          >
            최근 결과
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_120px_auto]">
          <select
            value={source}
            onChange={(event) => setSource(event.target.value as SourceType)}
            className="h-11 rounded-xl border border-neutral-200 bg-white px-3 text-sm"
          >
            <option value="all">전체: 카드/지원 내역</option>
            <option value="open_card">오픈카드</option>
            <option value="paid_card">유료카드</option>
            <option value="one_on_one">1대1 카드</option>
            <option value="open_card_application">오픈카드 지원</option>
            <option value="paid_card_application">유료카드 지원</option>
            <option value="one_on_one_application">1대1 지원</option>
          </select>
          <input
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            inputMode="numeric"
            className="h-11 rounded-xl border border-neutral-200 px-3 text-sm"
            placeholder="검사 수"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void runScan("rules")}
              disabled={loadingMode !== null}
              className="h-11 rounded-xl bg-neutral-900 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loadingMode === "rules" ? "검수 중..." : "일반 검수"}
            </button>
            <button
              type="button"
              onClick={() => void runScan("ai")}
              disabled={loadingMode !== null}
              className="h-11 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loadingMode === "ai" ? "AI 중..." : "AI 검수"}
            </button>
          </div>
        </div>

        <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-neutral-600">
          <input
            type="checkbox"
            checked={includeClear}
            onChange={(event) => setIncludeClear(event.target.checked)}
            className="h-4 w-4 rounded border-neutral-300"
          />
          정상/낮음 결과도 표시
        </label>
        <p className="mt-2 text-[11px] text-neutral-500">
          일반 검수는 비용 없이 빠르게 돌릴 수 있고, AI 검수는 사진/이미지 성격까지 보고 싶을 때만 쓰면 됩니다.
        </p>
        {info ? <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{info}</p> : null}
        {error ? <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-center text-sm text-neutral-500">
          표시할 의심 카드/지원 내역이 없습니다.
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => {
            const review = itemReview(item);
            const sourceType = itemSource(item);
            const cardId = itemCardId(item);
            const key = itemKey(item);
            const warningKey = `send_warning_email:${sourceType}:${cardId}`;
            const deleteKey = `delete_card:${sourceType}:${cardId}`;
            const updateKey = `update_fields:${key}`;
            const editLockKey = `set_one_on_one_edit_lock:${sourceType}:${cardId}`;
            const editLocked = itemEditLocked(item);
            const targetLabel = isApplicationSource(sourceType) ? "지원 삭제" : "카드 삭제";
            const draft = editDrafts[key] ?? editableFieldsFromItem(item);
            return (
              <div key={`${sourceType}-${cardId}`} className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-neutral-900 px-2.5 py-1 text-[11px] font-semibold text-white">
                        {SOURCE_LABEL[sourceType] ?? sourceType}
                      </span>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${levelClass(review.suspicionLevel)}`}>
                        {LEVEL_LABEL[review.suspicionLevel]}
                      </span>
                      {review.provider ? (
                        <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] text-neutral-500">{review.provider}</span>
                      ) : null}
                      <span className="text-xs text-neutral-500">{itemStatus(item)}</span>
                      {sourceType === "one_on_one" && editLocked ? (
                        <span className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700">수정잠금</span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm font-semibold text-neutral-900">
                      {itemDisplayName(item)} {item.age ? `/ ${item.age}세` : ""} {item.region ? `/ ${item.region}` : ""}
                    </p>
                    <p className="mt-1 break-all text-[11px] text-neutral-400">
                      card {cardId} / user {itemUserId(item) || "-"}
                    </p>
                  </div>
                  {item.previewUrls && item.previewUrls.length > 0 ? (
                    <div className="flex gap-2">
                      {item.previewUrls.map((url) => (
                        <img
                          key={url}
                          src={url}
                          alt="검수 사진"
                          className="h-20 w-20 rounded-xl border border-neutral-200 object-cover"
                        />
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleAction(item, "send_warning_email")}
                    disabled={processingKey !== "" || !itemUserId(item)}
                    className="h-9 rounded-xl border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {processingKey === warningKey ? "메일 발송 중..." : "수정 경고 메일"}
                  </button>
                  <button
                    type="button"
                    onClick={() => (editingKey === key ? setEditingKey("") : startEdit(item))}
                    disabled={processingKey !== ""}
                    className="h-9 rounded-xl border border-violet-200 bg-violet-50 px-3 text-xs font-semibold text-violet-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {editingKey === key ? "수정 닫기" : "카드 내용 수정"}
                  </button>
                  {sourceType === "one_on_one" ? (
                    <button
                      type="button"
                      onClick={() => void handleAction(item, "set_one_on_one_edit_lock")}
                      disabled={processingKey !== ""}
                      className={`h-9 rounded-xl border px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                        editLocked
                          ? "border-neutral-200 bg-white text-neutral-700"
                          : "border-red-200 bg-red-50 text-red-700"
                      }`}
                    >
                      {processingKey === editLockKey ? "처리 중..." : editLocked ? "수정 잠금 해제" : "수정 잠금"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handleAction(item, "delete_card")}
                    disabled={processingKey !== ""}
                    className="h-9 rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {processingKey === deleteKey ? "삭제 중..." : targetLabel}
                  </button>
                </div>

                {editingKey === key ? (
                  <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/50 p-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="text-[11px] font-semibold text-violet-900">
                        이름/닉네임
                        <input
                          value={draft.displayName}
                          onChange={(event) => updateDraft(key, "displayName", event.target.value)}
                          className="mt-1 h-9 w-full rounded-lg border border-violet-200 bg-white px-3 text-xs text-neutral-900 outline-none"
                        />
                      </label>
                      <label className="text-[11px] font-semibold text-violet-900">
                        직업
                        <input
                          value={draft.job}
                          onChange={(event) => updateDraft(key, "job", event.target.value)}
                          className="mt-1 h-9 w-full rounded-lg border border-violet-200 bg-white px-3 text-xs text-neutral-900 outline-none"
                        />
                      </label>
                      <label className="text-[11px] font-semibold text-violet-900">
                        지역
                        <input
                          value={draft.region}
                          onChange={(event) => updateDraft(key, "region", event.target.value)}
                          className="mt-1 h-9 w-full rounded-lg border border-violet-200 bg-white px-3 text-xs text-neutral-900 outline-none"
                        />
                      </label>
                      <label className="text-[11px] font-semibold text-violet-900">
                        인스타
                        <input
                          value={draft.instagramId}
                          onChange={(event) => updateDraft(key, "instagramId", event.target.value)}
                          className="mt-1 h-9 w-full rounded-lg border border-violet-200 bg-white px-3 text-xs text-neutral-900 outline-none"
                        />
                      </label>
                    </div>
                    <div className="mt-2 grid gap-2">
                      <label className="text-[11px] font-semibold text-violet-900">
                        소개
                        <textarea
                          value={draft.intro}
                          onChange={(event) => updateDraft(key, "intro", event.target.value)}
                          className="mt-1 min-h-[72px] w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs text-neutral-900 outline-none"
                        />
                      </label>
                      <label className="text-[11px] font-semibold text-violet-900">
                        강점
                        <textarea
                          value={draft.strengths}
                          onChange={(event) => updateDraft(key, "strengths", event.target.value)}
                          className="mt-1 min-h-[72px] w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs text-neutral-900 outline-none"
                        />
                      </label>
                      <label className="text-[11px] font-semibold text-violet-900">
                        원하는 상대/이상형
                        <textarea
                          value={draft.preferredPartner || draft.ideal}
                          onChange={(event) => {
                            updateDraft(key, "preferredPartner", event.target.value);
                            updateDraft(key, "ideal", event.target.value);
                          }}
                          className="mt-1 min-h-[72px] w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs text-neutral-900 outline-none"
                        />
                      </label>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void saveEdit(item)}
                        disabled={processingKey !== ""}
                        className="h-9 rounded-xl bg-violet-600 px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {processingKey === updateKey ? "저장 중..." : "수정 저장"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditDrafts((prev) => ({ ...prev, [key]: editableFieldsFromItem(item) }));
                          setEditingKey("");
                        }}
                        disabled={processingKey !== ""}
                        className="h-9 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 disabled:opacity-50"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : null}

                <p className="mt-3 rounded-xl bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
                  {review.summary || "요약 없음"}
                </p>

                {review.flags.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {review.flags.map((flag) => (
                      <span key={flag} className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                        {flag}
                      </span>
                    ))}
                  </div>
                ) : null}

                {item.texts ? (
                  <details className="mt-3 rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
                    <summary className="cursor-pointer font-semibold text-neutral-800">입력 문구 보기</summary>
                    <div className="mt-2 space-y-1">
                      {Object.entries(item.texts).map(([key, value]) =>
                        value ? (
                          <p key={key}>
                            <span className="font-semibold">{key}: </span>
                            {value}
                          </p>
                        ) : null
                      )}
                    </div>
                  </details>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
