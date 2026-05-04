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
      description="짐툴은 회원가입, 커뮤니티, 오픈카드, 1대1 소개팅, 결제 및 고객지원 제공에 필요한 최소한의 개인정보를 처리합니다."
      updatedAt="2026.05.05"
    >
      <Section title="1. 처리하는 개인정보 항목">
        <p>
          계정 정보: 이메일, 닉네임, 비밀번호 인증 정보, 로그인 기록, 접속 IP, 기기 및 브라우저 정보가 처리될 수 있습니다.
        </p>
        <p>
          서비스 이용 정보: 프로필, 성별, 나이, 지역, 키, 직업, 운동 경력, 사진, 게시글, 댓글, 신고, 차단, 매칭, 좋아요, 지원 및 결제 내역이 처리될 수 있습니다.
        </p>
        <p>
          본인 확인 및 소개팅 운영 정보: 휴대폰 번호, 인증 시도 기록, 인스타그램 아이디, 1대1 소개팅 카드와 연락처 교환에 필요한 정보가 처리될 수 있습니다.
        </p>
      </Section>

      <Section title="2. 처리 목적">
        <p>
          회원 식별, 서비스 제공, 오픈카드 및 1대1 소개팅 운영, 결제 처리, 부정 이용 방지, 신고 처리, 고객 문의 대응, 서비스 개선을 위해 개인정보를 이용합니다.
        </p>
        <p>
          유료 기능 결제 및 환불, 연락처 교환 승인, 운영자 검수, 안전한 커뮤니티 운영 등 서비스 제공에 필요한 범위에서만 이용합니다.
        </p>
      </Section>

      <Section title="3. 보유 및 파기">
        <p>
          개인정보는 수집 및 이용 목적이 달성되면 지체 없이 파기합니다. 다만 관계 법령상 보관이 필요한 결제, 환불, 소비자 분쟁, 부정 이용 방지 기록은 정해진 기간 동안 별도로 보관할 수 있습니다.
        </p>
        <p>
          회원 탈퇴 시 계정과 공개 프로필은 비활성화 또는 삭제되며, 부정 이용 방지와 문의 대응을 위한 최소한의 탈퇴 처리 기록은 최대 30일간 보관 후 파기합니다.
        </p>
      </Section>

      <Section title="4. 제3자 제공 및 처리 위탁">
        <p>
          짐툴은 서비스 운영에 필요한 범위를 넘어 개인정보를 판매하거나 임의로 제공하지 않습니다. 다만 쌍방 수락 후 연락처 교환이 완료되는 경우, 이용자가 동의한 범위에서 상대방에게 연락처 또는 연결 정보가 공개될 수 있습니다.
        </p>
        <p>
          서비스 운영을 위해 Supabase, Vercel, Resend, TossPayments 등 인증, 데이터 보관, 이메일 발송, 결제 처리를 위한 외부 서비스를 이용할 수 있습니다.
        </p>
      </Section>

      <Section title="5. 사진 및 콘텐츠 이용">
        <p>
          이용자가 등록한 사진, 오픈카드, 몸평 게시글 등은 서비스 내 노출, 매칭, 랭킹, 신고 검수에 사용될 수 있습니다.
        </p>
        <p>
          커뮤니티 몸평 게시글 등 외부 홍보 콘텐츠로 활용될 가능성이 있는 콘텐츠는 작성 화면에서 별도 안내하며, 이용자는 삭제 또는 문의를 통해 노출 중단을 요청할 수 있습니다.
        </p>
      </Section>

      <Section title="6. 이용자의 권리">
        <p>
          이용자는 본인의 개인정보에 대해 열람, 정정, 삭제, 처리정지, 회원 탈퇴를 요청할 수 있습니다. 다만 법령상 보관이 필요한 정보나 분쟁 처리에 필요한 최소 정보는 일정 기간 보관될 수 있습니다.
        </p>
      </Section>

      <Section title="7. 안전성 확보 조치">
        <p>
          짐툴은 관리자 접근 제한, 인증 기반 접근 통제, 접속 기록 확인, 민감 정보 마스킹, 파일 업로드 제한, 이상 이용 모니터링 등 개인정보 보호를 위한 기술적·관리적 조치를 적용합니다.
        </p>
      </Section>

      <Section title="8. 문의처">
        <p>개인정보, 계정 삭제, 결제 및 서비스 이용 관련 문의는 아래 연락처로 접수해 주세요.</p>
        <p className="font-medium text-neutral-900">이메일: gymtools.kr@gmail.com</p>
        <p className="font-medium text-neutral-900">연락처: 010-8693-0657</p>
      </Section>
    </LegalPageLayout>
  );
}
