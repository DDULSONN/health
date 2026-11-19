/* eslint-disable @typescript-eslint/no-require-imports -- Standalone harness for the actual middleware. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "middleware.ts"), "utf8");

function transpile(sourceCode) {
  return ts.transpileModule(sourceCode, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
}

function loadMiddleware(user, scenario = {}) {
  const overrides = {
    "@/lib/auth-confirmed": {
      isEmailConfirmed: (candidate) => Boolean(candidate?.email_confirmed_at),
    },
    "@/lib/onboarding-user": (() => {
      const m = { exports: {} };
      new Function("module", "exports", transpile(fs.readFileSync(path.join(root, "lib/onboarding-user.ts"), "utf8")))(m, m.exports);
      return { readOnboardingUser: (auth, options) => m.exports.readOnboardingUser(auth, { ...options, timeoutMs: 15, retryDelayMs: 1 }) };
    })(),
    "@/lib/supabase/session-cookies": (() => {
      const m = { exports: {} };
      new Function("module", "exports", transpile(fs.readFileSync(path.join(root, "lib/supabase/session-cookies.ts"), "utf8")))(m, m.exports);
      return m.exports;
    })(),
    "@/lib/admin-panel-lock": {
      getAdminPanelCookieName: () => "admin-lock",
      isAdminPanelLockEnabled: () => false,
      isAdminPanelUnlocked: async () => true,
    },
    "@supabase/ssr": {
      createServerClient: (_url, _key, options) => ({
        auth: {
          getUser: async () => {
            if (scenario.getUser) return scenario.getUser();
            options.cookies.setAll([{
              name: "sb-test-auth-token",
              value: "fresh-session",
              options: { httpOnly: true, sameSite: "lax", path: "/" },
            }]);
            return { data: { user }, error: null };
          },
        },
        from: () => ({
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: scenario.banned ? { is_banned: true } : null, error: null }) }),
          }),
        }),
      }),
    },
  };
  const output = transpile(source);
  const loadedModule = { exports: {} };
  const resolve = (name) => Object.hasOwn(overrides, name) ? overrides[name] : require(name);
  new Function("require", "module", "exports", output)(resolve, loadedModule, loadedModule.exports);
  return loadedModule.exports.middleware;
}

function loadCallbackComplete(user) {
  const callbackSource = fs.readFileSync(
    path.join(root, "app/auth/callback/complete/route.ts"),
    "utf8"
  );
  const overrides = {
    "@/lib/auth-confirmed": {
      isEmailConfirmed: (candidate) => Boolean(candidate?.email_confirmed_at),
    },
    "@/lib/referral-code": {
      isValidReferralCode: () => false,
      normalizeReferralCode: () => "",
    },
    "@/lib/referrals-server": {
      claimReferralRelationship: async () => ({ ok: true }),
    },
    "@/lib/signup-email-consent-server": {
      recordSignupEmailConsent: async () => {},
    },
    "@/lib/supabase/server": {
      createAdminClient: () => ({}),
    },
    "@/lib/safe-internal-path": {
      safeInternalPath: (input, fallback = "/") => {
        if (!input || !input.startsWith("/") || input.startsWith("//") || input.includes("\\")) return fallback;
        return input;
      },
    },
    "@supabase/ssr": {
      createServerClient: (_url, _key, options) => ({
        auth: {
          getUser: async () => {
            options.cookies.setAll([{
              name: "sb-test-auth-token",
              value: "callback-session",
              options: { httpOnly: true, sameSite: "lax", path: "/" },
            }]);
            return { data: { user }, error: null };
          },
        },
      }),
    },
  };
  const loadedModule = { exports: {} };
  const resolve = (name) => Object.hasOwn(overrides, name) ? overrides[name] : require(name);
  new Function("require", "module", "exports", transpile(callbackSource))(
    resolve,
    loadedModule,
    loadedModule.exports
  );
  return loadedModule.exports.GET;
}

test("a refreshed auth cookie is visible in both the current request and response", async () => {
  const request = new NextRequest("https://helchang.com/mypage");
  const middleware = loadMiddleware({
    id: "user-1",
    email: "member@example.com",
    email_confirmed_at: "2026-09-02T00:00:00.000Z",
  });

  const response = await middleware(request);

  assert.equal(request.cookies.get("sb-test-auth-token")?.value, "fresh-session");
  assert.equal(response.cookies.get("sb-test-auth-token")?.value, "fresh-session");
  assert.equal(response.status, 200);
});

test("an auth redirect preserves a session cookie refreshed by Supabase", async () => {
  const request = new NextRequest("https://helchang.com/mypage?tab=matching");
  const middleware = loadMiddleware({
    id: "user-2",
    email: "pending@example.com",
    email_confirmed_at: null,
  });

  const response = await middleware(request);

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://helchang.com/verify-email?next=%2Fmypage%3Ftab%3Dmatching");
  assert.equal(response.cookies.get("sb-test-auth-token")?.value, "fresh-session");
});

test("the signup callback keeps refreshed cookies when it redirects", async () => {
  const callback = loadCallbackComplete({
    id: "user-3",
    email: "pending@example.com",
    email_confirmed_at: null,
  });
  const request = new NextRequest(
    "https://helchang.com/auth/callback/complete?next=%2Fonboarding%2Fdating"
  );

  const response = await callback(request);

  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("location"),
    "https://helchang.com/verify-email?next=%2Fonboarding%2Fdating"
  );
  assert.equal(response.cookies.get("sb-test-auth-token")?.value, "callback-session");
});

const member = { id: "fixture-member", email: "fixture@example.test", email_confirmed_at: "2026-11-01" };
for (const route of ["/dating/1on1?editId=fixture-card", "/dating/card/new?editId=fixture-open", "/mypage", "/admin", "/api/dating/1on1/my"]) {
  test(`auth outage never becomes logout or bypass: ${route}`, async () => {
    let reads = 0;
    const response = await loadMiddleware(null, { getUser: async () => {
      reads++; return { data: { user: null }, error: { status: 503 } };
    } })(new NextRequest("https://helchang.com" + route));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("location"), null);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.equal(reads, 2);
    if (!route.startsWith("/api/")) assert.match(await response.text(), /다시 확인/);
  });
}
test("a temporary auth failure recovers and still checks the real member", async () => {
  let reads = 0;
  const response = await loadMiddleware(null, { getUser: async () => ++reads === 1
    ? { data: { user: null }, error: { status: 429 } }
    : { data: { user: member }, error: null }
  })(new NextRequest("https://helchang.com/dating/1on1?editId=fixture-card"));
  assert.equal(response.status, 200); assert.equal(reads, 2);
});
test("a hung auth check fails closed with a bounded retry", async () => {
  const response = await loadMiddleware(null, { getUser: () => new Promise(() => {}) })(new NextRequest("https://helchang.com/dating/1on1"));
  assert.equal(response.status, 503);
});
test("a real guest returns to the same edit target after login; redirect is never cached", async () => {
  const response = await loadMiddleware(null)(new NextRequest("https://helchang.com/dating/1on1?editId=fixture-card"));
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location")).searchParams.get("next"), "/dating/1on1?editId=fixture-card");
  assert.match(response.headers.get("cache-control"), /no-store/);
});
test("a verified banned account still cannot edit", async () => {
  const response = await loadMiddleware(member, { banned: true })(new NextRequest("https://helchang.com/dating/1on1?editId=fixture-card"));
  assert.match(response.headers.get("location"), /account=restricted/);
});
