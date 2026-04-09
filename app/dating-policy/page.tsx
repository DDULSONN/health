import type { Metadata } from "next";
import LegalPageLayout from "@/components/LegalPageLayout";

export const metadata: Metadata = {
  title: "소개팅 안전/운영정책",
  description: "짐툴 소개팅 서비스의 성인 이용 제한, 신고/차단, 제재 및 악용 방지 정책",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export default function DatingPolicyPage() {
  return (
    <LegalPageLayout
      title="소개팅 안전/운영정책"
      description="짐툴은 소개팅 기능이 서비스 목적에 맞게 사용되도록 성인 이용 제한, 신고/차단, 운영자 제재 정책을 적용합니다."
      updatedAt="2026.04.08"
    >
      <Section title="1. 성인 이용 제한">
        <p>짐툴 소개팅 및 1:1 만남 관련 기능은 만 19세 이상 성인만 이용할 수 있습니다.</p>
        <p>미성년자의 가입 또는 이용이 확인되면 관련 계정과 콘텐츠는 즉시 제한 또는 삭제될 수 있습니다.</p>
      </Section>

      <Section title="2. 서비스 목적과 금지행위">
        <p>소개팅 기능은 건전한 만남과 커뮤니케이션을 위한 용도로만 사용할 수 있습니다.</p>
        <p>성매매·조건만남 유도, 불법 촬영물 공유, 사기/금전 요구, 신분 도용, 허위 프로필, 반복적 괴롭힘, 성희롱, 오프라인 범죄 유도 행위는 금지됩니다.</p>
      </Section>

      <Section title="3. 악용 방지 장치">
        <p>휴대폰 인증, 신고 기능, 차단 기능, 관리자 검토, 블러 이미지 노출, 로그 기록 및 정책 위반 제재를 통해 악용을 줄이고 있습니다.</p>
        <p>웹서비스 특성상 완전한 캡처 방지는 어렵지만, 서비스 목적 외 유출 및 악용이 확인되면 즉시 제재할 수 있습니다.</p>
      </Section>

      <Section title="4. 신고와 차단">
        <p>이용자는 부적절한 게시물, 프로필, 대화 상대를 신고하거나 차단할 수 있습니다.</p>
        <p>운영자는 신고 누적, 명백한 정책 위반, 범죄 악용 가능성이 확인되는 경우 해당 콘텐츠와 계정을 제한할 수 있습니다.</p>
      </Section>

      <Section title="5. 운영자 제재">
        <p>정책 위반 시 경고, 게시물 비노출, 소개팅 기능 제한, 유료 기능 회수, 계정 정지 또는 탈퇴 처리 등이 적용될 수 있습니다.</p>
        <p>사안이 중대한 경우 수사기관 협조 등 필요한 법적 조치를 검토할 수 있습니다.</p>
      </Section>

      <Section title="6. 문의 및 민원 접수">
        <p>결제, 소개팅, 악용 신고, 계정 관련 민원은 마이페이지 1:1 문의 또는 공개된 고객 문의 채널로 접수할 수 있습니다.</p>
        <p className="font-medium text-neutral-900">이메일: gymtools.kr@gmail.com</p>
        <p className="font-medium text-neutral-900">연락처: 010-8693-0657</p>
      </Section>
    </LegalPageLayout>
  );
}
