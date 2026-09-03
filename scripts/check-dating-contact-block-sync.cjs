/* eslint-disable @typescript-eslint/no-require-imports -- Standalone harness loads the real TypeScript route. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
function loadTypeScriptModule(relativePath, overrides = {}) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  const loadedModule = { exports: {} };
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const resolve = (name) => (Object.hasOwn(overrides, name) ? overrides[name] : require(name));
  new Function("require", "module", "exports", output)(resolve, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const phoneVerification = loadTypeScriptModule("lib/phone-verification.ts");
const datingContactBlocks = loadTypeScriptModule("lib/dating-contact-blocks.ts", {
  "@/lib/phone-verification": phoneVerification,
});
const oneOnOnePhoneBlocks = loadTypeScriptModule("lib/dating-1on1-phone-blocks.ts", {
  "@/lib/phone-verification": phoneVerification,
});

let currentUser = null;
let currentAdmin = null;

const routeOverrides = {
  "@/lib/dating-contact-blocks": datingContactBlocks,
  "@/lib/dating-1on1-phone-blocks": oneOnOnePhoneBlocks,
  "@/lib/request-origin": { ensureAllowedMutationOrigin: () => null },
  "@/lib/supabase/server": { createAdminClient: () => currentAdmin },
  "@/lib/supabase/request": { getRequestAuthContext: async () => ({ user: currentUser }) },
};

function loadRoute() {
  const source = fs.readFileSync(path.join(root, "app/api/dating/contact-blocks/sync/route.ts"), "utf8");
  const loadedModule = { exports: {} };
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const resolve = (name) => (Object.hasOwn(routeOverrides, name) ? routeOverrides[name] : require(name));
  new Function("require", "module", "exports", output)(resolve, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const route = loadRoute();

function makeQuery(result, call) {
  const query = {
    eq(key, value) {
      call.filters.push([key, value]);
      return query;
    },
    order() {
      return query;
    },
    limit() {
      return query;
    },
    maybeSingle: async () => result,
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return query;
}

function makeAdmin({ count = 0, latest = null, errors = {} } = {}) {
  const calls = [];
  const admin = {
    calls,
    from(table) {
      return {
        upsert: async (rows, options) => {
          calls.push({ operation: "upsert", table, rows, options });
          return { data: null, error: errors[`${table}:upsert`] ?? null };
        },
        select(fields, options = {}) {
          const call = { operation: "select", table, fields, options, filters: [] };
          calls.push(call);
          const result = options.head
            ? { data: null, count, error: errors[`${table}:select`] ?? null }
            : { data: latest ? { created_at: latest } : null, error: errors[`${table}:select`] ?? null };
          return makeQuery(result, call);
        },
        delete() {
          const call = { operation: "delete", table, filters: [] };
          calls.push(call);
          return makeQuery({ data: null, error: errors[`${table}:delete`] ?? null }, call);
        },
      };
    },
  };
  return admin;
}

function postRequest(phones) {
  return new Request("https://helchang.com/api/dating/contact-blocks/sync", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://helchang.com" },
    body: JSON.stringify({ phones }),
  });
}

test("rejects signed-out imports before touching the database", async () => {
  currentUser = null;
  currentAdmin = makeAdmin();
  const response = await route.POST(postRequest(["010-1234-5678"]));
  assert.equal(response.status, 401);
  assert.equal(currentAdmin.calls.length, 0);
});

test("normalizes and deduplicates numbers, then writes both block stores without raw phones", async () => {
  currentUser = { id: "user-1" };
  currentAdmin = makeAdmin({ count: 7 });
  const response = await route.POST(postRequest(["010-1234-5678", "+82 10 1234 5678", "02-123-4567", 123]));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { ok: true, imported_count: 1, total_count: 7 });
  const upserts = currentAdmin.calls.filter((call) => call.operation === "upsert");
  assert.deepEqual(upserts.map((call) => call.table), ["dating_contact_blocks", "dating_1on1_phone_blocks"]);
  assert.equal(upserts[0].rows.length, 1);
  assert.equal(upserts[1].rows.length, 1);
  assert.match(upserts[0].rows[0].value_hash, /^[a-f0-9]{64}$/);
  assert.match(upserts[1].rows[0].phone_hash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(upserts).includes("010-1234-5678"), false);

  const unifiedMap = new Map([["user-1:phone", new Set([upserts[0].rows[0].value_hash])]]);
  assert.equal(datingContactBlocks.isDatingContactPhoneBlockedPair({
    sourceUserId: "user-1",
    sourcePhone: "+82-10-9999-9999",
    candidateUserId: "user-2",
    candidatePhone: "010-1234-5678",
    blockMap: unifiedMap,
  }), true);

  const oneOnOneMap = new Map([["user-1", new Set([upserts[1].rows[0].phone_hash])]]);
  assert.equal(oneOnOnePhoneBlocks.isOneOnOnePhoneBlockedPair({
    sourceUserId: "user-1",
    sourcePhone: "+82-10-9999-9999",
    candidateUserId: "user-2",
    candidatePhone: "010-1234-5678",
    blockMap: oneOnOneMap,
  }), true);
});

test("an import with no valid mobile number preserves the existing count", async () => {
  currentUser = { id: "user-2" };
  currentAdmin = makeAdmin({ count: 4 });
  const response = await route.POST(postRequest(["02-123-4567", "not-a-phone"]));
  assert.deepEqual(await response.json(), { ok: true, imported_count: 0, total_count: 4 });
  assert.equal(currentAdmin.calls.some((call) => call.operation === "upsert"), false);
});

test("batches large valid imports and fails closed above 5000 unique numbers", async () => {
  const phones = Array.from({ length: 501 }, (_, index) => `010${String(index).padStart(8, "0")}`);
  currentUser = { id: "user-3" };
  currentAdmin = makeAdmin({ count: 501 });
  const response = await route.POST(postRequest(phones));
  assert.equal(response.status, 200);
  const upserts = currentAdmin.calls.filter((call) => call.operation === "upsert");
  assert.deepEqual(upserts.map((call) => call.rows.length), [500, 500, 1, 1]);

  const tooMany = Array.from({ length: 5_001 }, (_, index) => `010${String(index).padStart(8, "0")}`);
  currentAdmin = makeAdmin();
  const rejected = await route.POST(postRequest(tooMany));
  assert.equal(rejected.status, 400);
  assert.equal(currentAdmin.calls.length, 0);
});

test("clears phone blocks from both stores and scopes deletion to the signed-in user", async () => {
  currentUser = { id: "user-4" };
  currentAdmin = makeAdmin();
  const response = await route.DELETE(new Request("https://helchang.com/api/dating/contact-blocks/sync", { method: "DELETE" }));
  assert.equal(response.status, 200);
  const deletes = currentAdmin.calls.filter((call) => call.operation === "delete");
  assert.deepEqual(deletes.map((call) => call.table), ["dating_contact_blocks", "dating_1on1_phone_blocks"]);
  assert.deepEqual(deletes[0].filters, [["user_id", "user-4"], ["block_type", "phone"]]);
  assert.deepEqual(deletes[1].filters, [["user_id", "user-4"]]);
});
