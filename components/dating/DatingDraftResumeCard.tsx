import Link from "next/link";
import { datingDraftStepLabel, type DatingDraftResume } from "@/lib/dating-draft-resume";

export default function DatingDraftResumeCard({ draft, href }: { draft: DatingDraftResume; href: string }) {
  return (
    <section aria-label="작성 중인 프로필" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50/40 px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-bold leading-6 text-neutral-950">작성하던 프로필이 있어요</p>
        <p title="이 브라우저에 저장된 프로필입니다." className="mt-0.5 text-xs leading-5 text-neutral-500">{datingDraftStepLabel(draft.step)} · 임시저장</p>
      </div>
      <Link href={href} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-rose-600 px-3.5 text-xs font-bold text-white transition hover:bg-rose-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600">
        이어서 작성
      </Link>
    </section>
  );
}
