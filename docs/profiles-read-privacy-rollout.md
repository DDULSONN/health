# 회원 개인정보 조회 차단 적용 순서

## 범위

- 원본 `profiles`는 비로그인 조회 불가, 로그인 회원은 본인 행만 조회.
- 공개 작성자/알림 표시는 서버에서 `user_id,nickname,role`만 조회.
- 관리자 회원관리, 결제 후 연락처 교환은 기존 권한 확인 및 service-role 경로 유지.
- 매칭·결제·사진 데이터와 기능 자체는 변경하지 않음.
- 기존 닉네임 UPDATE 정책의 재귀 조회를 동일 조건의 비재귀 검사로 교체.
- 중요 필드의 직접 UPDATE/INSERT 차단(별도 보안 항목)은 이 READ 패치에 포함하지 않음.

## 순서 — DB부터 먼저 막지 말 것

1. 이 코드 패치를 배포하고 배포 성공을 확인한다. 아직 기존 DB 정책에서도 동작한다.
2. Supabase SQL Editor에서 현재 `profiles` 정책과 공개 뷰/함수 의존성을 확인한다. 저장소와 다른 정책이 있으면 검토 후 진행한다.
3. `supabase/sql/profiles_read_privacy_hardening.sql`을 DB 소유자 권한으로 실행한다. 실패하면 트랜잭션이 롤백된다. 해당 세션에서 `ROLLBACK` 후 오류를 확인한다.
4. `supabase/sql/profiles_read_privacy_verify.sql`을 실행한다. 실제 회원 값은 출력하지 않고 권한별 조회만 검증한다.
5. 공개 anon 키를 이용한 외부 REST HEAD 요청으로 `profiles?select=email`과 `profiles?select=phone_e164` 결과가 0행인지 확인한다.
6. 비로그인 게시글 작성자, 로그인 헤더/마이페이지, 알림 보낸 사람, 관리자 게시글/회원관리, 기존 승인 매칭 연락처를 실제 계정으로 확인한다. 검증 때문에 결제·문자 발송·프로필 변경을 실행하지 않는다.

## 실패 시

- 개인정보 공개 정책을 다시 여는 롤백은 하지 않는다.
- 조회 화면만 실패하면 서버의 최소 공개정보 조회 경로를 수정한다.
- 코드 전체를 이전 버전으로 되돌리면 작성자 표시 등이 다시 영향을 받을 수 있으므로 호환 패치는 유지한다.
- SQL 미적용 또는 외부 검증 전에는 “운영 취약점 차단 완료”라고 안내하지 않는다.

## 로컬 검증

`scripts/check-profiles-read-privacy.cjs`는 실제 DB에 접속하지 않는 PGlite 테스트다.
별도 임시 디렉터리에 `@electric-sql/pglite`를 설치하고 그 모듈 경로를
`PRIVACY_TEST_PGLITE_PATH` 환경변수로 지정한 뒤 실행한다. 서비스 키가 필요 없다.
닉네임 제한 정책, 추가 공개 정책, 반복 적용, 비로그인/본인/타인/service-role,
가입 INSERT, 휴대폰 인증/설정 UPDATE, 공개정보 최소 필드와 관리자 API를 검사한다.
