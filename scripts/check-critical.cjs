/* eslint-disable @typescript-eslint/no-require-imports */
// Fail closed: sequential bounded tests, no live credentials, no network, no skipped SQL suites.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/SUPABASE|SOLAPI|RESEND|TOSS|KAKAO|SERVICE_ROLE|CRON_SECRET|PAYMENT_SECRET|SMTP/i.test(key)) delete env[key];
}
const unitFiles = [
  'check-all-pass-profile-offer.cjs',
  'check-return-profile-reward.cjs',
  'check-onboarding-entry.cjs',
  'check-open-card-profile-reuse-mail.cjs',
  'check-dating-photo-preparation.cjs',
  'check-dating-1on1-recommendations.cjs',
  'check-recommendation-refresh-ui.cjs',
  'check-dating-1on1-refresh-copy.cjs',
  'check-dating-age.cjs',
  'check-dating-contact-block-sync.cjs',
  'check-auth-session-middleware.cjs',
  'check-account-recovery.cjs',
  'check-contact-payment-conversion.cjs',
  'check-payment-recovery.cjs',
  'check-admin-contact-exchanges.cjs',
  'check-dating-1on1-contact-nudge.cjs',
  'check-chat-profile-history.cjs',
  'check-account-deletion-matching.cjs',
  'check-account-deletion-regression.cjs',
  'check-dating-1on1-sms-message.cjs',
  'check-profiles-read-privacy.cjs',
  'check-profiles-authority-write-guard.cjs',
];
const browserFiles = [
  'check-all-pass-profile-offer-browser.cjs',
  'check-return-profile-reward-browser.cjs',
  'check-onboarding-entry-browser.cjs',
  'check-dating-photo-browser.cjs',
  'check-recommendation-refresh-browser.cjs',
  'check-contact-conversion-browser.cjs',
  'check-admin-contact-exchanges-browser.cjs',
  'check-profile-writing-browser.cjs',
  'check-funnel-recovery-browser.cjs',
];
function run(args, timeout) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit', timeout });
  if (result.error) console.error(result.error.message);
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
if (process.argv.includes('--browser')) {
  env.CONTACT_CONVERSION_CSS_DIR = path.join(root, '.next/static/css');
  env.PROFILE_UX_CSS_DIR = env.CONTACT_CONVERSION_CSS_DIR;
  for (const file of browserFiles) run([path.join(__dirname, file)], 10 * 60_000);
} else {
  const pglite = require.resolve('@electric-sql/pglite');
  for (const key of ['ACCOUNT_DELETION_PGLITE_PATH', 'PAYMENT_RECOVERY_PGLITE_PATH', 'PRIVACY_TEST_PGLITE_PATH']) env[key] = pglite;
  run(['--require', path.join(__dirname, 'test-no-network.cjs'), '--test', '--test-concurrency=1',
    ...unitFiles.map(file => path.join(__dirname, file))], 5 * 60_000);
  run(['scripts/check-no-direct-supabase-image-urls.mjs'], 30_000);
}
console.log('Critical regression gate passed (' + (process.argv.includes('--browser') ? 'browser' : 'unit + local SQL') + ').');
