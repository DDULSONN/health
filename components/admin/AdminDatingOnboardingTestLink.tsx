import Link from "next/link";

export default function AdminDatingOnboardingTestLink() {
  return (
    <Link
      href="/onboarding/dating"
      className="inline-flex h-7 items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 text-[11px] font-semibold text-amber-800 transition hover:bg-amber-100"
    >
      통합 작성 테스트
    </Link>
  );
}
