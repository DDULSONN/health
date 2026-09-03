/* eslint-disable @typescript-eslint/no-require-imports -- Standalone harness loads the real TypeScript parser. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function loadTypeScriptModule(relativePath, overrides = {}) {
  const filename = path.join(root, relativePath);
  const loadedModule = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const resolve = (name) => (Object.hasOwn(overrides, name) ? overrides[name] : require(name));
  new Function("require", "module", "exports", output)(resolve, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const phoneVerification = loadTypeScriptModule("lib/phone-verification.ts");
const { parseContactVCardPhones } = loadTypeScriptModule("lib/dating-contact-vcard.ts", {
  "@/lib/phone-verification": phoneVerification,
});

test("extracts, normalizes and deduplicates Apple-style TEL fields", () => {
  const result = parseContactVCardPhones([
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:홍길동",
    "item1.TEL;type=CELL;type=VOICE;type=pref:010-1234-5678",
    "TEL;VALUE=uri:tel:+82-10-1234-5678",
    "END:VCARD",
  ].join("\r\n"));

  assert.deepEqual(result.phones, ["+821012345678"]);
  assert.equal(result.telephoneEntryCount, 2);
  assert.equal(result.invalidCount, 0);
  assert.equal(result.exceededLimit, false);
});

test("supports folded TEL lines and strips URI extensions", () => {
  const result = parseContactVCardPhones([
    "BEGIN:VCARD",
    "VERSION:4.0",
    "TEL;VALUE=uri:tel:+82-10-9876-",
    " 5432;ext=99",
    "END:VCARD",
  ].join("\n"));

  assert.deepEqual(result.phones, ["+821098765432"]);
});

test("ignores non-phone fields and reports invalid telephone entries", () => {
  const result = parseContactVCardPhones([
    "BEGIN:VCARD",
    "EMAIL:test@example.com",
    "NOTE:010-1111-2222",
    "TEL:123",
    "END:VCARD",
  ].join("\n"));

  assert.deepEqual(result.phones, []);
  assert.equal(result.telephoneEntryCount, 1);
  assert.equal(result.invalidCount, 1);
});

test("rejects non-vCard text and fails closed above the configured limit", () => {
  assert.deepEqual(parseContactVCardPhones("010-1234-5678"), {
    phones: [],
    invalidCount: 0,
    telephoneEntryCount: 0,
    exceededLimit: false,
  });

  const source = [
    "BEGIN:VCARD",
    "TEL:010-1111-1111",
    "TEL:010-2222-2222",
    "END:VCARD",
  ].join("\n");
  const limited = parseContactVCardPhones(source, 1);
  assert.equal(limited.exceededLimit, true);
  assert.deepEqual(limited.phones, ["+821011111111"]);
});
