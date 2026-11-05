import Link from "next/link";
import { oneOnOneProfileState, ONE_ON_ONE_PROFILE_MANAGE_HREF, type OneOnOneProfileStateInput } from "@/lib/dating-1on1-profile-state";

export default function OneOnOneProfileStateNotice({ profile, showManageLink = false }: {
  profile: OneOnOneProfileStateInput;
  showManageLink?: boolean;
}) {
  const state = oneOnOneProfileState(profile);
  if (state.kind === "active") return null;
  return <section aria-label="내 프로필 상태" className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
    <p className="text-sm font-semibold text-neutral-900">{state.title}</p>
    <p className="mt-1 text-xs leading-5 text-neutral-600">{showManageLink ? state.body : state.kind === "archived"
      ? "새 후보에게는 표시되지 않아요. 다시 이용하려면 아래 ‘프로필 다시 올리기’를 눌러 주세요."
      : "공개 보류 사유나 수정 방법은 고객센터로 문의해 주세요."}</p>
    <p className="mt-1 text-[11px] leading-5 text-neutral-500">프로필 노출 상태와 기존 매칭 내역은 별도로 확인할 수 있어요.</p>
    {showManageLink ? <Link href={ONE_ON_ONE_PROFILE_MANAGE_HREF} className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-800">
      {state.kind === "archived" ? "내 프로필 관리" : "프로필 상태 확인"}
    </Link> : state.kind === "held" ? <a href="https://open.kakao.com/o/s2gvTdhi" target="_blank" rel="noreferrer" className="mt-1 inline-flex min-h-11 items-center text-xs font-medium text-neutral-700 underline underline-offset-4">고객센터 문의</a> : null}
  </section>;
}
