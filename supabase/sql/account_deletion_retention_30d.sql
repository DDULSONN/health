begin;

alter table public.account_deletion_audits
  alter column retention_until set default (now() + interval '30 days');

update public.account_deletion_audits
set retention_until = least(retention_until, deleted_at + interval '30 days')
where retention_until is not null;

commit;

notify pgrst, 'reload schema';
