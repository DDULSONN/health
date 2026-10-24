-- Additive preset update only. Existing messages, matches, payments and send
-- eligibility triggers are unchanged. Run after dating_1on1_contact_nudges.sql.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.dating_1on1_contact_nudges
  drop constraint dating_1on1_contact_nudges_preset_key_check,
  drop constraint dating_1on1_contact_nudges_preset_message,
  add constraint dating_1on1_contact_nudges_preset_key_check check (
    preset_key in ('want_to_exchange', 'when_comfortable', 'coffee_on_me', 'keep_talking',
      'nice_to_meet', 'coffee_together', 'workout_chat')
  ),
  add constraint dating_1on1_contact_nudges_preset_message check (
    (preset_key = 'want_to_exchange' and message_text = '저는 연락처를 교환하고 싶어요 🙂') or
    (preset_key = 'when_comfortable' and message_text = '부담 없으실 때 연락처 교환 진행해 주세요!') or
    (preset_key = 'coffee_on_me' and message_text = '연락처 교환해 주시면 첫 커피는 제가 살게요 ☕') or
    (preset_key = 'keep_talking' and message_text = '조금 더 이야기해보고 싶어요. 연락처 교환 어떠세요?') or
    (preset_key = 'nice_to_meet' and message_text = '반가워요. 편하게 이야기 나눠보고 싶어요 🙂') or
    (preset_key = 'coffee_together' and message_text = '처음엔 가볍게 커피 한잔하면 좋겠어요 ☕') or
    (preset_key = 'workout_chat' and message_text = '운동 이야기부터 나눠봐도 좋겠네요!')
  );

create or replace function public.dating_1on1_contact_greetings_version()
returns integer language sql stable security invoker set search_path = public
as $$ select 1; $$;
revoke all on function public.dating_1on1_contact_greetings_version() from public, anon, authenticated;
grant execute on function public.dating_1on1_contact_greetings_version() to service_role;

commit;
notify pgrst, 'reload schema';
