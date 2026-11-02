"use client";

type Props = {
  saving: boolean;
  error: string;
  onSelect: (sex: "male" | "female") => void;
};

// Presentation only: the parent retains the existing save and audience rules.
export default function ViewerSexSelection({ saving, error, onSelect }: Props) {
  return (
    <section aria-label="처음 카드 보기" aria-busy={saving} className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5 text-neutral-950 sm:p-6">
      <p className="text-xs font-medium text-neutral-500">카드를 보기 전에</p>
      <h2 className="mt-1 text-lg font-bold tracking-tight">내 성별을 알려주세요</h2>
      <p className="mt-2 text-sm leading-6 text-neutral-500">선택한 성별을 기준으로 이성의 오픈카드를 보여드려요.</p>
      <div className="mt-4 grid grid-cols-2 gap-3" role="group" aria-label="내 성별 선택">
        {([['male', '나는 남성'], ['female', '나는 여성']] as const).map(([sex, label]) => (
          <button key={sex} type="button" disabled={saving} onClick={() => onSelect(sex)}
            className="flex min-h-14 items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-800 transition-colors hover:border-rose-400 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 disabled:cursor-wait disabled:opacity-50">
            {label}<span aria-hidden="true" className="text-lg font-normal text-neutral-400">›</span>
          </button>
        ))}
      </div>
      {saving && <p role="status" className="mt-3 text-xs text-neutral-500">선택한 정보를 저장하고 있어요…</p>}
      {error && <p role="alert" className="mt-3 text-sm leading-6 text-rose-700">{error}</p>}
    </section>
  );
}
