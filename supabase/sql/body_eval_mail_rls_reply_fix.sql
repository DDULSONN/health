-- Fix body_eval mail reply insert RLS.
-- Issue: ambiguous sender_id reference inside EXISTS could block author->sender reply.

begin;

drop policy if exists "body_eval_mail_messages_insert_participant" on public.body_eval_mail_messages;
create policy "body_eval_mail_messages_insert_participant"
  on public.body_eval_mail_messages for insert
  to authenticated
  with check (
    auth.uid() = sender_id
    and sender_id <> receiver_id
    and exists (
      select 1
      from public.body_eval_mail_threads t
      where t.id = body_eval_mail_messages.thread_id
        and (
          (body_eval_mail_messages.sender_id = t.author_id and body_eval_mail_messages.receiver_id = t.sender_id)
          or (body_eval_mail_messages.sender_id = t.sender_id and body_eval_mail_messages.receiver_id = t.author_id)
        )
    )
  );

commit;

notify pgrst, 'reload schema';
