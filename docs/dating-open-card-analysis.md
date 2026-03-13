# Open Card Dating Analysis

기준 시점: 2026-03-09

## 1. 웹 오픈카드 핵심 구조

- 공개 오픈카드는 성별별 슬롯이 `20개`로 고정된다.
- 공개 상태 유지 시간은 `24시간`이다.
- 슬롯이 차면 신규 카드는 `pending` 대기열로 들어간다.
- 공개 카드가 만료되면 대기열에서 자동 승격된다.

참고:
- `lib/dating-open.ts`
- `lib/dating-cards-queue.ts`

## 2. 일반 오픈카드 지원 정책

- 기본 지원은 `KST 하루 2회`다.
- 기본 2회를 모두 쓰면 `지원권`이 있으면 추가 지원 가능하다.
- 지원 시 카드 상태가 `public`이 아니어도 아래 권한이 있으면 허용된다.
  - 이상형 더보기 승인
  - 가까운 이상형 승인
- 지원 수락 시:
  - 해당 오픈카드는 `hidden`
  - 다른 대기 지원은 자동 `rejected`
  - 인스타 교환 대상이 된다

참고:
- `app/api/dating/cards/apply/route.ts`
- `app/api/dating/cards/applications/[id]/route.ts`
- `app/api/dating/cards/my/connections/route.ts`
- `supabase/sql/dating_apply_credits.sql`

## 3. 지원권 구조

- DB 기준 기본 구조:
  - `user_daily_apply_usage`
  - `user_apply_credits`
  - `apply_credit_orders`
- 현재 웹 상품:
  - `3장 / 5000원`
- 현재 결제 방식:
  - 주문 생성
  - 오픈카톡 전달
  - 관리자 승인
  - RPC `approve_apply_credit_order()`로 크레딧 적립

참고:
- `app/api/dating/apply-credits/request/route.ts`
- `app/api/dating/apply-credits/status/route.ts`
- `app/api/admin/dating/apply-credits/approve/route.ts`
- `supabase/sql/dating_apply_credits.sql`

## 4. 이상형 더보기(유료)

- 성별별 신청 구조다. `male` / `female` 따로 신청한다.
- 현재 가격은 `5000원`
- 승인되면 `3시간` 접근 권한이 열린다.
- 승인 시 `지원권 1장`을 추가 지급한다.
- 첫 조회 시 `랜덤 25명` 스냅샷을 고정한다.
- 현재 결제 방식은:
  - 신청 생성
  - 오픈카톡 전달
  - 관리자 승인

참고:
- `app/dating/more-view/page.tsx`
- `app/api/dating/cards/more-view/request/route.ts`
- `app/api/dating/cards/more-view/list/route.ts`
- `app/api/admin/dating/cards/more-view/requests/[id]/route.ts`
- `lib/dating-more-view.ts`
- `supabase/sql/dating_more_view_requests.sql`

## 5. 가까운 이상형 보기(유료)

- 지역 단위 신청 구조다.
- 현재 가격은 `지역당 5000원`
- 승인되면 `3시간` 동안 해당 지역의 대기 오픈카드 조회 가능
- 승인 시 `지원권 1장` 추가 지급
- 현재 결제 방식은:
  - 신청 생성
  - 오픈카톡 전달
  - 관리자 승인

참고:
- `app/dating/nearby-view/page.tsx`
- `app/api/dating/cards/city-view/request/route.ts`
- `app/api/dating/cards/city-view/list/route.ts`
- `app/api/admin/dating/cards/city-view/requests/[id]/route.ts`
- `lib/dating-city-view.ts`
- `supabase/sql/dating_city_view_requests.sql`

## 6. 유료 오픈카드

- 일반 오픈카드와 별도 테이블을 쓴다: `dating_paid_cards`
- 현재 노출 모드 2개:
  - `priority_24h`: 24시간 상단고정
  - `instant_public`: 새치기 즉시공개, 상단고정 없음
- 현재 승인 후 `24시간` 노출
- 현재 결제 방식은:
  - 카드 생성
  - 오픈카톡 결제 문의
  - 관리자 승인

참고:
- `app/dating/paid/page.tsx`
- `app/api/dating/paid/create/route.ts`
- `app/api/dating/paid/list/route.ts`
- `app/api/admin/dating/paid/approve/route.ts`
- `supabase/sql/dating_paid_cards.sql`
- `supabase/sql/dating_paid_cards_display_mode.sql`

## 7. 유료 오픈카드 지원 정책

- 테이블은 `dating_paid_card_applications`
- 일반 오픈카드와 달리 `다중 수락` 가능
- 카드 자동 숨김 없음
- 지원자는 신청 시 자기 인스타를 제출
- 수락되면 인스타 교환 대상이 된다

참고:
- `app/api/dating/paid/apply/route.ts`
- `supabase/sql/dating_paid_card_applications.sql`

## 8. 인스타 교환 구조

- 일반 오픈카드:
  - 지원 수락 시 owner/applicant 간 교환
- 스와이프:
  - 상호 like 시 `dating_card_swipe_matches`에 저장
- 연결 목록 API가 두 소스를 합쳐서 내려준다

참고:
- `app/api/dating/cards/my/connections/route.ts`
- `app/api/dating/cards/swipe/route.ts`

## 9. 모바일 결제 전환 시 바뀌어야 할 부분

현재 웹 유료 기능 대부분은 `오픈카톡 + 관리자 승인`이다.

인앱결제로 바꾸려면 다음으로 치환해야 한다.

- 지원권:
  - 주문 생성 -> `RevenueCat 구매 검증 + 서버 적립`
- 이상형 더보기:
  - 신청 생성 -> `구매 성공 시 approved + 3시간 권한 + 지원권 1장 지급`
- 가까운 이상형:
  - 신청 생성 -> `구매 성공 시 approved + 3시간 권한 + 지원권 1장 지급`
- 유료 오픈카드:
  - 카드 초안 생성 -> `구매 성공 시 approved + 24시간 노출`

## 10. 현재 기준으로 추천 상품 매핑

- `apply_credits_5`
  - 구매 성공 시 `user_apply_credits +5`
- `instant_open_card`
  - 구매 성공 시 `dating_paid_cards.display_mode = instant_public`
  - 승인/활성화 자동 처리 필요
- `nearby_ideal_3h`
  - 구매 성공 시 `dating_city_view_requests` 승인 처리
- 추후 필요 시:
  - `more_view_3h_male`
  - `more_view_3h_female`

## 11. 결론

모바일 결제 구현의 핵심은 SDK 연동보다 `서버 fulfillment`다.

RevenueCat은 구매 사실을 알려주는 역할이고,
실제 권한 지급은 지금 웹이 관리자 승인으로 하던 로직을 서버 자동화로 바꿔야 한다.
