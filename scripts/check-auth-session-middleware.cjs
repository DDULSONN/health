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

function loadMiddleware(user) {
  const overrides = {
    "@/lib/auth-confirmed": {
      isEmailConfirmed: (candidate) => Boolean(candidate?.email_confirmed_at),
    },
    "@/lib/admin-panel-lock": {
      getAdminPanelCookieName: () => "admin-lock",
      isAdminPanelLockEnabled: () => false,
      isAdminPanelUnlocked: async () => true,
    },
    "@supabase/ssr": {
      createServerClient: (_url, _key, options) => ({
        auth: {
          getUser: async () => {
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
            eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
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
    "@/lib/supabase/server": {
      createAdminClient: () => ({}),
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
