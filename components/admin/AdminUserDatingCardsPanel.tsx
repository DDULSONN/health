"use client";

import { useState } from "react";

type CardRecord = Record<string, unknown>;
type CardKind = "open" | "one_on_one";

type CardDraft = {
  displayName: string;
  sex: string;
  age: string;
  birthYear: string;
  heightCm: string;
  job: string;
  region: string;
  trainingYears: string;
  strengths: string;
  ideal: string;
  intro: string;
  instagramId: string;
  phone: string;
  total3Lift: string;
  percentAll: string;
  smoking: string;
  workoutFrequency: string;
  status: string;
};

type Props = {
  userId: string;
  openCards: CardRecord[];
  oneOnOneCards: CardRecord[];
  onChanged: () => void | Promise<void>;
};

function value(item: CardRecord, key: string) {
  const raw = item[key];
  return raw == null ? "" : String(raw);
}

function makeDraft(kind: CardKind, item: CardRecord): CardDraft {
  return {
    displayName: value(item, kind === "open" ? "display_nickname" : "name"),
    sex: value(item, "sex"),
    age: value(item, "age"),
    birthYear: value(item, "birth_year"),
    heightCm: value(item, "height_cm"),
    job: value(item, "job"),
    region: value(item, "region"),
    trainingYears: value(item, "training_years"),
    strengths: value(item, "strengths_text"),
    ideal: value(item, kind === "open" ? "ideal_type" : "preferred_partner_text"),
    intro: value(item, "intro_text"),
    instagramId: value(item, "instagram_id"),
    phone: value(item, "phone"),
    total3Lift: value(item, "total_3lift"),
    percentAll: value(item, "percent_all"),
    smoking: value(item, "smoking") || "non_smoker",
    workoutFrequency: value(item, "workout_frequency") || "none",
    status: value(item, "status"),
  };
}

function Field({
  label,
  value: fieldValue,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number";
  placeholder?: string;
}) {
  return (
    <label className="block text-[11px] font-semibold text-neutral-600">
      {label}
      <input
        type={type}
        value={fieldValue}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 h-9 w-full rounded-lg border border-neutral-200 bg-white px-3 text-xs text-neutral-900 outline-none focus:border-violet-400"
      />
    </label>
  );
}

function TextAreaField({
  label,
  value: fieldValue,
  onChange,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <label className="block text-[11px] font-semibold text-neutral-600">
      {label}
      <textarea
        value={fieldValue}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        className="mt-1 w-full resize-y rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs leading-5 text-neutral-900 outline-none focus:border-violet-400"
      />
    </label>
  );
}

export default function AdminUserDatingCardsPanel({
  userId,
  openCards,
  oneOnOneCards,
  onChanged,
}: Props) {
  const [editingKey, setEditingKey] = useState("");
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const [busyKey, setBusyKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const updateDraft = (key: keyof CardDraft, nextValue: string) => {
    setDraft((current) => (current ? { ...current, [key]: nextValue } : current));
  };

  const startEdit = (kind: CardKind, item: CardRecord) => {
    const cardId = value(item, "id");
    setEditingKey(`${kind}:${cardId}`);
    setDraft(makeDraft(kind, item));
    setError("");
    setMessage("");
  };

  const saveCard = async (kind: CardKind, item: CardRecord) => {
    const cardId = value(item, "id");
    if (!cardId || !draft || busyKey) return;

    const key = `${kind}:${cardId}`;
    setBusyKey(key);
    setError("");
    setMessage("");
    try {
      const isOpen = kind === "open";
      const originalStatus = value(item, "status");
      const endpoint = isOpen
        ? `/api/admin/dating/cards/${encodeURIComponent(cardId)}`
        : `/api/admin/dating/1on1/cards/${encodeURIComponent(cardId)}`;
      const payload = isOpen
        ? {
            expected_owner_user_id: userId,
            display_nickname: draft.displayName,
            age: draft.age,
            region: draft.region,
            height_cm: draft.heightCm,
            job: draft.job,
            training_years: draft.trainingYears,
            strengths_text: draft.strengths,
            ideal_type: draft.ideal,
            instagram_id: draft.instagramId,
            total_3lift: draft.total3Lift,
            percent_all: draft.percentAll,
            ...(draft.status !== originalStatus ? { status: draft.status } : {}),
          }
        : {
            expected_user_id: userId,
            name: draft.displayName,
            sex: draft.sex,
            birth_year: draft.birthYear,
            height_cm: draft.heightCm,
            job: draft.job,
            region: draft.region,
            phone: draft.phone,
            intro_text: draft.intro,
            strengths_text: draft.strengths,
            preferred_partner_text: draft.ideal,
            smoking: draft.smoking,
            workout_frequency: draft.workoutFrequency,
            status: draft.status,
          };

      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || body.ok === false) {
        throw new Error(body.error ?? "카드 수정에 실패했습니다.");
      }

      setEditingKey("");
      setDraft(null);
      setMessage(`${isOpen ? "오픈카드" : "1:1 신청서"}를 수정했습니다.`);
      await onChanged();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "카드 수정에 실패했습니다.");
    } finally {
      setBusyKey("");
    }
  };

  const deleteCard = async (kind: CardKind, item: CardRecord) => {
    const cardId = value(item, "id");
    const displayName = value(item, kind === "open" ? "display_nickname" : "name") || cardId.slice(0, 8);
    if (!cardId || busyKey) return;
    if (!window.confirm(`${displayName} ${kind === "open" ? "오픈카드" : "1:1 신청서"}를 삭제할까요? 관련 진행 기록에도 영향을 줄 수 있습니다.`)) {
      return;
    }

    const key = `${kind}:${cardId}`;
    setBusyKey(key);
    setError("");
    setMessage("");
    try {
      const endpoint =
        kind === "open"
          ? `/api/admin/dating/cards/${encodeURIComponent(cardId)}?userId=${encodeURIComponent(userId)}`
          : `/api/admin/dating/1on1/cards/${encodeURIComponent(cardId)}?userId=${encodeURIComponent(userId)}`;
      const response = await fetch(endpoint, { method: "DELETE" });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || body.ok === false) {
        throw new Error(body.error ?? "카드 삭제에 실패했습니다.");
      }

      if (editingKey === key) {
        setEditingKey("");
        setDraft(null);
      }
      setMessage(`${kind === "open" ? "오픈카드" : "1:1 신청서"}를 삭제했습니다.`);
      await onChanged();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "카드 삭제에 실패했습니다.");
    } finally {
      setBusyKey("");
    }
  };

  const renderCard = (kind: CardKind, item: CardRecord, index: number) => {
    const cardId = value(item, "id");
    const key = `${kind}:${cardId}`;
    const isEditing = editingKey === key && draft;
    const isBusy = busyKey === key;
    const title =
      value(item, kind === "open" ? "display_nickname" : "name") ||
      `${kind === "open" ? "오픈카드" : "1:1 신청서"} ${index + 1}`;
    const photoPaths = Array.isArray(item.photo_paths) ? item.photo_paths : [];

    return (
      <div key={key} className="rounded-lg border border-neutral-200 bg-neutral-50/50 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-bold text-neutral-900">
              {title} · {value(item, "status") || "-"}
            </p>
            <p className="mt-1 text-[11px] text-neutral-500">
              {value(item, "region") || "지역 없음"} · {value(item, kind === "open" ? "age" : "birth_year") || "-"}
              {kind === "open" ? "세" : "년생"} · 사진 {photoPaths.length}장
            </p>
            <p className="mt-1 break-all text-[10px] text-neutral-400">{cardId}</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (isEditing) {
                  setEditingKey("");
                  setDraft(null);
                } else {
                  startEdit(kind, item);
                }
              }}
              disabled={Boolean(busyKey)}
              className="h-8 rounded-lg border border-violet-200 bg-white px-3 text-xs font-semibold text-violet-700 disabled:opacity-50"
            >
              {isEditing ? "닫기" : "수정"}
            </button>
            <button
              type="button"
              onClick={() => void deleteCard(kind, item)}
              disabled={Boolean(busyKey)}
              className="h-8 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 disabled:opacity-50"
            >
              {isBusy ? "처리 중..." : "삭제"}
            </button>
          </div>
        </div>

        {isEditing ? (
          <div className="mt-3 border-t border-neutral-200 pt-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <Field
                label={kind === "open" ? "표시 닉네임" : "이름"}
                value={draft.displayName}
                onChange={(next) => updateDraft("displayName", next)}
              />
              {kind === "one_on_one" ? (
                <label className="block text-[11px] font-semibold text-neutral-600">
                  성별
                  <select
                    value={draft.sex}
                    onChange={(event) => updateDraft("sex", event.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-neutral-200 bg-white px-3 text-xs text-neutral-900"
                  >
                    <option value="male">남성</option>
                    <option value="female">여성</option>
                  </select>
                </label>
              ) : null}
              <Field
                label={kind === "open" ? "나이" : "출생연도"}
                type="number"
                value={kind === "open" ? draft.age : draft.birthYear}
                onChange={(next) => updateDraft(kind === "open" ? "age" : "birthYear", next)}
              />
              <Field label="키(cm)" type="number" value={draft.heightCm} onChange={(next) => updateDraft("heightCm", next)} />
              <Field label="직업" value={draft.job} onChange={(next) => updateDraft("job", next)} />
              <Field label="지역" value={draft.region} onChange={(next) => updateDraft("region", next)} />
              {kind === "open" ? (
                <>
                  <Field
                    label="운동 경력"
                    type="number"
                    value={draft.trainingYears}
                    onChange={(next) => updateDraft("trainingYears", next)}
                  />
                  <Field
                    label="인스타그램 ID"
                    value={draft.instagramId}
                    onChange={(next) => updateDraft("instagramId", next)}
                  />
                  <Field
                    label="3대 중량"
                    type="number"
                    value={draft.total3Lift}
                    onChange={(next) => updateDraft("total3Lift", next)}
                  />
                  <Field
                    label="상위 퍼센트"
                    type="number"
                    value={draft.percentAll}
                    onChange={(next) => updateDraft("percentAll", next)}
                  />
                </>
              ) : (
                <>
                  <Field label="연락처" value={draft.phone} onChange={(next) => updateDraft("phone", next)} />
                  <label className="block text-[11px] font-semibold text-neutral-600">
                    흡연
                    <select
                      value={draft.smoking}
                      onChange={(event) => updateDraft("smoking", event.target.value)}
                      className="mt-1 h-9 w-full rounded-lg border border-neutral-200 bg-white px-3 text-xs text-neutral-900"
                    >
                      <option value="non_smoker">비흡연</option>
                      <option value="occasional">가끔</option>
                      <option value="smoker">흡연</option>
                    </select>
                  </label>
                  <label className="block text-[11px] font-semibold text-neutral-600">
                    운동 빈도
                    <select
                      value={draft.workoutFrequency}
                      onChange={(event) => updateDraft("workoutFrequency", event.target.value)}
                      className="mt-1 h-9 w-full rounded-lg border border-neutral-200 bg-white px-3 text-xs text-neutral-900"
                    >
                      <option value="none">운동 안 함</option>
                      <option value="1_2">주 1-2회</option>
                      <option value="3_4">주 3-4회</option>
                      <option value="5_plus">주 5회 이상</option>
                    </select>
                  </label>
                </>
              )}
              <label className="block text-[11px] font-semibold text-neutral-600">
                상태
                <select
                  value={draft.status}
                  onChange={(event) => updateDraft("status", event.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-neutral-200 bg-white px-3 text-xs text-neutral-900"
                >
                  {(kind === "open"
                    ? [
                        ["pending", "대기"],
                        ["public", "공개"],
                        ["hidden", "숨김"],
                        ["expired", "만료"],
                      ]
                    : [
                        ["submitted", "제출"],
                        ["reviewing", "검토"],
                        ["approved", "승인"],
                        ["rejected", "거절"],
                      ]
                  ).map(([statusValue, label]) => (
                    <option key={statusValue} value={statusValue}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-2 grid gap-2 lg:grid-cols-3">
              {kind === "one_on_one" ? (
                <TextAreaField label="자기소개" value={draft.intro} onChange={(next) => updateDraft("intro", next)} />
              ) : null}
              <TextAreaField label="강점" value={draft.strengths} onChange={(next) => updateDraft("strengths", next)} />
              <TextAreaField
                label={kind === "open" ? "이상형" : "원하는 상대"}
                value={draft.ideal}
                onChange={(next) => updateDraft("ideal", next)}
              />
            </div>

            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => void saveCard(kind, item)}
                disabled={isBusy}
                className="h-9 rounded-lg bg-violet-600 px-4 text-xs font-bold text-white disabled:opacity-60"
              >
                {isBusy ? "저장 중..." : "수정 저장"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <section className="rounded-lg border border-violet-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-violet-950">회원 매칭 카드 관리</p>
          <p className="mt-1 text-[11px] text-neutral-500">
            조회한 회원의 오픈카드와 1:1 신청서를 직접 수정하거나 삭제합니다.
          </p>
        </div>
        <span className="text-[11px] font-semibold text-neutral-500">
          오픈 {openCards.length} · 1:1 {oneOnOneCards.length}
        </span>
      </div>

      {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
      {message ? <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{message}</p> : null}

      <div className="mt-3 grid gap-4 xl:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-bold text-neutral-800">오픈카드</p>
          <div className="space-y-2">
            {openCards.length > 0 ? (
              openCards.map((item, index) => renderCard("open", item, index))
            ) : (
              <p className="rounded-lg bg-neutral-50 px-3 py-4 text-center text-xs text-neutral-500">등록한 오픈카드가 없습니다.</p>
            )}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-bold text-neutral-800">1:1 신청서</p>
          <div className="space-y-2">
            {oneOnOneCards.length > 0 ? (
              oneOnOneCards.map((item, index) => renderCard("one_on_one", item, index))
            ) : (
              <p className="rounded-lg bg-neutral-50 px-3 py-4 text-center text-xs text-neutral-500">등록한 1:1 신청서가 없습니다.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
