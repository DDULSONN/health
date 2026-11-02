import Link from "next/link";

type Props = {
  title: string;
  body: string;
  href: string;
  action: string;
  loginHref?: string;
};

// A single, non-blocking next step. Auth, eligibility and drafts remain owned by the page.
export default function ProfileStartCard({ title, body, href, action, loginHref }: Props) {
  return (
    <section aria-label="내 소개 시작하기" className="mb-4 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5">
      <h2 className="text-lg font-semibold tracking-tight text-neutral-950">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-neutral-500">{body}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link href={href} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-rose-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-rose-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600">
          {action}
        </Link>
        {loginHref ? <Link href={loginHref} className="inline-flex min-h-11 items-center text-xs text-neutral-500 underline underline-offset-4 hover:text-neutral-800">이미 가입했어요</Link> : null}
      </div>
    </section>
  );
}
