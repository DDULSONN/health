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
      description="유료 오픈카드, 이상형 보기, 지원권, 빠른매칭 플러스, 1대1 연락처 교환 등 유료 기능 이용 전 확인해야 하는 기준입니다."
      updatedAt="2026.05.05"
    >
      <Section title="1. 결제 전 확인사항">
        <p>
          각 상품의 가격, 제공 내용, 이용 기간, 노출 방식, 승인 절차는 결제 화면 또는 상품 안내 화면의 내용을 기준으로 적용됩니다.
        </p>
        <p>
          일부 상품은 결제 즉시 열람 권한, 노출 권한, 지원권 지급, 연락처 교환 등 디지털 서비스 제공이 시작됩니다.
        </p>
      </Section>

      <Section title="2. 환불 검토가 가능한 경우">
        <p>
          결제는 완료되었으나 시스템 오류 또는 운영상 사유로 서비스가 정상 제공되지 않은 경우, 확인 후 환불 또는 복구 처리를 검토합니다.
        </p>
        <p>
          중복 결제, 명백한 결제 오류, 결제 내역 미반영이 확인되는 경우에도 문의 접수 후 결제사 기록과 서비스 이용 상태를 확인해 처리합니다.
        </p>
      </Section>

      <Section title="3. 환불이 제한될 수 있는 경우">
        <p>
          유료 노출이 시작된 경우, 이상형 목록 열람이 제공된 경우, 지원권이 지급된 경우, 매칭 또는 연락처 교환 기능이 제공된 경우에는 단순 변심 환불이 제한될 수 있습니다.
        </p>
        <p>
          이용자의 입력 실수, 안내 미확인, 프로필 변경 요청, 서비스 제공 이후의 개인적 사정은 환불 사유로 인정되지 않을 수 있습니다.
        </p>
      </Section>

      <Section title="4. 상품별 기준">
        <p>
          대기없이 등록, 유료 오픈카드, 상단 고정 노출 상품은 결제 후 노출 또는 승인 절차가 시작되면 서비스 제공이 개시된 것으로 봅니다.
        </p>
        <p>
          이상형 더보기, 가까운 이상형 보기 등 열람 상품은 결제 후 목록 접근 권한이 부여되면 서비스 제공이 개시된 것으로 봅니다.
        </p>
        <p>
          지원권 구매는 지원권 지급이 완료된 뒤에는 사용 여부와 관계없이 환불이 제한될 수 있습니다.
        </p>
        <p>
          1대1 연락처 교환은 쌍방 수락 후 결제 또는 관리자 승인으로 연락처 공개 절차가 시작되면 환불이 제한될 수 있습니다.
        </p>
      </Section>

      <Section title="5. 문의처">
        <p>환불, 취소, 결제 오류 문의는 주문번호, 결제 시간, 닉네임을 함께 알려주시면 더 빠르게 확인할 수 있습니다.</p>
        <p className="font-medium text-neutral-900">이메일: gymtools.kr@gmail.com</p>
        <p className="font-medium text-neutral-900">연락처: 010-8693-0657</p>
      </Section>

      <p className="rounded-2xl bg-neutral-50 px-4 py-3 text-xs leading-6 text-neutral-500">
        실제 환불 가능 여부는 결제 시점, 서비스 제공 여부, 이용 내역, 결제사 기록, 관계 법령에 따라 개별 검토됩니다.
      </p>
    </LegalPageLayout>
  );
}
