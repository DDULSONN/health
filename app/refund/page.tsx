import type { Metadata } from "next";
import LegalPageLayout from "@/components/LegalPageLayout";

export const metadata: Metadata = {
  title: "환불 및 취소 규정",
  description: "짐툴 유료 서비스 환불 및 취소 규정",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export default function RefundPage() {
  return (
    <LegalPageLayout
      title="환불 및 취소 규정"
      description="유료 소개팅 및 기타 유료 기능 이용 전 확인해야 하는 기본 정책입니다."
      updatedAt="2026.03.29"
    >
      <Section title="1. 결제 전">
        <p>유료 서비스의 성격, 노출 방식, 사용 가능 기간, 제공 범위는 결제 전 안내 화면을 기준으로 합니다.</p>
      </Section>

      <Section title="2. 환불 가능 범위">
        <p>서비스가 실제로 제공되지 않았거나, 중대한 기술적 오류로 정상 이용이 불가능한 경우 운영 확인 후 환불이 검토될 수 있습니다.</p>
      </Section>

      <Section title="3. 환불이 제한될 수 있는 경우">
        <p>결제 후 노출, 신청, 매칭, 검토 등 서비스 제공이 이미 개시된 경우에는 환불이 제한될 수 있습니다.</p>
      </Section>

      <Section title="4. 문의">
        <p>결제, 취소, 환불 문의는 아래 이메일로 접수해 주세요.</p>
        <p className="font-medium text-neutral-900">문의: gymtools.kr@gmail.com</p>
      </Section>
    </LegalPageLayout>
  );
}
