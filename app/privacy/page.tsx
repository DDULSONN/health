import type { Metadata } from "next";
import LegalPageLayout from "@/components/LegalPageLayout";

export const metadata: Metadata = {
  title: "개인정보처리방침",
  description: "짐툴 개인정보처리방침",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <LegalPageLayout
      title="개인정보처리방침"
      description="짐툴은 회원가입, 커뮤니티, 소개팅, 유료 서비스 운영에 필요한 최소한의 개인정보를 처리합니다."
      updatedAt="2026.03.29"
    >
      <Section title="1. 수집하는 개인정보">
        <p>이메일, 닉네임, 비밀번호, 프로필 정보, 사진, 지역, 연락처, 소개팅 관련 입력값, 결제 및 이용 기록, 접속 로그, IP, 기기 정보가 서비스 이용 과정에서 처리될 수 있습니다.</p>
      </Section>

      <Section title="2. 개인정보 이용 목적">
        <p>회원 식별, 계정 관리, 커뮤니티 운영, 소개팅 매칭 및 신청 처리, 유료 서비스 제공, 부정 이용 방지, 고객 문의 대응, 서비스 품질 개선을 위해 개인정보를 이용합니다.</p>
      </Section>

      <Section title="3. 보관 및 파기">
        <p>개인정보는 목적 달성 후 지체 없이 파기하는 것을 원칙으로 합니다. 관계 법령 또는 분쟁 대응을 위해 보관이 필요한 경우 해당 기간 동안만 별도로 보관할 수 있습니다.</p>
      </Section>

      <Section title="4. 제3자 제공 및 처리 위탁">
        <p>서비스 운영을 위해 인증, 결제, 인프라, 데이터 저장과 관련된 외부 서비스를 이용할 수 있습니다. 이용자의 개인정보를 판매하지 않으며, 필요한 범위를 넘어 임의 제공하지 않습니다.</p>
      </Section>

      <Section title="5. 이용자의 권리">
        <p>이용자는 자신의 개인정보에 대해 조회, 수정, 삭제, 처리정지 요청을 할 수 있으며, 계정 탈퇴를 통해 서비스 이용을 종료할 수 있습니다.</p>
      </Section>

      <Section title="6. 문의">
        <p>개인정보 관련 문의는 아래 이메일로 접수할 수 있습니다.</p>
        <p className="font-medium text-neutral-900">문의: gymtools.kr@gmail.com</p>
      </Section>

      <p className="rounded-2xl bg-neutral-50 px-4 py-3 text-xs leading-6 text-neutral-500">
        운영 정보, 보유기간, 위탁사 목록 등은 실제 서비스 운영 현황에 따라 보완될 수 있습니다.
      </p>
    </LegalPageLayout>
  );
}
