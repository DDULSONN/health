# 회원 탈퇴 오류 점검 / 수정 (2026-09-15)

## 재현한 오류

기존 `record_dating_1on1_card_profile_history()`는 1:1 카드의 DELETE에서도
항상 이력을 INSERT한다. `auth.users`를 삭제하면 FK CASCADE로 카드가 삭제되고,
이력 INSERT가 이미 삭제된 Auth 사용자를 참조해 `23503` 오류를 일으킨다.
계정과 카드가 모두 남는 결과를 격리 PostgreSQL(PGlite)에서 재현했다.

이는 저장소 SQL 기준 재현 결과다. 운영 함수 정의의 최종 대조는 Supabase
대시보드 재로그인 후 필요하다. 실제 회원을 테스트 목적으로 삭제하지 않았다.

## 수정 범위

- Auth 부모 계정이 없는 DELETE에 한해 이력 추가를 생략한다. 정상 회원의
  프로필 생성·수정·삭제 기록, FK와 RLS는 유지한다.
- 기존 운영 DB용 `supabase/sql/account_deletion_profile_history_fix.sql`과
  신규 설치용 `dating_1on1_card_profile_history.sql`에 같은 보호 조건을 넣었다.
- hard 삭제 실패 후 soft 삭제는 `cleanup_pending: true`로 표시한다.
  로그인 불가 상태와 전체 데이터 정리 완료를 구분한다. 관리자도 완료 문구 대신
  미완료 경고를 보며, 회원 브라우저는 비활성화된 계정에서 로그아웃한다.
- 본인 탈퇴 요청에 현재 세션 Bearer 토큰을 함께 보내 쿠키 인증 실패 시 기존
  서버 인증 fallback을 활용한다. 삭제 대상은 반드시 서버 검증 사용자이며,
  쿠키 계정과 화면 요청의 계정이 다르면 삭제하지 않는다.
- 성공한 본인 탈퇴 응답에서 해당 Supabase 프로젝트의 인증 쿠키(분할 쿠키 포함)만
  만료시킨다. 실패 시 쿠키를 삭제하지 않고, 관리자 본인의 쿠키도 건드리지 않는다.
- 브라우저는 local 로그아웃 후 전체 페이지를 새로 열어 마이페이지 상태를 버린다.
- 로그인 화면의 자동 이동은 캐시 세션이 아니라 Auth의 사용자 확인을 통과해야 한다.
  일시적인 통신 오류를 이유로 정상 회원을 강제 로그아웃시키지는 않는다.

## 배포 순서와 제한

1. 운영 SQL Editor에서 현재 함수와 트리거가 있는지 확인한다.
2. `account_deletion_profile_history_fix.sql`을 적용한다. 이 SQL 자체는 회원 데이터를
   삭제하지 않고 함수만 교체한다. 두 번 적용해도 같은 결과다.
3. 누락된 `account_deletion_audits` 테이블은 기존
   `supabase/sql/account_deletion_audits.sql`로 별도 설치해야 한다. 이력 테이블 누락은
   탈퇴 이력 저장 실패의 원인이며, 위 FK 오류와는 별개의 문제다.
4. 서버/브라우저 코드를 배포한다. 기존 브라우저 요청도 기존처럼 수용한다.
5. 승인된 테스트 계정으로 탈퇴 → Auth/프로필/매칭 데이터 제거 → 재접속 확인을 한다.

SQL 파일을 GitHub에 반영하는 것만으로 운영 DB에 적용되지는 않는다. 운영 SQL
적용은 별도 확인이 필요하며, 코드만 먼저 배포해도 SQL 미적용 시에는 hard 삭제가
계속 실패할 수 있다. 기존 soft 삭제
계정의 일괄 정리도 하지 않는다. Storage 소유 객체 등 다른 hard 삭제 실패 원인이
있으면 soft 경고를 토대로 해당 계정을 별도 확인해야 한다. 사진 파일 일괄 삭제나
법적 보존 데이터 정책은 변경하지 않는다.

로그인 화면의 기존 이메일 링크/소셜 로그인은 새 계정을 만들 수 있는 경로다.
탈퇴 후 이 경로로 다시 가입되는 것과 같은 Auth 계정이 남는 것은 다른 문제이며,
이번 수정에서 가입 정책은 바꾸지 않았다.

## 검증

```powershell
$env:ACCOUNT_DELETION_PGLITE_PATH = '<설치된 @electric-sql/pglite의 절대 경로>'
node --test scripts/check-account-deletion-regression.cjs
node scripts/check-account-deletion-matching.cjs
node scripts/check-auth-session-middleware.cjs
node scripts/check-account-recovery.cjs
node scripts/check-dating-1on1-sms-message.cjs
```

회귀 검사: 기존 DB 오류 재현, 패치 재적용, 일반 프로필 이력 유지, 다른 계정 보호,
FK 유지, 탈퇴 인증/계정 불일치 차단, 성공/실패에 따른 쿠키 정리, 실제 마이페이지
탈퇴 핸들러 실행, 삭제된 세션 자동 이동 방지, Auth 장애 시 정상 세션 보존.

추가로 로컬 `check-phone-contact-privacy-regression.cjs`의 번호 인증/번호 공개
검사를 실행했다. 이 스크립트와 기존 번호 인증 수정은 별도 작업의 미반영 변경이며
이번 탈퇴 패치에서 변경하지 않았다. 탈퇴 패치는 실제 문자 발송, 결제 승인,
추천 후보 선정 또는 연락처 공개 조건을 수정하지 않는다.

검증 결과: 신규 회귀 검사 9건 및 기존 탈퇴 검사 5개 시나리오 통과. 로그인/계정
찾기/1:1 문자·알림 검사 통과. 격리된 작업 복사본에서 Next 프로덕션 빌드 및 타입
검사 통과. 실제 빌드 서버의 비로그인 탈퇴 401, 외부 Origin 403, 잘못된 토큰 401,
비로그인 마이페이지의 로그인 이동을 확인했고, 브라우저 로그인 화면의 로딩 완료와
콘솔 오류 없음을 확인했다. ESLint는 오류 0개, 마이페이지 기존 미사용 변수 경고 3개다.
실제 운영 회원의 탈퇴 버튼을 누르는 종단 간 검사는 하지 않았다.
