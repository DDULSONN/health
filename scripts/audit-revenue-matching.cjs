/* eslint-disable @typescript-eslint/no-require-imports */
// Read-only, bounded operational audit. Outputs aggregates, never contacts/tokens.
const path = require('node:path');
require('@next/env').loadEnvConfig(process.env.AUDIT_ENV_DIR || path.resolve(__dirname, '..'), false, { info() {}, error() {} });
const nativeFetch = global.fetch;
const db = require('@supabase/supabase-js').createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (url, init) => {
    if (!['GET', 'HEAD'].includes(init?.method || 'GET')) throw Error('Writes forbidden');
    return nativeFetch(url, { ...init, signal: AbortSignal.timeout(30000) });
  } },
});
const DAY = 86400000, now = Date.now(), iso = n => new Date(n).toISOString();
const today = Date.parse(iso(now + 9 * 3600000).slice(0, 10) + 'T00:00:00+09:00'), elapsed = now - today;
const since = iso(today - 14 * DAY);
async function scan(table, select, column = 'created_at') {
  const rows = [];
  for (let offset = 0; offset < 50000; offset += 1000) {
    const res = await db.from(table).select(select).gte(column, since).lte(column, iso(now))
      .order(column, { ascending: true }).range(offset, offset + 999);
    if (res.error) throw Error(table + ': ' + res.error.code);
    rows.push(...res.data);
    if (res.data.length < 1000) return rows;
  }
  throw Error(table + ': audit bound exceeded');
}
const inside = (value, start, end) => Date.parse(value || '') >= start && Date.parse(value || '') < end;
const counts = (rows, key) => rows.reduce((out, row) => { const name = row[key] || 'unknown'; out[name] = (out[name] || 0) + 1; return out; }, {});
(async () => {
  const [createdOrders, approvedOrders, profiles, cards, matches, events, funnel] = await Promise.all([
    scan('toss_test_payment_orders', 'id,user_id,product_type,amount,status,approved_at,created_at,raw_response'),
    scan('toss_test_payment_orders', 'id,user_id,product_type,amount,status,approved_at,created_at,raw_response', 'approved_at'),
    scan('profiles', 'user_id,created_at,phone_verified,role'),
    scan('dating_1on1_cards', 'id,user_id,sex,status,created_at'),
    scan('dating_1on1_match_proposals', 'id,source_user_id,candidate_user_id,state,created_at,source_selected_at,candidate_responded_at,source_final_responded_at,contact_exchange_status,contact_exchange_approved_at', 'updated_at'),
    scan('payment_funnel_events', 'user_id,session_id,event_name,product_type,created_at'),
    scan('onboarding_funnel_events', 'event_name,first_seen_at', 'first_seen_at'),
  ]);
  const orders = [...new Map([...createdOrders, ...approvedOrders].map(row => [row.id, row])).values()];
  function summary(start, end) {
    const made = orders.filter(o => inside(o.created_at, start, end));
    const paid = orders.filter(o => o.status === 'paid' && inside(o.approved_at || o.created_at, start, end));
    const joined = profiles.filter(p => p.role !== 'admin' && inside(p.created_at, start, end));
    const evt = events.filter(e => inside(e.created_at, start, end));
    const newMatches = matches.filter(m => inside(m.created_at, start, end));
    const mutual = matches.filter(m => m.state === 'mutual_accepted' && inside(m.source_final_responded_at || m.candidate_responded_at, start, end));
    const products = {};
    for (const type of new Set(orders.map(o => o.product_type))) {
      const p = paid.filter(o => o.product_type === type), c = made.filter(o => o.product_type === type);
      if (p.length || c.length) products[type] = { revenue: p.reduce((sum,o) => sum + o.amount, 0), paid:p.length, checkout:c.length, statuses:counts(c,'status') };
    }
    return { start:iso(start), end:iso(end), revenue:paid.reduce((sum,o) => sum + o.amount,0), paid:paid.length,
      uniquePayers:new Set(paid.map(o=>o.user_id)).size, checkout:made.length, checkoutStatuses:counts(made,'status'),
      signups:joined.length, signupVerifiedNow:joined.filter(p=>p.phone_verified).length,
      newOneOnOneUsers:new Set(cards.filter(c=>inside(c.created_at,start,end)).map(c=>c.user_id)).size,
      newRequests:newMatches.filter(m=>m.source_selected_at).length, currentRequestStates:counts(newMatches,'state'),
      mutualAt:mutual.length,
      productViews:evt.filter(e=>e.event_name==='view_item').length, productClicks:evt.filter(e=>e.event_name==='select_item').length,
      viewedUsers:new Set(evt.map(e=>e.user_id || e.session_id)).size,
      onboardingFirstEvents:counts(funnel.filter(e=>inside(e.first_seen_at,start,end)),'event_name'), products };
  }
  const daily = [];
  for (let d = 14; d >= 0; d--) {
    const full = summary(today-d*DAY, d ? today-(d-1)*DAY : now);
    daily.push({ date:iso(today-d*DAY+9*3600000).slice(0,10), ...full });
  }
  const errorCodes = counts(orders.filter(o=>o.status==='failed').map(o=>({code:o.raw_response?.code || o.raw_response?.failure?.code || 'unspecified'})), 'code');
  console.log(JSON.stringify({ measuredAt:iso(now), sameTime:{ today:summary(today,now), yesterday:summary(today-DAY,today-DAY+elapsed),
    lastWeek:summary(today-7*DAY,today-7*DAY+elapsed) }, completedWeeks:{recent:summary(today-7*DAY,today),previous:summary(today-14*DAY,today-7*DAY)},
    daily: daily.map(d=>({date:d.date,revenue:d.revenue,paid:d.paid,checkout:d.checkout,signups:d.signups,newOneOnOneUsers:d.newOneOnOneUsers,mutualAt:d.mutualAt})), errorCodes, caveats:['orders: paid gross, not accounting net; created but unpaid is NOT proof of failure','profile rows exclude already deleted accounts','mutual timestamp fallback and current state are not immutable event logs','product views are NOT site traffic; onboarding captures first event only'] },null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
