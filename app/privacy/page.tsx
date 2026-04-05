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
      description="짐툴은 회원가입, 커뮤니티, 소개팅, 결제 기능 제공에 필요한 최소한의 개인정보를 처리합니다."
      updatedAt="2026.04.05"
    >
      <Section title="1. 수집하는 개인정보">
        <p>이메일, 비밀번호, 닉네임, 프로필 정보, 사진, 지역, 연락처, 소개팅 관련 입력값, 결제 및 이용 기록, 접속 로그, IP, 기기 정보가 서비스 이용 과정에서 처리될 수 있습니다.</p>
      </Section>

      <Section title="2. 이용 목적">
        <p>회원 식별, 서비스 제공, 커뮤니티 운영, 소개팅 매칭 처리, 유료 기능 제공, 부정 이용 방지, 문의 대응, 서비스 개선을 위해 개인정보를 이용합니다.</p>
      </Section>

      <Section title="3. 보관 및 파기">
        <p>개인정보는 수집 및 이용 목적이 달성되면 지체 없이 파기하는 것을 원칙으로 합니다.</p>
        <p>다만 법령상 보관이 필요하거나 분쟁 대응을 위한 최소 정보는 정해진 기간 동안 별도로 보관될 수 있습니다.</p>
      </Section>

      <Section title="4. 제3자 제공 및 처리 위탁">
        <p>서비스 운영을 위해 인증, 스토리지, 결제, 호스팅 등 외부 서비스를 사용할 수 있습니다.</p>
        <p>이용자의 개인정보를 판매하지 않으며, 필요한 범위를 넘는 제3자 제공은 하지 않습니다.</p>
      </Section>

      <Section title="5. 이용자의 권리">
        <p>이용자는 자신의 개인정보에 대해 조회, 수정, 삭제, 처리정지를 요청할 수 있으며, 계정 탈퇴를 통해 이용을 종료할 수 있습니다.</p>
      </Section>

      <Section title="6. 문의처">
        <p>개인정보 관련 문의는 아래 연락처로 접수해 주세요.</p>
        <p className="font-medium text-neutral-900">이메일: gymtools.kr@gmail.com</p>
        <p className="font-medium text-neutral-900">연락처: 010-8693-0657</p>
      </Section>
    </LegalPageLayout>
  );
}
