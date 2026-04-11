import type { Metadata } from "next";
import LegalPageLayout from "@/components/LegalPageLayout";

export const metadata: Metadata = {
  title: "아동 안전 표준",
  description: "썸핏의 아동 성적 학대 및 착취 방지 정책 안내",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
      <div className="space-y-2 text-sm leading-7 text-neutral-700">{children}</div>
    </section>
  );
}

export default function ChildSafetyPage() {
  return (
    <LegalPageLayout
      title="아동 안전 표준"
      description="썸핏은 아동 성적 학대 및 착취(CSAE)를 포함한 아동 대상 유해 행위를 엄격히 금지합니다."
      updatedAt="2026.04.11"
    >
      <Section title="1. 기본 원칙">
        <p>
          썸핏은 아동 성적 학대 및 착취(CSAE), 아동 성적 대상화, 아동 대상 그루밍, 미성년자 대상
          성적 유인 행위, 관련 이미지 또는 콘텐츠의 제작·공유·홍보를 엄격히 금지합니다.
        </p>
        <p>
          서비스 내에서 위와 같은 행위가 확인되거나 합리적으로 의심되는 경우, 관련 콘텐츠와 계정은
          즉시 검토 대상이 되며 필요한 조치가 진행됩니다.
        </p>
      </Section>

      <Section title="2. 금지되는 행위">
        <ul className="list-disc space-y-1 pl-5">
          <li>미성년자를 성적 대상으로 표현하거나 유도하는 행위</li>
          <li>아동·청소년 대상 성적 대화, 접근, 협박, 유인 또는 착취 행위</li>
          <li>아동 성적 학대 자료(CSAM) 또는 관련 링크, 설명, 홍보성 콘텐츠의 게시 및 전송</li>
          <li>연령을 속여 미성년자에게 접근하거나 불법적 만남을 유도하는 행위</li>
        </ul>
      </Section>

      <Section title="3. 신고 및 대응">
        <p>
          사용자는 앱 내 신고 기능 또는 아래 연락처를 통해 관련 계정이나 콘텐츠를 신고할 수 있습니다.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>신고된 계정 및 콘텐츠는 우선 검토 대상이 됩니다.</li>
          <li>위반이 확인되면 콘텐츠 삭제, 계정 제한 또는 영구 이용 정지 조치를 할 수 있습니다.</li>
          <li>필요한 경우 관련 법령에 따라 수사기관 또는 아동 보호 기관과 협조할 수 있습니다.</li>
        </ul>
      </Section>

      <Section title="4. 연령 제한">
        <p>
          썸핏은 성인 대상 서비스입니다. 서비스 이용은 성인 사용자 기준으로 운영되며, 미성년자의
          이용이 확인되는 경우 계정 제한 또는 삭제 조치가 진행될 수 있습니다.
        </p>
      </Section>

      <Section title="5. 문의 및 신고 접수">
        <p>아동 안전 관련 문의 또는 신고는 아래 이메일로 접수해 주세요.</p>
        <p className="font-medium text-neutral-900">이메일: gymtools.kr@gmail.com</p>
      </Section>
    </LegalPageLayout>
  );
}
