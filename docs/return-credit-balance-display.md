# 지원권 지급 이력과 잔액 표시

복귀·첫 프로필 혜택의 `rewarded` 상태는 지급 이력이며 현재 잔액이 아니다.
배너에는 지급 완료 이력임을 표시하고 `/dating/apply-credits`의 잔액 확인으로 연결한다.

배너에서 지급 POST가 성공하고 동일 계정의 `rewarded` 응답을 확인했을 때만
`gymtools:apply-credit-balance-changed` 이벤트를 보낸다. 이벤트에는 회원 ID만 담는다.
홈 지원권 표시와 지원권 내역 화면은 기존 잔액 응답을 폐기하고 서버에서 다시 조회한다.
클라이언트에서 지원권 수량을 더하지 않으며, 조회 실패를 0장으로 처리하지 않는다.

홈이 백그라운드에 있다면 복귀 후 다시 조회한다. 다른 계정의 이벤트는 무시하고,
지급 전 시작한 느린 응답이 새로운 잔액을 덮어쓰지 못하도록 요청을 취소·구분한다.
기존 지급 SQL, 지원권 차감, 결제 생성·승인, 매칭, 연락처 공개 로직은 변경하지 않는다.

## 검증

- `node --test scripts/check-apply-credit-balance-events.cjs`
- `node scripts/check-return-credit-balance-browser.cjs`
- `node scripts/check-return-profile-reward-browser.cjs`
- `node scripts/check-first-profile-reward-browser.cjs`
- `node scripts/check-contextual-paid-offers-browser.cjs`
- `node scripts/check-critical.cjs`

브라우저 검사는 실제 React 컴포넌트와 격리된 가상 HTTP 응답을 사용한다.
첫 프로필 혜택 검사는 실제 API와 로컬 PostgreSQL도 함께 검사한다.
운영 계정의 지원권 지급·사용이나 실제 결제는 수행하지 않는다.
검사 환경에는 Playwright 런타임과 빌드된 `.next/static/css`가 필요하다.
