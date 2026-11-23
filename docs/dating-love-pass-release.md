# 짐툴 연애 패스 운영 반영

웹 토스 상품 `dating_love_pass_30d`: 30,000원 한 번 결제, 혜택 적용 시점부터 30일, 자동 갱신 없음. 1:1 매칭·연락처 교환은 포함되지 않는다. 구매 조건은 휴대폰 인증과 이용 가능한 오픈카드다. 패스에는 공개 전 근처 카드 열람·지원(관심 지역 2곳, 검수 및 차단 조건 유지), 추가 지원권 40장, 내 카드 즉시 공개 최대 4회(7일 간격), 빠른매칭 무제한 둘러보기·KST 하루 좋아요 50회가 포함된다.

## 배포와 판매 시작

1. 새 판매를 끈 상태에서 기존 오픈카드, AI 검수, 빠른매칭 및 토스 주문 스키마가 설치된 대상 DB를 확인한다. 검수 작업이 정상 처리되는지와 열람 가능한 카드 표본도 점검한다. 검수를 건너뛰거나 기존 카드·주문을 일괄 수정하지 않는다.
2. 저부하 시간에 `supabase/sql/dating_love_pass.sql` → `supabase/sql/dating_love_pass_swipe.sql` 순으로 적용하고, 두 파일이 모두 완료된 뒤 `notify pgrst, 'reload schema';`를 실행한다. 운영 락이나 스키마 오류가 나면 판매를 열지 않는다. 기존 토스 상품용 마이그레이션을 재실행하지 않는다.
3. 배포 커밋과 도메인 연결을 확인한다. `npm run check:critical` 및 아래 구매 흐름 검사를 수행한다. 운영 토스 자격 증명·결제수단·돌아오는 URL은 설정에서 확인하되 키를 출력하지 않는다. 로컬 검증은 가상 토스와 격리 DB로, 실제 출금은 하지 않는다.

```sh
node --test scripts/check-love-pass-payment.cjs scripts/check-love-pass-db.cjs scripts/check-love-pass-swipe.cjs
node scripts/check-love-pass-journey-browser.cjs
```

판매 스위치와 필수 DB 함수는 운영 SQL 편집기의 권한 있는 역할로 확인한다. 함수 행마다 `installed = true`여야 한다. 정지 중에는 의도대로 `sale_ready = false`여야 한다.

```sql
with required(signature) as (values
  ('public.dating_love_pass_ready()'),
  ('public.get_dating_love_pass_purchase_eligible(uuid)'),
  ('public.reserve_dating_love_pass_order(uuid,text)'),
  ('public.activate_dating_love_pass(text,text,timestamptz,jsonb)'),
  ('public.dating_love_pass_status(uuid)'),
  ('public.dating_love_pass_card_review_ok(uuid)'),
  ('public.dating_profile_review_payload(text,jsonb)'),
  ('public.get_daily_apply_base_limit(date)'),
  ('public.get_dating_love_pass_swipe_status(uuid)'),
  ('public.record_dating_love_pass_swipe(uuid,uuid,uuid,uuid,text,text)'),
  ('public.get_dating_love_pass_swipe_users(uuid[])')
), resolved as (select signature, to_regprocedure(signature) as routine from required)
select signature, coalesce(has_function_privilege('service_role', routine, 'EXECUTE'), false) as installed
from resolved;

select public.dating_love_pass_ready() as sale_ready;
```

운영에서 결제·혜택 검증이 끝났을 때만 다음 플래그를 `true`로 바꾼다. 기본값이며 일시 중단에 쓰는 값은 `false`다. 전환 후 DB 함수 및 운영 `/api/dating/love-pass?availability=1`의 `saleAvailable` 값이 의도와 같은지 확인한다.

```sql
insert into public.site_settings (key, value_json)
values ('dating_love_pass_sale', '{"enabled":false}'::jsonb)
on conflict (key) do update set value_json=excluded.value_json, updated_at=now();
```

## 결제·환불 문제 처리

- 새 결제는 사용자당 진행 중 주문을 하나만 유지한다. 승인 확인이 늦으면 새 주문을 만들지 말고 기존 결제 완료 화면에서 재시도한다. 판매가 열린 상태에서 상품 페이지의 구매 버튼을 다시 누르면 기존 토스 상태를 조회한 뒤 같은 주문을 이어가거나 승인된 이용권을 복구한다. 결제 시간·금액·주문 ID를 대조하고, `paymentKey`나 결제 증빙을 공개 로그에 남기지 않는다.
- 로컬 주문 `paid`와 40장·30일 이용권은 동일 트랜잭션으로 저장된다. 브라우저 정보만으로 이용권을 강제 지급하지 않는다. 승인 여부가 불명확할 때 사용자에게 다시 결제하라고 안내하지 않는다. 실제 토스 조회 결과와 주문을 대조해 확인한다. 판매 중단은 신규 생성만 멈춘다. 이미 발급된 패스와 승인 콜백이 처리되도록 기존 승인·혜택 코드는 유지한다.
- 환불은 짐툴 관리자 결제센터에서 처리한다. 해당 주문이 전액 취소로 반영되면 남은 혜택을 쓸 수 없고, 부분 환불은 주문 `paid` 및 이용권을 유지한다. 토스 상점관리자에서 직접 처리한 취소는 이 기능으로 자동 동기화되지 않는다. 실취소 증빙을 확인하고 짐툴 주문까지 운영 절차에 따라 대조·정정한다. 이미 사용한 혜택이나 다른 결제는 일괄 되돌리지 않는다.
