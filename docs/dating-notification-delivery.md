# Matching notification delivery upgrade

## Member-facing behavior

- Existing 1:1 request email/SMS remains. Both lead to the selected match.
- When someone accepts, the other person receives the existing email plus one SMS.
  The accepting member is not sent an SMS for their own action. SMS is scheduled
  with Next.js `after()` so it does not add provider wait time to the accept button.
- Unanswered 1:1 requests and mutually accepted matches still awaiting contact
  exchange can receive one email reminder after 24 hours. Do not call a pending
  request “unread”: an actual read receipt is not required or inferred.
- Reminder hours are 09:00–19:59 KST. At most one reminder attempt per account/KST
  day and one per match/event/recipient. Immediate event messages are separate.
- Also suppress reminders if any reminder attempt was reserved in the preceding
  24 hours, including failed/uncertain delivery. The hourly worker stops further
  attempts for that recipient after a success or failure in the same run.
- Pending-request reminders open the authenticated grouped inbox (not a stale
  single request). Already answered/canceled requests do not reappear. An empty
  inbox explains that the current state may differ from the earlier notice.
  Mutual-acceptance reminders retain their existing exact-match link.
- Only events after the SQL activation timestamp, aged 24–48 hours, qualify.
  This is not a historical blast or a campaign to inactive members.
- Ordinary/paid open-card emails now link to the appropriate received/applied
  group. Email links render as compact buttons; unsubscribe remains available.

## Safety and tradeoffs

- Reuse Resend/Solapi, the existing hourly cron, verified recipient phones and
  existing `dating_notifications` / `all` opt-outs. Do not opt anybody back in.
- Before external 1:1 delivery, recheck current match, membership, both Auth
  accounts, both bans, account/contact blocks, and recipient preferences.
  Failed safety lookups skip delivery. Check the phone again before SMS.
- Reserve before sending. SQL unique constraints prevent concurrent duplicates;
  email attempts also use a stable provider idempotency key.
- Failed/ambiguous reminder and SMS attempts are not automatically replayed. This
  avoids duplicate messages when a provider accepted a message but its response
  was lost. Existing in-site notifications and match records remain available.
- A message accepted by a provider cannot be recalled. Email explains that the
  linked current state can differ after cancellation or account deletion.
- Matching transitions, recommendation order, payment/phone disclosure and OTP
  logic are unchanged. Notification failure never reverses a completed acceptance.
- Cron processes at most 100 request rows + 100 mutual rows per run, up to 50
  successful emails and a 45-second work budget. High backlog can defer/miss some
  reminders; review `budgetReached`/failed counts before increasing limits.
- The new SMS constraint and reminder table are required. If SQL is absent,
  extra SMS fails closed and reminder cron returns `NOT_ENABLED`; matching still
  works. No production SQL or live messaging is executed by the test suite.
- The grouped-inbox/rolling-24h improvement needs no additional SQL or schedule.

## Rollout / rollback

1. Run `supabase/sql/dating_1on1_notification_delivery_upgrade.sql`, then deploy.
   It adds notification-only schema and a start timestamp; rerunning retains it.
2. With an explicitly approved test account, verify request → acceptance → one
   message with correct deep link. Confirm provider delivery status separately.
3. Check existing cron results (next daytime run). New reminders cannot begin
   until a post-activation event becomes 24 hours old.
4. To stop reminder sending, set `site_settings.value_json.enabled` to false for
   `dating_1on1_reminder_delivery`. Revert the code to remove added acceptance SMS.
   Leave delivery logs/constraints intact to prevent duplicate notification.

## Local verification

- `node --require ./scripts/test-no-network.cjs --test scripts/check-dating-1on1-delivery-upgrade.cjs scripts/check-dating-1on1-sms-message.cjs scripts/check-one-on-one-notification-status.cjs`
- `node scripts/check-dating-notification-email-browser.cjs`
- `node scripts/check-critical.cjs` and production build.
- Fixtures only; actual mailbox delivery/carrier receipt must be checked after
  explicit authorization. Browser test intercepts all external navigation.
