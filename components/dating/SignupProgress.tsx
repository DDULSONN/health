const steps = ["회원가입", "휴대폰 인증", "프로필 작성"];

export default function SignupProgress({ current }: { current: 0 | 1 | 2 }) {
  return (
    <ol aria-label="시작 단계" className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-neutral-400">
      {steps.map((label, index) => (
        <li key={label} aria-current={index === current ? "step" : undefined} className={index === current ? "font-semibold text-neutral-900" : ""}>
          {index > 0 && <span aria-hidden="true" className="mr-2 font-normal text-neutral-300">›</span>}
          {label}
        </li>
      ))}
    </ol>
  );
}
