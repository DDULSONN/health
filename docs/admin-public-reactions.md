# 관리자 외부 반응 모니터

## 표시 위치와 범위

마이페이지 → 관리자 → **외부 반응**. 선택한 관리자 탭만 지연 로딩합니다.
일반 회원 화면, 오픈카드, 1:1 추천·번호 교환·결제·인증 데이터에는 접근하지 않습니다.

매일 한국 시간 오전 9시 Vercel 서버에서 공개 웹을 검색합니다. PC/Codex 실행과 무관합니다.
현재 서비스의 `짐툴`, `helchang.com` 언급 중 커뮤니티·블로그·공개 SNS를 대상으로
최근 30일 글을 우선 검색합니다. 검색에 색인되지 않은 글, 비공개 게시물은 수집하지 못합니다.
AI 분류·요약은 참고 정보이며 반드시 원문으로 확인합니다. 자동 답글/메일/제재는 없습니다.

## 배포 전 필요한 설정

1. Supabase SQL Editor에서 `supabase/sql/admin_public_reactions.sql` 적용.
   새 전용 테이블/RPC만 생성합니다. 일반 사용자 역할에는 조회/실행 권한이 없습니다.
2. Vercel Production 환경 변수 설정:
   - `PUBLIC_REACTIONS_OPENAI_API_KEY`: Responses API, gpt-4.1-mini, web_search 사용 가능한 API 키.
     키는 채팅이나 Git에 붙이지 않고 Vercel 환경 변수에 직접 입력합니다.
   - `PUBLIC_REACTIONS_ENABLED=1`: 명시적 활성화. 없으면 검색하지 않습니다.
   - `CRON_SECRET`: 기존 값이 있다면 그대로 유지합니다. 없다면 충분히 긴 무작위 값 설정.
     **다른 cron도 사용하는 공통 변수이므로 기존 값을 임의로 교체하지 않습니다.**
3. 배포 후 관리자 탭에서 ‘오늘 반응 검색’으로 최초 실검색 확인.
4. Vercel의 Cron Jobs에서 `/api/cron/public-reactions` 등록, 실행 기록/HTTP 성공 확인.
   Hobby 플랜은 예약 시간 정밀도가 낮을 수 있습니다. 함수 실행 제한 180초를 지원하는 환경인지 확인합니다.
5. 다음 날 실행 이력과 관리자 마지막 완료 시각이 갱신됐는지 확인합니다.

검색 API는 유료입니다. ChatGPT 구독과 별도이며 API 프로젝트 예산/알림도 설정하세요.
실행당 API 요청 최대 2회, 웹 검색 도구 호출 최대 3회, 자동 실행 하루 1회입니다.
실패/중단 후에만 10분 뒤 관리자 수동 재시도 1회 허용합니다. 일 최대 2회 시도입니다.
`결과 새로고침`은 DB 조회만 하며 외부 검색이나 추가 AI 비용이 발생하지 않습니다.

## 안전장치

- 한국 날짜 고유키 + 원자적 DB 선점: cron 중복 전송·동시 관리자 클릭에도 중복 과금 방지.
- 현재 실행 토큰과 상태가 일치할 때만 완료 저장. 성공한 날짜 재검색 불가.
- 검색 실패/타임아웃/잘못된 구조/저장 실패는 0건으로 기록하지 않음. 이전 정상 결과 유지.
- 검색에 실제 등장한 출처 URL만 허용. 자체 사이트/자동 도메인 평가는 제외.
- 원문 URL은 링크 표시만 하며 서비스 인증 정보를 붙여 접근하지 않음.
- HTML 실행 없이 텍스트로 표시. 개인정보·전문 복제 금지 지침, 짧은 요약만 저장.
- 전용 테이블에 최대 하루 한 행. 90일 초과 검색 이력만 정리. 최근 14일 이력 선택 가능.
- 관리자 인증 + 기존 관리자 잠금 정책 적용. cron은 CRON_SECRET 미설정/오류 시 차단.
- 서버 환경 변수 누락 시 설정 대기 표시. 자동 갱신 지연·실패와 결과 없음 구분.

## 검증

`node --test scripts/check-public-reactions.cjs`

실제 PostgreSQL 구문·권한·선점 검증은 임시 폴더에 `@electric-sql/pglite`를 설치하고,
`PUBLIC_REACTION_PGLITE_PATH`에 해당 모듈 경로를 지정하여 같은 테스트를 실행합니다.
운영 데이터나 유료 API를 사용하는 테스트가 아닙니다.

키 설정 전에는 실제 검색 API 응답, Vercel 예약 실행 성공까지 검증했다고 할 수 없습니다.
코드/SQL 테스트 통과와 운영 활성화 완료를 구분해야 합니다.

## 공식 문서

- [OpenAI 웹 검색](https://developers.openai.com/api/docs/guides/tools-web-search)
- [OpenAI 구조화 출력](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI API 요금](https://developers.openai.com/api/docs/pricing)
- [Vercel Cron 운영](https://vercel.com/docs/cron-jobs/manage-cron-jobs)

문서 확인: 2026-09-14. 요금·모델·배포 환경 지원 사항은 활성화 시 다시 확인합니다.

## 이번 구현 확인 기록 (2026-09-14)

- 오프라인 회귀 테스트 30개 통과. 임시 PostgreSQL 엔진에서 SQL 재적용·권한·선점·재시도 검증 포함.
- TypeScript, 변경 파일 ESLint, 별도 빌드용 체크아웃에서 전체 프로덕션 빌드 통과.
- 실제 컴포넌트 + 가상 데이터로 390px 모바일 배치, 종류 필터, 오류/설정 대기, 재시도 버튼 확인.
- 운영 Supabase에 전용 SQL 적용 완료. RLS 켜짐, anon/authenticated 조회·RPC 실행 차단,
  service_role 실행 가능 확인. REST 조회도 서버 200/익명 401 확인. 저장된 검색은 아직 0건.
- 기존 회원·매칭·인증·결제 데이터는 변경하지 않음.
- API 키/활성화 환경 변수 설정은 미완료. 코드 배포와 별개로 실제 검색·다음 날 자동 실행은 아직 미검증.
