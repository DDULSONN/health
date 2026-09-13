/* eslint-disable @typescript-eslint/no-require-imports */
// Offline fixtures only: no production DB, AI requests, photos, emails or user actions.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");

function compile(file, resolve = require, extras = "", injectedFetch) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8") + extras, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "fetch", code)(resolve, loaded, loaded.exports,
    injectedFetch ?? (() => { throw new Error("Unexpected network call in isolated test"); }));
  return loaded.exports;
}

const { reviewDatingSexualText } = compile("lib/dating-sexual-text-review.ts");
const { reviewDatingIntroQuality } = compile("lib/dating-intro-quality-review.ts");
const nameRules = compile("lib/dating-1on1-name-review.ts");

const suspicious = [
  ["섹스할 분을 찾습니다", "high"], ["섹파 구해요", "high"],
  ["성관계 가능한 분", "high"], ["원나잇 원해요", "high"],
  ["노콘 좋아해요", "high"], ["야동 같이 봐요", "high"],
  ["오럴 잘하는 사람", "high"], ["질내사정 원해요", "high"],
  ["속궁합 중요합니다", "high"], ["성욕이 강한 편", "high"],
  ["야한 사진 보내주세요", "high"], ["조건만남 가능", "high"],
  ["스폰 구해요", "high"], ["ㅅㅅ 파트너 구함", "high"],
  ["SM 성향 맞는 분", "high"], ["FWB 구해요", "high"],
  ["BDSM partner", "high"], ["Looking for sex", "high"],
  ["one night stand 원합니다", "high"], ["s.e.x partner", "high"],
  ["ｓｅｘ partner", "high"], ["s e x partner", "high"],
  ["섹\u200b스 가능", "high"], ["섹 . 스 가능", "high"],
  ["원.나.잇 상대", "high"], ["자연산 H컵입니다", "medium"],
  ["D 컵 이상 선호", "medium"], ["Ｈ컵", "medium"],
  ["가슴이 큰 사람 좋아해요", "medium"], ["거유 좋아해요", "medium"],
  ["자지 크기", "high"], ["보지", "high"],
  ["원나잇은 싫지만 섹파는 구합니다", "high"],
  ["19금 대화 가능해요", "high"], ["ㅅ.ㅅ 파트너", "high"],
  ["섹친 구해요", "high"], ["쎽스 원해요", "high"], ["원나잇트 가능", "high"],
  ["폰섹 할 분", "high"], ["캠섹 가능합니다", "high"], ["영섹 가능해요", "high"],
  ["쓰리썸 원해요", "high"], ["3썸 가능", "high"], ["초대남 구합니다", "high"],
  ["커플 스와핑 상대", "high"], ["돔/섭 성향", "high"], ["에셈 성향", "high"],
  ["본디지 좋아해요", "high"], ["야한 톡 해요", "high"], ["야릇한 대화 가능", "high"],
  ["알몸 사진 보내주세요", "high"], ["누드 사진을 교환해요", "high"], ["벗은 영상 주세요", "high"],
  ["노팬티 사진 보내요", "high"], ["성기 사진", "high"], ["벗방 봐요", "high"],
  ["몸캠 가능합니다", "high"], ["딜도 사용", "high"], ["오나홀 좋아요", "high"],
  ["대물남 선호", "medium"], ["왕가슴 좋아요", "medium"], ["소추남 사절", "medium"],
  ["ㅅㅍ 구함", "high"], ["ㅇㄴㅇ 가능", "high"], ["ㄴㅋ 만남", "high"],
  ["ㅈㅈ 크기", "high"], ["ㅂㅈ 사이즈", "high"], ["야스 가능", "high"],
  ["색스할 분", "high"], ["떡칠 분 구함", "high"], ["같이 떡치실 분", "high"],
  ["질싸 가능", "high"], ["입싸 좋아해요", "high"], ["얼싸 가능", "high"],
  ["섹1스", "high"], ["섹 1 스 원해요", "high"], ["ㅅ ㅔ ㄱ ㅅ ㅡ", "high"],
  ["폰.섹 해요", "high"], ["섹@스", "high"], ["ｓ３ｘ partner", "high"],
  ["s€x please", "high"], ["p0rn", "high"], ["FWB_partner wanted", "high"],
  ["sexting please", "high"], ["fuck buddy", "high"], ["fuckbuddy", "high"],
  ["sexpartner", "high"], ["threesome please", "high"], ["looking for hookups", "high"],
  ["no FWB but sexting please", "high"], ["폰섹은 싫지만 초대남은 구해요", "high"],
  ["정액 사진", "high"], ["자위 중독", "high"],
  ["야.스 가능", "high"], ["색 스 할분", "high"],
];
for (const [text, level] of suspicious) {
  test("sexual signal: " + text, () => {
    const result = reviewDatingSexualText({ intro: text });
    assert.equal(result.level, level);
    assert.ok(result.flags.some((flag) => flag.startsWith("자기소개:")));
  });
}

const ordinary = [
  "가슴 운동과 하체 운동을 좋아합니다", "등 가슴 어깨 운동을 꾸준히 합니다",
  "가슴이 따뜻하고 다정한 사람이 좋아요", "몸선이 예쁘고 자기관리를 해요",
  "글래머 스타일이며 긍정적인 성격입니다", "체격 좋은 분, 넓은 어깨가 좋아요",
  "섹시한 스타일을 좋아합니다", "Sussex에서 살았어요", "sexy한 분위기",
  "크로스핏, 수영, SM엔터 음악 좋아해요", "이성 관계가 깔끔해요",
  "동성 관계를 비하하지 않아요", "동성애자입니다", "이성애자입니다",
  "외모만 보지 않아요", "늦게 자지 않고 일찍 일어나요", "남 눈치 보지 않는 성격",
  "잠자리가 예민해서 일찍 자요", "나비와 잠자리 관찰이 취미", "월드컵 보는 것을 좋아해요",
  "원나잇 안 해요", "원나잇은 원하지 않습니다", "섹파 사절입니다",
  "조건만남 제안은 거절합니다", "야한 사진 요구는 하지 않아요",
  "가벼운 만남이 아닌 진지한 연애를 원합니다",
  "야동은 안 봐요", "성적인 취향을 강요하는 분은 싫어요",
  "주말에 운동 파트너를 찾습니다", "밤에 운동을 자주 해요", "체력이 좋아서 야간 근무도 잘해요",
  "성향이 차분하고 다정한 편입니다", "야스오 플레이를 즐겨요", "야스민 향을 좋아해요",
  "빨간색 스타일을 좋아합니다", "대물 낚시가 취미예요", "정액권으로 헬스장에 다녀요",
  "정액 결제로 구독 중입니다", "정액제와 정액 요금제", "정액 수당을 받고 있어요",
  "가슴 운동과 등 운동을 꾸준히 해요", "자위대 관련 역사책을 읽어요", "개인 사정으로 이사했어요",
  "후배 위로를 잘해요", "일반적인 스킨십도 대화하며 맞춰가고 싶어요", "키 169cm, 체중 69kg입니다",
  "떡 치대는 일을 해요", "떡치는 기계를 만드는 회사에 다녀요", "입싸움보다는 대화를 해요",
  "DOM 조작과 메모리 스와핑을 배우고 있어요", "SM 엔터 음악 팬입니다", "DTF 전사 인쇄가 직업이에요",
  "여자친구의 성적 지향을 존중합니다", "동성애자이고 차분한 성격입니다", "수영 기록 경신 ㅅㅅ!",
  "폰섹 안 해요", "폰섹은 좋아하지 않아요", "원나잇트 사절", "원나잇 할 생각 없어요",
  "ㅅㅅ 파트너는 안 구합니다", "야스 사절입니다", "초대남 사절", "몸캠은 거절합니다",
  "no FWB", "not looking for hookups", "not interested in sexting", "don't want sex", "FWB is not for me",
  "야 스쿼트 같이 하자", "회색 스니커즈를 좋아해요", "야스 사절입니다. 주말엔 운동하고 있어요",
];
for (const text of ordinary) {
  test("ordinary/refusal text stays unflagged: " + text, () => {
    assert.deepEqual(reviewDatingSexualText({ intro: text }), { level: "clear", flags: [] });
  });
}

for (const field of ["name", "displayName", "job", "intro", "strengths", "ideal", "idealType", "preferredPartner"]) {
  test("checks author field " + field, () => {
    assert.equal(reviewDatingSexualText({ [field]: "속궁합 중요" }).level, "high");
  });
}
test("never attributes recipient names or account IDs to the author", () => {
  assert.equal(reviewDatingSexualText({ candidateName: "섹파", instagramId: "sex", sourceCardId: "sex", intro: null }).level, "clear");
});
test("flags include the matched expression for the admin, without copying unrelated private text", () => {
  const result = reviewDatingSexualText({ intro: "폰섹 할 분. 이것은 unrelated_private_text", candidateName: "다른회원" });
  assert.ok(result.flags.some((flag) => flag.includes("감지: 폰섹")));
  assert.ok(result.flags.every((flag) => !flag.includes("unrelated_private_text") && !flag.includes("다른회원")));
});
test("repeated calls and fields are deterministic", () => {
  for (let i = 0; i < 20; i++) assert.equal(reviewDatingSexualText({ intro: "섹파" }).level, "high");
});
test("checks text beyond character 500", () => {
  assert.equal(reviewDatingSexualText({ intro: "차분한 성격입니다. ".repeat(100) + "자연산 H컵" }).level, "medium");
});

for (const text of [
  "", " ", "ㅎㅇ", "ㅋㅋㅋㅋㅋㅋㅋㅋ", "ㅁㄴㅇㅁㄴㅇ", "12345678901234567890", "...!", "💪😊❤️",
  "\u200b\ufeff", "안녕하세요", "안녕하세요 반갑습니다 잘 부탁드립니다! ㅎㅎ", "안녕하세요. ".repeat(20),
  "hello, nice to meet you!", "없음", "나중에 작성할게요", "작성 예정", "ＴＥＳＴ", "a.s.d.f q.w.e.r",
  "가나다라마바사".repeat(30), "aaaaaaaaaaaaaaaaaaaa", "달리기달리기달리기달리기",
  "착해요", "착해요 ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ 11111111111 😊",
]) {
  test("low-effort introduction: " + JSON.stringify(text.slice(0, 60)), () => {
    const result = reviewDatingIntroQuality("one_on_one", { intro: text });
    assert.equal(result.level, "medium");
    assert.equal(result.flags.length, 1);
    assert.ok(result.flags[0].startsWith("자기소개:"));
  });
}

for (const text of [
  "주말엔 등산하고 평일엔 수영해요.", "배려하며 잘 웃어요", "안녕하세요! 요리하고 캠핑하는 걸 좋아해요.",
  "QA 테스트 업무를 하고 주말엔 수영을 즐깁니다", "소개가 어렵지만 약속을 잘 지키고 배려하는 편이에요",
  "나중에 같이 등산하며 이야기하고 싶어요", "hello! I like swimming and hiking.",
  "예능 보며 웃는 걸 좋아해요 ㅋㅋㅋㅋㅋㅋ", "취미는 복싱이고 상대의 이야기를 잘 들어요 💪😊❤️",
  "다정하고 사소한 약속도 잘 지켜요. 자세한 이야기는 나중에 작성할게요.",
]) {
  test("concise but specific introduction is not a quality flag: " + text, () => {
    assert.deepEqual(reviewDatingIntroQuality("one_on_one", { intro: text, strengths: "잘 웃어요", preferredPartner: "다정한 분" }), { level: "clear", flags: [] });
  });
}

test("introduction length boundary excludes padding, counts complete letters", () => {
  assert.equal(reviewDatingIntroQuality("one_on_one", { intro: "배려하며 잘 웃어!" }).level, "medium");
  assert.equal(reviewDatingIntroQuality("one_on_one", { intro: "배려하며 잘 웃어요!" }).level, "clear");
});
test("long preferences and metadata cannot pad a short introduction", () => {
  const result = reviewDatingIntroQuality("one_on_one_application", {
    intro: "착해요", preferredPartner: "주말에는 같이 운동하고 좋은 이야기를 나눌 수 있는 분을 만나고 싶습니다",
    strengths: "상대의 이야기를 듣고 서로를 배려하는 성격입니다", job: "소프트웨어 개발자",
    candidateName: "상대회원이름", candidateRegion: "서울", sourceCardId: "x".repeat(80), targetCardId: "y".repeat(80),
  });
  assert.equal(result.level, "medium");
  assert.equal(result.flags.length, 1);
  assert.ok(result.flags[0].startsWith("자기소개:"));
});
test("open cards assess strengths, not a nonexistent intro or concise ideal", () => {
  assert.equal(reviewDatingIntroQuality("open_card", { strengths: "안녕하세요", idealType: "다정한 분" }).level, "medium");
  assert.deepEqual(reviewDatingIntroQuality("open_card", { strengths: "배려하며 잘 웃어요", idealType: "다정한 분" }), { level: "clear", flags: [] });
});
test("paid cards copied from open cards may omit intro", () => {
  assert.deepEqual(reviewDatingIntroQuality("paid_card", { intro: "", strengths: "배려하며 잘 웃어요", ideal: "다정한 분" }), { level: "clear", flags: [] });
  assert.equal(reviewDatingIntroQuality("paid_card", { intro: null, strengths: "ㅇㅇㅇ" }).level, "medium");
});
test("obvious filler in a supporting field is flagged, optional blanks are not", () => {
  const result = reviewDatingIntroQuality("one_on_one", { intro: "배려하며 잘 웃어요", strengths: "나중에 작성할게요", preferredPartner: "" });
  assert.equal(result.flags.length, 1);
  assert.ok(result.flags[0].startsWith("내 강점:"));
});
test("never flags recipient fields, occupation or account IDs as introduction quality", () => {
  assert.equal(reviewDatingIntroQuality("one_on_one_application", { intro: "배려하며 잘 웃어요", job: "테스트", name: "ㅎㅎ", candidateName: "안녕하세요", candidateUserId: "a".repeat(80), instagramId: "asdf" }).level, "clear");
});
test("unknown source is safely ignored and repeated review calls are stable", () => {
  assert.equal(reviewDatingIntroQuality("unrelated", { intro: "ㅎㅇ" }).level, "clear");
  for (let n = 0; n < 20; n++) assert.equal(reviewDatingIntroQuality("one_on_one", { intro: "착해요" }).level, "medium");
});

const uid = (n) => `d731acf4-b825-4e69-92da-318cfd478a${n.toString(16).padStart(2, "0")}`;
const owner = uid(1), peer = uid(2), cardId = uid(10), peerCardId = uid(11), applicationId = uid(20);
const sources = ["open_card", "paid_card", "one_on_one", "open_card_application", "paid_card_application", "one_on_one_application"];
function fixtures(text = "자연산 H컵입니다") {
  const card = { id: cardId, owner_user_id: owner, user_id: owner, status: "public", name: "민수", display_nickname: "차분한회원", nickname: "차분한회원",
    age: 30, birth_year: 1996, region: "서울", job: "회사원", intro_text: text, strengths_text: "차분하고 약속을 잘 지키는 성격입니다",
    ideal_type: "다정하고 배려 깊은 분을 만나고 싶어요", ideal_text: "다정하고 배려 깊은 분을 만나고 싶어요",
    preferred_partner_text: "다정하고 배려 깊은 분을 만나고 싶어요", photo_paths: ["fixture/a.webp", "fixture/b.webp"], admin_tags: [], created_at: "2026-09-13T00:00:00Z" };
  const app = { ...card, id: applicationId, card_id: cardId, paid_card_id: cardId, applicant_user_id: owner,
    applicant_display_nickname: "차분한회원", height_cm: 175, training_years: 2, status: "submitted" };
  return {
    profiles: [{ user_id: owner, nickname: "차분한회원" }, { user_id: peer, nickname: "상대회원" }],
    dating_cards: [{ ...card, strengths_text: text }], dating_paid_cards: [{ ...card, status: "approved" }],
    dating_1on1_cards: [{ ...card, status: "approved" }, { ...card, id: peerCardId, user_id: peer, name: "지수", status: "hidden" }],
    dating_card_applications: [app], dating_paid_card_applications: [app],
    dating_1on1_match_proposals: [{ id: applicationId, source_card_id: cardId, source_user_id: owner, candidate_card_id: peerCardId,
      candidate_user_id: peer, state: "source_selected", created_at: card.created_at, source_selected_at: card.created_at }],
    admin_dating_card_ai_reviews: [],
  };
}

function database(seed, options = {}) {
  const tables = structuredClone(seed), calls = [];
  const admin = { from(table) {
    const q = { table, op: "select", filters: [], orders: [], from: 0, to: Infinity };
    const b = {};
    b.select = () => b;
    b.in = (key, values) => { q.filters.push((row) => values.includes(row[key])); return b; };
    b.eq = (key, value) => { q.filters.push((row) => row[key] === value); return b; };
    b.order = (key, config) => { q.orders.push([key, config]); return b; };
    b.range = (from, to) => { q.from = from; q.to = to; return b; };
    b.limit = (n) => { q.to = n - 1; return b; };
    b.maybeSingle = () => { q.single = true; return b; };
    b.upsert = (rows) => { q.op = "upsert"; q.rows = rows; return b; };
    b.then = (yes, no) => Promise.resolve().then(() => {
      calls.push({ table, op: q.op });
      if (q.op !== "select") {
        assert.equal(table, "admin_dating_card_ai_reviews", "Review must never mutate member/card/matching tables");
        if (options.saveFailure) return { data: null, error: { code: "42P01", message: "fixture missing review table" } };
        for (const row of q.rows) {
          const existing = tables[table].find((entry) => entry.source_type === row.source_type && entry.card_id === row.card_id);
          if (existing) Object.assign(existing, row);
          else tables[table].push({ id: uid(100 + tables[table].length), ...row });
        }
        return { data: null, error: null };
      }
      let rows = (tables[table] ?? []).filter((row) => q.filters.every((filter) => filter(row)));
      for (const [key, config] of [...q.orders].reverse()) rows = rows.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (config?.ascending ? 1 : -1));
      rows = rows.slice(q.from, q.to + 1);
      return { data: q.single ? rows[0] ?? null : rows, error: null };
    }).then(yes, no);
    return b;
  }, storage: { from() { throw new Error("Rules scan must not download photos"); } } };
  return { admin, tables, calls };
}

function loadRoute(db, options = {}) {
  const deps = {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/admin-route": { requireAdminRoute: async () => options.denied
      ? { ok: false, response: Response.json({ error: "권한 없음" }, { status: 403 }) }
      : { ok: true, admin: db.admin, user: { id: owner } } },
    "@/lib/admin-audit": { recordAdminAuditEvent: () => { throw new Error("Unexpected action audit"); } },
    "@/lib/dating-1on1-name-review": nameRules,
    "@/lib/dating-sexual-text-review": { reviewDatingSexualText },
    "@/lib/dating-intro-quality-review": { reviewDatingIntroQuality },
    "@/lib/dating-cards-queue": { promotePendingCardsBySex: () => { throw new Error("Unexpected promotion"); } },
    "@/lib/dating-swipe": { sendDatingEmailToAddressDetailed: () => { throw new Error("Unexpected email"); } },
    "@/lib/images": { buildSignedImageUrlAllowRaw: () => "/fixture.webp", extractStorageObjectPathFromBuckets: (value) => value },
    "@/lib/supabase/server": { createAdminClient: () => db.admin },
  };
  return compile("app/api/admin/dating/card-ai-review/route.ts", (id) => {
    if (!(id in deps)) throw new Error("Unexpected import: " + id);
    return deps[id];
  }, "\nexports.testRuleReview = ruleReview; exports.testAnalyze = analyzeWithGemini;", options.fetch);
}
const request = (source, extra = {}) => new Request("https://fixture.invalid/api/admin/dating/card-ai-review", {
  method: "POST", body: JSON.stringify({ mode: "rules", source, limit: 50, ...extra }),
});

for (const source of sources) {
  test(source + " new obfuscated slang is stored and visible in default review with the matched term", async () => {
    const db = database(fixtures("폰.섹 할 분. 차분한 성격입니다.")), route = loadRoute(db);
    const response = await route.POST(request(source)), body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].review.suspicionLevel, "high");
    assert.ok(body.items[0].review.flags.some((flag) => flag.includes("감지: 폰섹")));
    const saved = await (await route.GET(new Request(`https://fixture.invalid/?source=${source}`))).json();
    assert.equal(saved.items.length, 1);
    assert.ok((saved.items[0].flags ?? saved.items[0].review.flags).some((flag) => flag.includes("감지: 폰섹")));
  });
  test(source + " one low-effort flag is visible in the default scan and saved list", async () => {
    const db = database(fixtures("안녕하세요 반갑습니다")), route = loadRoute(db);
    const response = await route.POST(request(source)), body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].userId, owner, "Actions must target the author, not the recipient");
    assert.equal(body.items[0].review.flags.length, 1);
    assert.equal(body.items[0].review.suspicionLevel, "medium");
    assert.ok(body.items[0].review.flags[0].includes("인사말만"));
    const saved = await (await route.GET(new Request(`https://fixture.invalid/?source=${source}`))).json();
    assert.equal(saved.items.length, 1);
    assert.equal(saved.items[0].user_id ?? saved.items[0].userId, owner, "Saved reviews must keep the author as action target");
    assert.equal(saved.items[0].texts[source === "open_card" ? "strengths" : "intro"], "안녕하세요 반갑습니다");
  });
  test(source + " concise substantive introduction stays out of the default list", async () => {
    const db = database(fixtures("배려하며 잘 웃어요")), route = loadRoute(db);
    const body = await (await route.POST(request(source))).json();
    assert.equal(body.items.length, 0);
  });
  test(source + " single sexual flag appears in default scan and saved results", async () => {
    const db = database(fixtures()), route = loadRoute(db);
    const response = await route.POST(request(source)), body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.items.length, 1);
    assert.ok(body.items[0].review.flags.some((flag) => flag.includes("성적")));
    assert.equal(body.items[0].review.flags.length, 1, "One finding alone must be enough for visibility");
    assert.equal(body.items[0].review.suspicionLevel, "medium");
    const saved = await (await route.GET(new Request(`https://fixture.invalid/?source=${source}`))).json();
    assert.equal(saved.items.length, 1);
    assert.equal(saved.items[0].texts[source === "open_card" ? "strengths" : "intro"], "자연산 H컵입니다");
    assert.ok(db.calls.every((call) => call.op === "select" || call.table === "admin_dating_card_ai_reviews"));
  });
  test(source + " includes sexual text after 500 characters on scan and reload", async () => {
    const longText = "차분하고 다정한 성격으로 서로 배려하는 연애를 원합니다. ".repeat(24) + " 속궁합 중요";
    const db = database(fixtures(longText)), route = loadRoute(db);
    const body = await (await route.POST(request(source))).json();
    assert.equal(body.items.length, 1);
    assert.ok(body.items[0].review.flags.some((flag) => flag.includes("성적")));
    const saved = await (await route.GET(new Request(`https://fixture.invalid/?source=${source}`))).json();
    assert.ok(saved.items[0].texts[source === "open_card" ? "strengths" : "intro"].includes("속궁합"));
  });
}
test("all six existing source types still participate", async () => {
  const db = database(fixtures()), route = loadRoute(db);
  const body = await (await route.POST(request("all"))).json();
  assert.deepEqual(new Set(body.items.map((item) => item.sourceType)), new Set(sources));
});
test("normal complete card is not added to the default review list", async () => {
  const db = database(fixtures("가슴 운동과 수영을 좋아하고 다정한 성격입니다")), route = loadRoute(db);
  assert.equal((await (await route.POST(request("one_on_one"))).json()).items.length, 0);
});

test("rescan replaces a stale clear result and clears a quality flag after the author improves their text", async () => {
  const db = database(fixtures("배려하며 잘 웃어요")), route = loadRoute(db);
  await route.POST(request("one_on_one"));
  db.tables.dating_1on1_cards[0].intro_text = "ㅎㅇ";
  assert.equal((await (await route.POST(request("one_on_one"))).json()).items.length, 1);
  assert.equal(db.tables.admin_dating_card_ai_reviews.length, 1);
  db.tables.dating_1on1_cards[0].intro_text = "배려하며 잘 웃어요";
  assert.equal((await (await route.POST(request("one_on_one"))).json()).items.length, 0);
  assert.equal((await (await route.GET(new Request("https://fixture.invalid/?source=one_on_one"))).json()).items.length, 0);
});
test("paid card without optional intro is not falsely listed as low-effort", async () => {
  const seed = fixtures();
  seed.dating_paid_cards[0].intro_text = null;
  const route = loadRoute(database(seed));
  assert.equal((await (await route.POST(request("paid_card"))).json()).items.length, 0);
});
test("existing external contact detection remains active", async () => {
  const db = database(fixtures("인스타 아이디 contact_fixture 로 연락 주세요")), route = loadRoute(db);
  const body = await (await route.POST(request("one_on_one"))).json();
  assert.equal(body.items[0].review.suspicionLevel, "high");
  assert.ok(body.items[0].review.flags.some((flag) => /연락|계정/.test(flag)));
});
test("denied admin cannot scan or read member data", async () => {
  const db = database(fixtures()), route = loadRoute(db, { denied: true });
  assert.equal((await route.POST(request("all"))).status, 403);
  assert.equal((await route.GET(new Request("https://fixture.invalid"))).status, 403);
  assert.equal(db.calls.length, 0);
});
test("AI clear result cannot erase rule-based sexual flags or severity", async () => {
  const route = loadRoute(database(fixtures()), { fetch: async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({
    suspicionLevel: "clear", flags: [], textFlags: [], photoFlags: [], summary: "정상으로 추정",
  }) }] } }] }) });
  const result = await route.testAnalyze({}, "fixture-key", "fixture-model", {
    sourceType: "one_on_one", displayName: "민수", texts: { name: "민수", intro: "섹파 구해요", strengths: "다정한 성격", preferredPartner: "다정한 분" }, photoPaths: [],
  });
  assert.equal(result.suspicionLevel, "high");
  assert.ok(result.textFlags.some((flag) => flag.includes("성적")));
  assert.notEqual(result.summary, "정상으로 추정");
  assert.equal(result.raw.provider, "gemini");
});

test("AI clear result cannot erase a single introduction quality flag", async () => {
  const route = loadRoute(database(fixtures()), { fetch: async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({
    suspicionLevel: "clear", flags: [], textFlags: [], photoFlags: [], summary: "정상으로 추정",
  }) }] } }] }) });
  const imageStub = { storage: { from: () => ({ download: async () => ({ data: null, error: null }) }) } };
  const result = await route.testAnalyze(imageStub, "fixture-key", "fixture-model", {
    sourceType: "one_on_one", displayName: "민수", texts: { name: "민수", intro: "안녕하세요 반갑습니다", strengths: "배려하는 성격", preferredPartner: "다정한 분" },
    photoPaths: ["fixture/a.webp", "fixture/b.webp"], bucket: "fixture",
  });
  assert.equal(result.suspicionLevel, "medium");
  assert.equal(result.flags.length, 1);
  assert.ok(result.textFlags.some((flag) => flag.includes("인사말만")));
  assert.notEqual(result.summary, "정상으로 추정");
});
