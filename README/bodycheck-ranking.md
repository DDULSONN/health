# Bodycheck Weekly Ranking + Hall of Fame

## Week rule
- Timezone: KST (`Asia/Seoul`)
- Week start: Monday 00:00 KST
- `week_id` format: `YYYY-Wxx` (ISO week)

## SQL
Run:
- `supabase/sql/bodycheck_weekly_ranking_hof.sql`

This script creates:
- `public.votes`
- `public.post_score_weekly`
- `public.hall_of_fame`
- trigger function `public.handle_votes_change()`

## Ranking API
- Endpoint: `GET /api/rankings/weekly-bodycheck?gender=male|female&top=3`
- Uses current `week_id`
- Applies minimum vote filter: `vote_count >= 5`
- Sort: `score_avg DESC`, `vote_count DESC`

## Weekly close automation

### Vercel Cron
- File: `vercel.json`
- Existing schedule:
- `0 15 * * 0` (UTC) = Monday 00:00 KST
- Calls: `/api/cron/weekly-winners`

### Supabase pg_cron (alternative)
```sql
select cron.schedule(
  'hof-weekly-close',
  '0 15 * * 0',
  $$
  select
    net.http_post(
      url := 'https://helchang.com/api/cron/weekly-winners',
      headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
    );
  $$
);
```

## Hall of fame page
- Page: `/hall-of-fame`
- Sorted by `week_id DESC`
- Male/Female winners displayed separately
