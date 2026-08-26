insert into public.site_settings (key, value_json)
values (
  'employment_company_directory',
  '{
    "version": 1,
    "companies": [
      {"id":"0f5eb9b7-a189-4c49-8fcf-5a97094f91dd","name":"LG전자","domains":["lge.com"],"active":true,"created_at":"2026-08-26T00:00:00.000Z","updated_at":"2026-08-26T00:00:00.000Z"},
      {"id":"f1d0bb8d-48c4-45d8-a57a-4a5780e2c743","name":"기아","domains":["kia.com"],"active":true,"created_at":"2026-08-26T00:00:00.000Z","updated_at":"2026-08-26T00:00:00.000Z"},
      {"id":"62bda56a-e2de-4b45-90f8-c7782ba6aa26","name":"넥슨코리아","domains":["nexon.co.kr"],"active":true,"created_at":"2026-08-26T00:00:00.000Z","updated_at":"2026-08-26T00:00:00.000Z"},
      {"id":"fc087f08-3586-42ee-ad3f-a3fb9cdfde6a","name":"무신사","domains":["musinsa.com"],"active":true,"created_at":"2026-08-26T00:00:00.000Z","updated_at":"2026-08-26T00:00:00.000Z"},
      {"id":"db7d7380-f11d-41ea-82de-5ade9bb70e47","name":"엔씨소프트","domains":["ncsoft.com"],"active":true,"created_at":"2026-08-26T00:00:00.000Z","updated_at":"2026-08-26T00:00:00.000Z"},
      {"id":"59f6c5bd-e433-49dd-bbe4-89e9eeb840bb","name":"우리은행","domains":["wooribank.com"],"active":true,"created_at":"2026-08-26T00:00:00.000Z","updated_at":"2026-08-26T00:00:00.000Z"},
      {"id":"188228e9-1e3c-4817-9d09-3e393710351f","name":"우아한형제들","domains":["woowahan.com"],"active":true,"created_at":"2026-08-26T00:00:00.000Z","updated_at":"2026-08-26T00:00:00.000Z"},
      {"id":"44488c61-1d7d-42f1-9bde-da05773f66f8","name":"카카오","domains":["kakaocorp.com"],"active":true,"created_at":"2026-08-26T00:00:00.000Z","updated_at":"2026-08-26T00:00:00.000Z"},
      {"id":"026664f0-b05b-4657-b133-9687f03d24fd","name":"카카오뱅크","domains":["kakaobank.com"],"active":true,"created_at":"2026-08-26T00:00:00.000Z","updated_at":"2026-08-26T00:00:00.000Z"},
      {"id":"d9f20a91-52a4-4679-bfc4-39f9037b7f6d","name":"카카오페이","domains":["kakaopaycorp.com"],"active":true,"created_at":"2026-08-26T00:00:00.000Z","updated_at":"2026-08-26T00:00:00.000Z"},
      {"id":"aa2429d0-a1b0-447f-bf7b-f702ca8608cf","name":"컬리","domains":["kurlycorp.com"],"active":true,"created_at":"2026-08-26T00:00:00.000Z","updated_at":"2026-08-26T00:00:00.000Z"},
      {"id":"50268d9f-10fb-4fc2-93dc-0cd7e549ae5d","name":"쿠팡","domains":["coupang.com"],"active":true,"created_at":"2026-08-26T00:00:00.000Z","updated_at":"2026-08-26T00:00:00.000Z"},
      {"id":"8adc8592-939c-45a5-830d-16e71fffcf84","name":"크래프톤","domains":["krafton.com"],"active":true,"created_at":"2026-08-26T00:00:00.000Z","updated_at":"2026-08-26T00:00:00.000Z"}
    ]
  }'::jsonb
)
on conflict (key) do update
set value_json = excluded.value_json,
    updated_at = now()
where coalesce(jsonb_array_length(public.site_settings.value_json -> 'companies'), 0) = 0;

-- Domains are admitted only after both checks pass:
-- 1. the company's official site publishes an address using the domain;
-- 2. the domain currently has an MX record.
-- Shared group domains (for example samsung.com, navercorp.com, shinhan.com,
-- toss.im) are intentionally excluded because a domain alone cannot identify
-- the member's exact employing corporation.
