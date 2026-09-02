/* eslint-disable @typescript-eslint/no-require-imports -- Transpile the real TypeScript module without a test runtime dependency. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

const filename = path.resolve(__dirname, "../lib/dating-1on1-contact-nudge.ts");
const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const loadedModule = { exports: {} };
new Function("require", "module", "exports", output)(require, loadedModule, loadedModule.exports);

const { getOneOnOneContactNudgeSenderDisplayName } = loadedModule.exports;

test("stored 1:1 sender name has highest priority", () => {
  assert.equal(
    getOneOnOneContactNudgeSenderDisplayName({
      storedSenderName: "저장된 매칭 이름",
      oneOnOneCardName: "현재 매칭 이름",
      actorNickname: "사이트 닉네임",
    }),
    "저장된 매칭 이름",
  );
});

test("1:1 card name is used instead of the site nickname for legacy alarms", () => {
  assert.equal(
    getOneOnOneContactNudgeSenderDisplayName({
      storedSenderName: null,
      oneOnOneCardName: "1대1 신청서 이름",
      actorNickname: "사이트 닉네임",
    }),
    "1대1 신청서 이름",
  );
});

test("site nickname is only the last fallback", () => {
  assert.equal(
    getOneOnOneContactNudgeSenderDisplayName({
      storedSenderName: "",
      oneOnOneCardName: null,
      actorNickname: "사이트 닉네임",
    }),
    "사이트 닉네임",
  );
});

test("sender names cannot inject line breaks into an alarm", () => {
  assert.equal(
    getOneOnOneContactNudgeSenderDisplayName({ oneOnOneCardName: "첫 줄\r\n둘째 줄" }),
    "첫 줄 둘째 줄",
  );
});
