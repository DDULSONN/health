/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function evaluate(file, imports, globals = {}) {
  const mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(
    name => Object.hasOwn(imports, name) ? imports[name] : require(name), mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}
const policy = evaluate('lib/site-announcement.ts', {});
const notice = policy.SITE_ANNOUNCEMENT;
const start = Date.parse(notice.startsAt), end = Date.parse(notice.endsAt);
const key = `site-announcement:${notice.id}`;
function browser({ at = start + 1000, pathname = '/mypage', storage = new Map(), denied = false } = {}) {
  let time = at, open = false, pendingEffect, cleanup;
  const timers = new Map(), listeners = new Map();
  let sequence = 0;
  const Clock = class extends Date { static now() { return time; } };
  const dom = {
    localStorage: {
      getItem: k => { if (denied) throw Error('Storage denied'); return storage.get(k) ?? null; },
      setItem: (k, v) => { if (denied) throw Error('Storage denied'); storage.set(k, v); },
    },
    setTimeout: (cb, delay) => { const id = ++sequence; timers.set(id, { cb, at: time + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    addEventListener: (name, cb) => listeners.set(name, cb),
    removeEventListener: (name, cb) => { if (listeners.get(name) === cb) listeners.delete(name); },
  };
  const component = evaluate('components/PaymentMethodAnnouncement.tsx', {
    'react': { useState: () => [open, value => { open = value; }], useEffect: cb => { pendingEffect = cb; } },
    'next/navigation': { usePathname: () => pathname },
    '@/lib/site-announcement': evaluate('lib/site-announcement.ts', {}, { Date: Clock }),
  }, { window: dom, document: dom, Date: Clock }).default;
  return {
    render: () => component(),
    mount: () => { component(); cleanup = pendingEffect(); },
    unmount: () => cleanup?.(),
    navigate: value => { cleanup?.(); pathname = value; component(); cleanup = pendingEffect(); },
    advance: value => {
      for (;;) {
        const next = [...timers].filter(([, t]) => t.at <= value).sort(([, a], [, b]) => a.at - b.at)[0];
        if (!next) break;
        const [id, timer] = next; timers.delete(id); time = timer.at; timer.cb();
      }
      time = value;
    },
    suspendUntil: value => { time = value; },
    event: name => listeners.get(name)?.(),
    timers, storage,
  };
}
function button(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'button') return node;
  for (const child of [].concat(node.props?.children ?? [])) { const found = button(child); if (found) return found; }
  return null;
}

test('new Korean notice replaces the old release and has a fixed 48-hour window', () => {
  assert.equal(end - start, 48 * 3600000);
  assert.notEqual(notice.id, 'one-on-one-refresh-fixed-2026-09-08');
  assert.equal(notice.title, '1:1 매칭 후보 추천이 개선됐어요');
  assert.equal(notice.message, '지역과 나이를 더 고려하고, 새로고침 시 후보가 반복되는 문제를 보완했어요.');
  assert.equal(/\uFFFD/.test(notice.title + notice.message), false);
  assert.equal(policy.isSiteAnnouncementActive(start - 1), false);
  assert.equal(policy.isSiteAnnouncementActive(start), true);
  assert.equal(policy.isSiteAnnouncementActive(end - 1), true);
  assert.equal(policy.isSiteAnnouncementActive(end), false);
});
test('new notice still appears after acknowledging the previous notice, but only once itself', () => {
  const storage = new Map([['site-announcement:one-on-one-refresh-fixed-2026-09-08', '1']]);
  const page = browser({ storage }); page.mount(); page.advance(start + 1450);
  assert.ok(page.render()); button(page.render()).props.onClick();
  assert.equal(page.render(), null); assert.equal(storage.get(key), '1');
  page.navigate('/dating/1on1'); page.advance(start + 2000); assert.equal(page.render(), null);
  const reload = browser({ storage }); reload.mount(); reload.advance(start + 2000); assert.equal(reload.render(), null);
});
test('expired visitors do not mount a notice or timers', () => {
  for (const at of [end, end + 86400000]) {
    const page = browser({ at }); page.mount(); assert.equal(page.render(), null); assert.equal(page.timers.size, 0);
  }
});
test('open dialog closes exactly at expiry without navigation or reload', () => {
  const page = browser({ at: end - 1000 }); page.mount(); page.advance(end - 550); assert.ok(page.render());
  page.advance(end); assert.equal(page.render(), null);
});
test('expiry during the initial display delay never briefly shows the notice', () => {
  const page = browser({ at: end - 100 }); page.mount(); page.advance(end + 1000); assert.equal(page.render(), null);
});
test('page opened before the release can display at the release time', () => {
  const page = browser({ at: start - 60000 }); page.mount(); page.advance(start - 1); assert.equal(page.render(), null);
  page.advance(start); assert.ok(page.render());
});
test('resuming a background tab after expiry hides the dialog even if timers were suspended', () => {
  const page = browser(); page.mount(); page.advance(start + 1450); assert.ok(page.render());
  page.suspendUntil(end + 1000); page.event('visibilitychange'); assert.equal(page.render(), null);
});
test('acknowledgement from another tab closes the open dialog', () => {
  const page = browser(); page.mount(); page.advance(start + 1450); assert.ok(page.render());
  page.storage.set(key, '1'); page.event('storage'); assert.equal(page.render(), null);
});
test('storage-disabled visitors still dismiss the notice during the current visit', () => {
  const page = browser({ denied: true }); page.mount(); page.advance(start + 1450);
  button(page.render()).props.onClick(); page.navigate('/dating/1on1'); page.advance(start + 3000);
  assert.equal(page.render(), null);
});
test('unrelated paths never display it, and navigation/unmount cleans up timers', () => {
  const page = browser({ pathname: '/payments/success' }); page.mount(); page.advance(start + 1450);
  assert.equal(page.render(), null); assert.equal(page.timers.size, 0);
  page.navigate('/community/dating/cards'); page.advance(start + 1900); assert.ok(page.render());
  page.navigate('/login'); assert.equal(page.render(), null); assert.equal(page.timers.size, 0);
  page.navigate('/mypage'); page.unmount(); assert.equal(page.timers.size, 0);
});
