import Link from "next/link";

const TERMS = [
  {
    title: "플랫폼의 역할",
    body: "GymTools는 클래스 모집과 신청 연결을 돕는 플랫폼이며, 실제 클래스의 제공자 또는 현장 운영자가 아닙니다.",
  },
  {
    title: "운영자의 책임",
    body: "운영자는 등록한 클래스의 내용, 가격, 일정, 환불, 참가자 안내, 현장 안전 및 분쟁 처리에 대한 책임을 부담합니다.",
  },
  {
    title: "참가자 정보 관리",
    body: "운영자는 참가자 신청 정보를 클래스 안내와 참가자 관리 목적에 한해 사용해야 하며, 외부 유출이나 목적 외 사용을 해서는 안 됩니다.",
  },
  {
    title: "노출 제한",
    body: "허위 정보, 안전 문제, 신고, 분쟁, 약관 위반이 확인되면 GymTools는 클래스 노출 제한, 모집 중단, 운영자 정지를 할 수 있습니다.",
  },
  {
    title: "정산 및 환불",
    body: "유료 정산 구조가 적용되는 경우 별도 정산 기준을 따르며, 참가자에게 고지한 환불 기준은 운영자가 책임지고 이행해야 합니다.",
  },
  {
    title: "정원 및 성별 모집",
    body: "운영자는 전체 정원, 성별별 정원, 최소 진행 인원을 사실에 맞게 등록해야 하며 모집 현황이 달라질 경우 즉시 수정해야 합니다.",
  },
  {
    title: "안전 및 사고 대응",
    body: "운영자는 참가자의 운동 경험과 컨디션을 고려해 클래스를 진행하고, 부상·사고·장소 문제 발생 시 즉시 참가자와 GymTools에 알려야 합니다.",
  },
  {
    title: "촬영 및 홍보 활용",
    body: "사진 또는 영상 촬영이 있는 클래스는 사전에 명확히 고지해야 하며, 홍보 활용이 필요한 경우 참가자의 동의를 받아야 합니다.",
  },
];

export default function GymClassOperatorTermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/community/classes/manage" className="text-sm font-bold text-emerald-700">
        관리 페이지로 돌아가기
      </Link>
      <section className="mt-4 rounded-[32px] border border-neutral-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-black text-emerald-600">GymTools Class</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-neutral-950">입점 운영 약관</h1>
        <p className="mt-3 text-sm leading-6 text-neutral-500">
          버전: gym_operator_terms_v1. 입점 신청자는 아래 내용을 확인하고 동의해야 운영 신청을 등록할 수 있습니다.
        </p>
      </section>

      <section className="mt-4 space-y-3">
        {TERMS.map((item, index) => (
          <div key={item.title} className="rounded-[24px] border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
                {index + 1}
              </span>
              <div>
                <h2 className="font-black text-neutral-950">{item.title}</h2>
                <p className="mt-2 text-sm leading-7 text-neutral-600">{item.body}</p>
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="mt-4 rounded-[24px] border border-amber-200 bg-amber-50 p-5 text-sm leading-7 text-amber-900">
        본 약관은 운영 리스크를 줄이기 위한 서비스 고지이며, 실제 계약/정산/분쟁 구조가 커지는 경우 별도 계약서를 추가할 수 있습니다.
      </section>
    </main>
  );
}
