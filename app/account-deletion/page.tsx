import type { Metadata } from "next";
import Link from "next/link";
import LegalPageLayout from "@/components/LegalPageLayout";

export const metadata: Metadata = {
  title: "계정 삭제 안내",
  description: "썸핏 계정 및 관련 데이터 삭제 방법 안내",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
      <div className="space-y-2 text-sm leading-7 text-neutral-700">{children}</div>
    </section>
  );
}

export default function AccountDeletionPage() {
  return (
    <LegalPageLayout
      title="계정 삭제 안내"
      description="앱 또는 웹에서 직접 계정 삭제를 요청하는 방법과 삭제 후 처리되는 데이터를 안내합니다."
      updatedAt="2026.04.11"
    >
      <Section title="1. 계정 삭제 요청 방법">
        <p>썸핏 계정 삭제는 로그인 후 직접 요청할 수 있습니다.</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>썸핏 앱 또는 웹에 로그인합니다.</li>
          <li><span className="font-medium text-neutral-900">마이페이지</span>로 이동합니다.</li>
          <li>하단의 <span className="font-medium text-neutral-900">회원 탈퇴</span> 메뉴를 선택합니다.</li>
          <li>안내 문구를 확인한 뒤 탈퇴를 완료합니다.</li>
        </ol>
        <p>
          바로 이동: {" "}
          <Link href="/mypage" className="font-medium text-emerald-700 underline underline-offset-2">
            https://helchang.com/mypage
          </Link>
        </p>
      </Section>

      <Section title="2. 삭제되는 데이터">
        <ul className="list-disc space-y-1 pl-5">
          <li>기본 계정 정보</li>
          <li>프로필 및 소개팅 프로필 정보</li>
          <li>오픈카드, 빠른매칭, 지원 내역 등 소개팅 기능 관련 데이터</li>
          <li>앱 이용 과정에서 생성된 일반 사용자 데이터</li>
        </ul>
      </Section>

      <Section title="3. 일정 기간 보관될 수 있는 데이터">
        <p>다음 정보는 관련 법령 준수, 부정 이용 방지, 분쟁 대응을 위해 일정 기간 별도 보관될 수 있습니다.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>결제 및 환불 처리 기록</li>
          <li>신고, 차단, 운영 제재와 관련된 기록</li>
          <li>법령상 보관 의무가 있는 접속 및 거래 로그</li>
        </ul>
      </Section>

      <Section title="4. 추가 문의">
        <p>로그인 문제로 직접 탈퇴가 어렵거나 삭제 관련 문의가 필요한 경우 아래로 연락해 주세요.</p>
        <p className="font-medium text-neutral-900">이메일: gymtools.kr@gmail.com</p>
      </Section>
    </LegalPageLayout>
  );
}
