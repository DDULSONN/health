begin;

create table if not exists public.email_marketing_unsubscribes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text null,
  campaign_key text not null default 'all',
  source text not null default 'email_link',
  reason text null,
  user_agent text null,
  ip_address text null,
  unsubscribed_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id, campaign_key)
);

create index if not exists idx_email_marketing_unsubscribes_campaign_user
  on public.email_marketing_unsubscribes(campaign_key, user_id);

create index if not exists idx_email_marketing_unsubscribes_email
  on public.email_marketing_unsubscribes(lower(email));

commit;

notify pgrst, 'reload schema';
