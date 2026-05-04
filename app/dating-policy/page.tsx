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
      description="오픈카드, 빠른매칭, 가까운 이상형 보기, 이상형 더보기, 1대1 소개팅을 안전하게 운영하기 위한 기준입니다."
      updatedAt="2026.05.05"
    >
      <Section title="1. 성인 이용 제한">
        <p>짐툴의 소개팅 및 만남 관련 기능은 만 19세 이상 성인만 이용할 수 있습니다.</p>
        <p>미성년자의 가입 또는 이용이 확인되면 관련 계정과 콘텐츠는 즉시 제한 또는 삭제될 수 있습니다.</p>
      </Section>

      <Section title="2. 금지 행위">
        <p>
          허위 프로필, 타인 사진 도용, 불법 촬영물 공유, 성희롱, 협박, 금전 요구, 사기 유도, 개인정보 무단 공개, 외부 범죄 유도 행위를 금지합니다.
        </p>
        <p>
          서비스 목적과 무관한 홍보, 반복적인 괴롭힘, 신고 회피를 위한 재가입, 매칭 상대의 연락처 무단 배포도 금지됩니다.
        </p>
      </Section>

      <Section title="3. 연락처 교환 기준">
        <p>
          1대1 소개팅 및 매칭 서비스에서 쌍방 수락, 결제, 관리자 승인 등 안내된 절차가 완료되면 이용자가 동의한 범위에서 연락처 또는 연결 정보가 공개될 수 있습니다.
        </p>
        <p>
          카카오페이 결제가 어려운 경우 오픈카톡 문의 후 운영자가 입금 확인 및 수동 승인 절차를 진행할 수 있습니다.
        </p>
      </Section>

      <Section title="4. 신고와 차단">
        <p>
          이용자는 부적절한 게시물, 프로필, 대화, 연락처 악용을 신고하거나 상대방을 차단할 수 있습니다.
        </p>
        <p>
          운영자는 신고 내용, 이용 기록, 운영정책 위반 여부를 검토해 콘텐츠 삭제, 기능 제한, 계정 정지, 탈퇴 처리 등 필요한 조치를 할 수 있습니다.
        </p>
      </Section>

      <Section title="5. 사진 및 몸평 콘텐츠">
        <p>
          몸평, 랭킹, 오픈카드 사진은 본인이 권리를 가진 이미지만 등록해야 하며 타인의 사진이나 불법 촬영물을 등록해서는 안 됩니다.
        </p>
        <p>
          비방, 조롱, 성희롱, 개인정보 노출 댓글은 삭제될 수 있으며 반복 위반 시 커뮤니티 이용이 제한됩니다.
        </p>
      </Section>

      <Section title="6. 운영상 제재">
        <p>
          운영정책 위반 시 경고, 게시물 비노출, 소개팅 기능 제한, 유료 기능 회수, 계정 정지 또는 탈퇴 처리가 적용될 수 있습니다.
        </p>
        <p>사안이 중대한 경우 수사기관 협조 등 필요한 법적 조치를 검토할 수 있습니다.</p>
      </Section>

      <Section title="7. 문의 및 민원 접수">
        <p>결제, 소개팅 악용 신고, 계정 관련 민원은 마이페이지 문의 또는 공개된 고객 문의 채널로 접수할 수 있습니다.</p>
        <p className="font-medium text-neutral-900">이메일: gymtools.kr@gmail.com</p>
        <p className="font-medium text-neutral-900">연락처: 010-8693-0657</p>
      </Section>
    </LegalPageLayout>
  );
}
