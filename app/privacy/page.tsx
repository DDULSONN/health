import type { Metadata } from "next";
import LegalPageLayout from "@/components/LegalPageLayout";

export const metadata: Metadata = {
  title: "개인정보처리방침",
  description: "짐툴 개인정보처리방침",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
      <div className="space-y-2 text-sm leading-6 text-neutral-700">{children}</div>
    </section>
  );
}
function PolicyTable({
  rows,
}: {
  rows: Array<{ item: string; purpose: string; retention: string }>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200">
      <table className="min-w-full border-collapse text-left text-xs sm:text-sm">
        <thead className="bg-neutral-50 text-neutral-800">
          <tr>
            <th className="border-b border-neutral-200 px-3 py-2 font-semibold">처리 항목</th>
            <th className="border-b border-neutral-200 px-3 py-2 font-semibold">처리 목적</th>
            <th className="border-b border-neutral-200 px-3 py-2 font-semibold">보유 및 파기 기준</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.item} className="align-top">
              <td className="border-b border-neutral-100 px-3 py-2 font-medium text-neutral-900">{row.item}</td>
              <td className="border-b border-neutral-100 px-3 py-2">{row.purpose}</td>
              <td className="border-b border-neutral-100 px-3 py-2">{row.retention}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <LegalPageLayout
      title="개인정보처리방침"
      description="짐툴은 서비스 제공에 필요한 최소한의 개인정보를 처리하며, 항목별 목적과 보유기간을 투명하게 안내합니다."
      updatedAt="2026.05.27"
    >
      <Section title="1. 처리하는 개인정보 항목">
        <PolicyTable
          rows={[
            {
              item: "계정 정보",
              purpose: "회원가입, 로그인, 본인 계정 식별, 고객지원",
              retention: "회원 탈퇴 시 지체 없이 파기합니다. 다만 부정 이용 방지, 분쟁 대응을 위한 최소 기록은 최대 30일 보관 후 파기합니다.",
            },
            {
              item: "프로필 정보",
              purpose: "닉네임 표시, 커뮤니티 및 랭킹 기능 제공",
              retention: "회원 탈퇴 또는 직접 삭제 시 파기합니다. 공개 게시물은 삭제 요청 또는 운영 정책에 따라 비공개/삭제 처리합니다.",
            },
            {
              item: "오픈카드 및 유료카드 정보",
              purpose: "오픈카드 등록, 심사, 노출, 지원, 매칭, 신고 대응",
              retention: "카드 만료, 삭제, 탈퇴 또는 운영 목적 달성 시 파기합니다. 신고/분쟁 관련 기록은 관계 법령 및 분쟁 대응 목적에 필요한 기간 동안 별도 보관할 수 있습니다.",
            },
            {
              item: "사진 및 이미지",
              purpose: "카드 등록, 심사, 매칭, 신고 검토, 부정 이용 방지",
              retention: "원본 및 경량 이미지는 카드 삭제, 만료, 탈퇴 또는 목적 달성 시 파기합니다. 지원 사진의 관리자 검수용 경량 백업은 업로드일로부터 최대 14일 보관 후 자동 삭제합니다.",
            },
            {
              item: "인스타그램 아이디",
              purpose: "오픈카드 지원, 연결 성사 후 연락처 교환",
              retention: "지원/연결 기록 유지 기간 동안 보관하며, 탈퇴·삭제·분쟁 목적 종료 시 파기합니다.",
            },
            {
              item: "휴대폰 번호 및 인증 기록",
              purpose: "휴대폰 본인 확인, 1:1 소개팅 신청, 연락처 교환, 중복/차단 방지",
              retention: "인증 상태 유지를 위해 회원 탈퇴 전까지 보관할 수 있습니다. 인증 시도 로그는 보안·부정 이용 방지 목적에 필요한 기간 동안 보관 후 파기하며, 가능한 경우 해시 또는 마스킹 형태로 관리합니다.",
            },
            {
              item: "결제 정보",
              purpose: "유료 기능 결제, 환불, 구매 이력 확인, 오류 대응",
              retention: "전자상거래 등 관계 법령상 보관 의무가 있는 기간 동안 보관 후 파기합니다. 카드번호 등 결제수단 원문은 짐툴 서버에 저장하지 않습니다.",
            },
            {
              item: "신고, 차단, 제재 기록",
              purpose: "커뮤니티 안전, 부정 이용 방지, 분쟁 처리",
              retention: "처리 목적 달성 시 파기하되, 반복 위반 방지 및 분쟁 대응을 위해 필요한 기간 동안 별도 보관할 수 있습니다.",
            },
            {
              item: "관리자 접속 및 처리 기록",
              purpose: "관리자 열람, 다운로드, 환불, 사진 검수 등 개인정보 처리 행위의 감사 및 사고 대응",
              retention: "접속기록 및 처리내역은 법령상 요구되는 기간 또는 보안 점검에 필요한 기간 동안 안전하게 보관하고, 기간 경과 후 파기합니다.",
            },
          ]}
        />
      </Section>

      <Section title="2. 개인정보 처리 목적">
        <p>
          짐툴은 계정 운영, 커뮤니티 제공, 오픈카드 및 1:1 소개팅 운영, 결제와 환불 처리, 신고 및 고객문의 대응,
          부정 이용 방지, 서비스 개선을 위해 개인정보를 처리합니다. 목적에 필요한 범위를 넘어서 이용하지 않습니다.
        </p>
      </Section>

      <Section title="3. 보유기간 및 파기">
        <p>
          개인정보는 처리 목적이 달성되거나 회원 탈퇴, 삭제 요청이 있는 경우 지체 없이 파기합니다. 다만 전자상거래,
          소비자 분쟁, 부정 이용 방지, 신고·제재 대응 등 법령 또는 정당한 운영 목적상 보관이 필요한 정보는 별도 분리하여
          필요한 기간 동안만 보관합니다.
        </p>
        <p>
          전자파일은 복구하기 어렵도록 삭제하며, 출력물 등 물리 매체가 있는 경우 분쇄 또는 이에 준하는 방법으로 파기합니다.
          지원 사진 백업은 관리자 검수 및 분쟁 대응 목적의 경량 WebP 파일로만 생성되며 최대 14일 보관 후 삭제됩니다.
        </p>
      </Section>

      <Section title="4. 제3자 제공 및 처리위탁">
        <p>
          짐툴은 이용자의 동의가 있거나 법령상 허용되는 경우를 제외하고 개인정보를 제3자에게 임의로 제공하지 않습니다.
          매칭 또는 연락처 교환이 성사되어 이용자가 동의한 경우, 필요한 범위에서 상대방에게 인스타그램 아이디 또는
          연락처가 공개될 수 있습니다.
        </p>
        <PolicyTable
          rows={[
            { item: "Supabase", purpose: "인증, 데이터베이스, 파일 저장", retention: "서비스 운영 기간 및 계약 종료 시까지" },
            { item: "Vercel", purpose: "웹사이트 호스팅, 서버리스 함수 실행, 로그 처리", retention: "서비스 운영 기간 및 계약 종료 시까지" },
            { item: "TossPayments", purpose: "결제 승인, 취소, 환불 처리", retention: "전자상거래 관련 법령상 보관 기간" },
            { item: "Resend", purpose: "서비스 안내 및 고객지원 이메일 발송", retention: "발송 목적 달성 또는 계약 종료 시까지" },
          ]}
        />
      </Section>

      <Section title="5. 사진, 신고, 관리자 열람">
        <p>
          사진은 카드 노출, 심사, 신고 검토 및 부정 이용 방지를 위해 처리됩니다. 관리자는 운영상 필요한 경우에만 사진,
          신고 내용, 결제/환불 정보, 고객문의 내용을 열람할 수 있으며, 주요 열람·다운로드·환불·수동 인증 행위는 감사기록으로
          남길 수 있습니다.
        </p>
        <p>
          신고 또는 차단 기능을 이용하는 경우 신고 사유, 대상 계정, 처리 상태, 관련 콘텐츠 일부가 운영 검토를 위해 저장될 수
          있습니다. 허위 신고나 악의적 이용은 서비스 이용 제한 사유가 될 수 있습니다.
        </p>
      </Section>

      <Section title="6. 안전성 확보조치">
        <p>
          짐툴은 관리자 접근권한 제한, 인증 기반 접근 통제, HTTPS 전송 암호화, 민감 정보 마스킹, 파일 업로드 제한,
          관리자 처리 감사로그, 접속기록 점검, 부정 이용 모니터링 등 개인정보 보호를 위한 기술적·관리적 조치를 적용합니다.
        </p>
      </Section>

      <Section title="7. 이용자의 권리">
        <p>
          이용자는 본인의 개인정보에 대해 열람, 정정, 삭제, 처리정지, 회원 탈퇴를 요청할 수 있습니다. 법령상 보관 의무가
          있거나 신고·분쟁 처리를 위해 필요한 최소 정보는 해당 목적 달성 시까지 분리 보관될 수 있습니다.
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
