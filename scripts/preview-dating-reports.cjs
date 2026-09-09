/* eslint-disable @typescript-eslint/no-require-imports */
// Loopback-only UI fixture: real report component and CSS, synthetic API replies.
// Never connects to Supabase or sends a report to the production application.
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createRequire } = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const modules = new Map();
function bundle(file) {
  if (modules.has(file)) return file;
  modules.set(file, "");
  let source = fs.readFileSync(file, "utf8");
  if (/\.tsx?$/.test(file)) source = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  source = source.replace(/require\(["']([^"']+)["']\)/g, (_, name) => {
    const target = name.startsWith("@/") ? path.join(root, name.slice(2) + ".ts") : createRequire(file).resolve(name);
    return "require(" + JSON.stringify(bundle(target)) + ")";
  });
  modules.set(file, source);
  return file;
}
async function main() {
  const component = bundle(path.join(root, "components/DatingReportButton.tsx"));
  const react = bundle(require.resolve("react"));
  const dom = bundle(require.resolve("react-dom/client"));
  const js = `(()=>{const process={env:{NODE_ENV:"production"}};const modules={${[...modules].map(([id, source]) => JSON.stringify(id) + ":function(require,module,exports){" + source + "\n}").join(",")}};const cache={};function require(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};modules[id](require,m,m.exports);return m.exports;}
    const React=require(${JSON.stringify(react)});const Button=require(${JSON.stringify(component)}).default;
    const kinds=["open_card","open_card_application","paid_card_application","one_on_one_card","one_on_one_match"];
    require(${JSON.stringify(dom)}).createRoot(document.getElementById("fixture")).render(React.createElement("div",{className:"space-y-3"},kinds.map((kind)=>React.createElement("article",{key:kind,className:"flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-4 text-neutral-900"},React.createElement("span",null,kind),React.createElement(Button,{targetType:kind,targetId:"00000000-0000-4000-8000-000000000001",label:"화면 테스트 회원",onReported:(result)=>{document.getElementById("result").textContent=JSON.stringify(result);}})))));})();`;
  const css = (await require("postcss")([require("@tailwindcss/postcss")()]).process(fs.readFileSync(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
  let count = 0;
  const server = http.createServer(async (req, res) => {
    if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript; charset=utf-8"); return res.end(js); }
    if (req.url === "/fixture.css") { res.setHeader("Content-Type", "text/css; charset=utf-8"); return res.end(css); }
    if (req.method === "POST" && req.url.startsWith("/api/dating/")) {
      let raw = ""; for await (const data of req) raw += data;
      const payload = JSON.parse(raw);
      count++;
      console.log(JSON.stringify({ test_request: count, path: req.url, payload }));
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const failure = payload.detail.includes("차단실패");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ ok: true, blocked: !failure, message: failure
        ? "신고가 접수됐습니다. 다만 차단을 완료하지 못했습니다. 잠시 후 신고 버튼으로 다시 시도해 주세요."
        : "신고가 접수됐습니다. 상대 회원을 차단했습니다. 이미 교환된 연락처는 회수되지 않습니다." }));
    }
    if (req.url !== "/") { res.statusCode = 404; return res.end(); }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end('<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>신고 기능 — 격리 테스트</title><link rel="stylesheet" href="/fixture.css"></head><body><main class="mx-auto max-w-md p-4"><h1 class="my-4 text-lg font-bold">신고 기능 격리 테스트</h1><p class="mb-4 text-sm">실제 회원·운영 DB와 연결되지 않은 테스트 화면입니다.</p><div id="fixture"></div><p id="result" class="mt-4 break-all text-xs"></p></main><script src="/fixture.js"></script></body></html>');
  });
  server.listen(3138, "127.0.0.1", () => console.log("Isolated report UI: http://127.0.0.1:3138"));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
