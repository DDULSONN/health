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
const { reviewDatingProfanity } = compile("lib/dating-profanity-review.ts");
const confirmationRules = compile("lib/dating-review-confirmation.ts");
const nameRules = compile("lib/dating-1on1-name-review.ts");

for (const value of [
  "씨발", "씨이발 씨발", "씨벌", "씨빨", "시발", "씨.발", "씨 발", "씨@발", "씨1발", "씨\u200b발", "씨\ufeff발",
  "병신", "병 신", "병.신", "병1신", "개새끼", "개 새 끼", "개색기", "개새기", "지랄", "지1랄", "좆같네",
  "존나", "미친놈", "미친 년", "씹새끼", "씹년", "씹창", "느금마", "니애미", "니애비", "염병",
  "fuck", "fucking", "f.u.c.k", "f u c k", "f**k", "f*ck", "ｆｕｃｋ", "motherfucker",
  "shit", "sh1t", "sh!t", "s.h.i.t", "bullshit", "bitch", "b1tch", "b!tch", "b.i.t.c.h", "asshole", "bastard", "cunt",
  "fuck_you", "씨발 같은 욕설은 하지 않아요",
]) {
  test("profanity review flags explicit/obfuscated text: " + value, () => {
    const result = reviewDatingProfanity({ intro: value });
    assert.equal(result.level, "high");
    assert.ok(result.flags.some((flag) => flag.startsWith("자기소개:") && flag.includes("욕설") && flag.includes("감지:")));
  });
}
for (const value of ["ㅅㅂ", "ㅆㅂ", "ㅂㅅ", "ㅈㄹ", "ㅈㄴ", "ㄱㅅㄲ", "ㅅ.ㅂ", "ㅅ ㅂ", "ㅅ\u200bㅂ", "ㅅㅂㅋㅋ", "ㅋㅋㅅㅂ", "ㅅㅂㅅㅂ", "ㅅㅂ ㅂㅅ"]) {
  test("ambiguous initials remain a visible medium signal: " + value, () => {
    const result = reviewDatingProfanity({ intro: value });
    assert.equal(result.level, "medium");
    assert.ok(result.flags.some((flag) => flag.includes("초성 욕설 의심")));
  });
}
for (const value of [
  "운동을 시작한 시발점이에요", "시발역에서 출발합니다", "시발지와 도착지", "도시 발전 관련 업무를 해요",
  "출시 발표를 맡았습니다", "수시 발생하는 일도 침착하게 처리해요", "정시 발송을 도와요", "택시 발권 서비스",
  "질병 신호를 살펴요", "질병 신고 업무를 합니다", "발병 신고를 담당해요", "전염병 예방", "감염병 예방",
  "신발 수집과 등산이 취미", "새끼손가락을 다쳐서 쉬어요", "새끼 고양이를 키워요", "새끼 강아지 좋아요",
  "음식을 천천히 씹고 먹어요", "미친 듯이 운동했어요", "조나단과 존나단이라는 이름을 들어봤어요",
  "어머니와 아버지를 존경해요", "ㅁㄴㅇㄹ", "ㄱㅅ", "ㅇㅂㅅㄱ", "swimming class", "assistant manager",
  "I live in Scunthorpe", "shiitake mushrooms", "shitake mushrooms", "night shift", "favorite shirt", "Scunthorpe에서 살았어요",
]) {
  test("profanity false-positive regression: " + value, () => {
    assert.deepEqual(reviewDatingProfanity({ intro: value }), { level: "clear", flags: [] });
  });
}
for (const field of ["name", "displayName", "job", "intro", "strengths", "ideal", "idealType", "preferredPartner"]) {
  test("profanity inspects only an author's allowed field: " + field, () => {
    assert.equal(reviewDatingProfanity({ [field]: "씨발" }).level, "high");
  });
}
test("profanity never attributes recipient/account metadata to the author", () => {
  assert.deepEqual(reviewDatingProfanity({ candidateName: "씨발", candidateRegion: "병신", instagramId: "fuck", candidateUserId: "shit", targetCardId: "bitch", intro: null }), { level: "clear", flags: [] });
});
test("profanity signals are deterministic, capped and readable in Korean", () => {
  for (let n = 0; n < 20; n++) assert.match(reviewDatingProfanity({ intro: "ㅅㅂ" }).flags[0], /감지: ㅅㅂ/);
  const result = reviewDatingProfanity(Object.fromEntries(["name", "displayName", "job", "intro", "strengths", "ideal", "idealType", "preferredPartner"].map((key) => [key, "씨발 ㅅㅂ fuck"] )));
  assert.equal(result.level, "high"); assert.equal(result.flags.length, 10);
  assert.ok(result.flags.every((flag) => !flag.includes("\ufffd")));
});

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
    admin_dating_review_confirmations: [],
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
    b.upsert = (rows) => { q.op = "upsert"; q.rows = Array.isArray(rows) ? rows : [rows]; return b; };
    b.delete = () => { q.op = "delete"; return b; };
    b.then = (yes, no) => Promise.resolve().then(() => {
      calls.push({ table, op: q.op });
      if (options.fail?.(q)) return { data: null, error: { code: "XX000", message: "fixture database error" } };
      options.beforeExec?.(q, tables);
      if (q.op !== "select") {
        assert.ok(["admin_dating_card_ai_reviews", "admin_dating_review_confirmations"].includes(table), "Review must never mutate member/card/matching tables");
        if (options.saveFailure && table === "admin_dating_card_ai_reviews") return { data: null, error: { code: "42P01", message: "fixture missing review table" } };
        if (q.op === "delete") {
          const removed = tables[table].filter((row) => q.filters.every((filter) => filter(row)));
          tables[table] = tables[table].filter((row) => !removed.includes(row));
          return { data: removed, error: null };
        }
        for (const row of q.rows) {
          const existing = tables[table].find((entry) => entry.source_type === row.source_type && entry.card_id === row.card_id);
          if (existing) Object.assign(existing, row);
          else tables[table].push({ id: uid(100 + tables[table].length), ...row });
        }
        return { data: q.single ? q.rows[0] : q.rows, error: null };
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
    "@/lib/admin-audit": { recordAdminAuditEvent: (entry) => {
      assert.ok(["dating_card_review_confirm_normal", "dating_card_review_undo_confirmation"].includes(entry.action));
      db.calls.push({ table: "admin_audit_logs", op: "audit", action: entry.action });
    } },
    "@/lib/dating-1on1-name-review": nameRules,
    "@/lib/dating-sexual-text-review": { reviewDatingSexualText },
    "@/lib/dating-intro-quality-review": { reviewDatingIntroQuality },
    "@/lib/dating-profanity-review": { reviewDatingProfanity },
    "@/lib/dating-review-confirmation": confirmationRules,
    "node:crypto": require("node:crypto"),
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
  for (const [value, level] of [["약속 잘 지키는데 씨.발이라는 말을 써요", "high"], ["약속 잘 지키는데 ㅅㅂ이라는 말을 써요", "medium"]]) {
    test(source + " a single profanity finding is visible and stored: " + level, async () => {
      const db = database(fixtures(value)), route = loadRoute(db);
      const response = await route.POST(request(source)), body = await response.json();
      assert.equal(response.status, 200); assert.equal(body.items.length, 1);
      assert.equal(body.items[0].userId, owner);
      assert.equal(body.items[0].review.flags.length, 1);
      assert.equal(body.items[0].review.suspicionLevel, level);
      assert.ok(body.items[0].review.flags[0].includes("욕설"));
      const saved = await (await route.GET(new Request(`https://fixture.invalid/?source=${source}`))).json();
      assert.equal(saved.items.length, 1);
      assert.ok(saved.items[0].flags[0].includes("욕설"));
    });
  }
  test(source + " profanity near the end of a long introduction is not missed", async () => {
    const value = "등산과 수영을 좋아하고 약속을 잘 지킵니다. ".repeat(30) + " 씨발";
    const db = database(fixtures(value)), route = loadRoute(db);
    const body = await (await route.POST(request(source))).json();
    assert.equal(body.items.length, 1);
    assert.ok(body.items[0].review.flags.some((flag) => flag.includes("욕설")));
  });
  test(source + " ordinary similar words do not enter the default review list", async () => {
    const db = database(fixtures("운동을 시작한 시발점은 건강입니다. 전염병 예방을 챙겨요.")), route = loadRoute(db);
    assert.equal((await (await route.POST(request(source))).json()).items.length, 0);
  });
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

test("AI clear cannot remove a single profanity finding", async () => {
  const route = loadRoute(database(fixtures()), { fetch: async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({
    suspicionLevel: "clear", flags: [], textFlags: [], photoFlags: [], summary: "정상으로 추정",
  }) }] } }] }) });
  const imageStub = { storage: { from: () => ({ download: async () => ({ data: null, error: null }) }) } };
  const result = await route.testAnalyze(imageStub, "fixture-key", "fixture-model", {
    sourceType: "one_on_one", displayName: "민수", texts: { name: "민수", intro: "등산과 수영을 좋아해요. 씨발", strengths: "배려하는 성격", preferredPartner: "다정한 분" },
    photoPaths: ["fixture/a.webp", "fixture/b.webp"], bucket: "fixture",
  });
  assert.equal(result.suspicionLevel, "high"); assert.equal(result.flags.length, 1);
  assert.ok(result.textFlags[0].includes("욕설"));
  assert.notEqual(result.summary, "정상으로 추정");
});

const confirmationTable = "admin_dating_review_confirmations";
const reviewTable = "admin_dating_card_ai_reviews";
const confirmationRequest = (item, extra = {}) => new Request("https://fixture.invalid/api/admin/dating/card-ai-review", {
  method: "PATCH", body: JSON.stringify({ action: "confirm_normal", sourceType: item.sourceType, cardId: item.cardId, snapshot: item.confirmationSnapshot, ...extra }),
});
const listRequest = (source, confirmed = false, offset = 0) => new Request(`https://fixture.invalid/?source=${source}&view=${confirmed ? "confirmed" : "pending"}&offset=${offset}`);
const sourceTables = { open_card: "dating_cards", paid_card: "dating_paid_cards", one_on_one: "dating_1on1_cards",
  open_card_application: "dating_card_applications", paid_card_application: "dating_paid_card_applications", one_on_one_application: "dating_1on1_cards" };
async function scanFixture(source = "one_on_one", options = {}) {
  const db = database(fixtures("배려하는 성격인데 씨발이라는 말을 씁니다."), options), route = loadRoute(db);
  const response = await route.POST(request(source)), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.items.length, 1);
  return { db, route, item: body.items[0] };
}
for (const source of sources) {
  test(source + " normal confirmation persists across GET/rescan and is reversible without card mutations", async () => {
    const { db, route, item } = await scanFixture(source);
    const cardsBefore = structuredClone(Object.fromEntries(Object.entries(db.tables).filter(([table]) => !table.startsWith("admin_"))));
    const response = await route.PATCH(confirmationRequest(item));
    assert.equal(response.status, 200); const body = await response.json();
    assert.ok(body.confirmationId); assert.equal(body.cardId, item.cardId); assert.equal(body.sourceType, source);
    assert.equal((await (await route.GET(listRequest(source))).json()).items.length, 0);
    const confirmed = (await (await route.GET(listRequest(source, true))).json()).items;
    assert.equal(confirmed.length, 1); assert.equal(confirmed[0].confirmationCurrent, true);
    assert.equal(confirmed[0].userId, owner); assert.equal(confirmed[0].confirmationId, body.confirmationId);
    const repeat = await (await route.POST(request(source))).json();
    assert.equal(repeat.items.length, 0); assert.equal(repeat.confirmedCount, 1);
    assert.equal(db.tables[confirmationTable][0].id, body.confirmationId);
    const undo = await route.PATCH(confirmationRequest(item, { action: "undo_confirmation", confirmationId: body.confirmationId }));
    assert.equal(undo.status, 200); assert.equal(db.tables[confirmationTable].length, 0);
    assert.equal((await (await route.GET(listRequest(source))).json()).items.length, 1);
    assert.deepEqual(Object.fromEntries(Object.entries(db.tables).filter(([table]) => !table.startsWith("admin_"))), cardsBefore);
    assert.equal(db.calls.filter((entry) => entry.op === "audit").length, 2);
  });
  for (const change of ["text", "photo", "name", "new_registration"]) {
    test(source + " changed content is not hidden by old confirmation: " + change, async () => {
      const { db, route, item } = await scanFixture(source);
      assert.equal((await route.PATCH(confirmationRequest(item))).status, 200);
      const row = db.tables[sourceTables[source]][0];
      if (change === "text") row[source === "open_card" ? "strengths_text" : "intro_text"] += " 병신";
      if (change === "photo") row.photo_paths = ["fixture/new-photo.webp", "fixture/b.webp"];
      if (change === "name") { row.name = "새이름"; row.nickname = "새이름"; row.display_nickname = "새이름"; row.applicant_display_nickname = "새이름"; }
      if (change === "new_registration") {
        if (source === "one_on_one_application") db.tables.dating_1on1_match_proposals[0].id = uid(75);
        else row.id = uid(75);
      }
      const body = await (await route.POST(request(source))).json();
      assert.equal(body.items.length, 1); assert.equal(body.confirmedCount, 0);
      assert.notDeepEqual(body.items[0].confirmationSnapshot, item.confirmationSnapshot);
    });
  }
  test(source + " stale confirmation refuses author edits made after scanning", async () => {
    const { db, route, item } = await scanFixture(source);
    db.tables[sourceTables[source]][0].photo_paths = ["fixture/replaced.webp"];
    assert.equal((await route.PATCH(confirmationRequest(item))).status, 409);
    assert.equal(db.tables[confirmationTable].length, 0);
    const listing = await (await route.GET(listRequest(source))).json();
    assert.equal(listing.items[0].confirmationSnapshot, null);
  });
}
test("ordinary publication state changes do not invalidate confirmation", async () => {
  const { db, route, item } = await scanFixture("open_card");
  assert.equal((await route.PATCH(confirmationRequest(item))).status, 200);
  db.tables.dating_cards[0].status = "pending";
  assert.equal((await (await route.POST(request("open_card"))).json()).items.length, 0);
});
test("improved clean content is not shown simply because the author edited it", async () => {
  const { db, route, item } = await scanFixture();
  await route.PATCH(confirmationRequest(item));
  db.tables.dating_1on1_cards[0].intro_text = "등산과 수영을 좋아하고 약속을 잘 지킵니다.";
  assert.equal((await (await route.POST(request("one_on_one"))).json()).items.length, 0);
});
test("stale result, forged snapshot and a newer administrator decision cannot be acknowledged/undone", async () => {
  const { db, route, item } = await scanFixture();
  assert.equal((await route.PATCH(confirmationRequest(item, { snapshot: { ...item.confirmationSnapshot, contentFingerprint: "a".repeat(64) } }))).status, 409);
  const first = await (await route.PATCH(confirmationRequest(item))).json();
  const second = await (await route.PATCH(confirmationRequest(item))).json();
  assert.notEqual(first.confirmationId, second.confirmationId);
  assert.equal((await route.PATCH(confirmationRequest(item, { action: "undo_confirmation", confirmationId: first.confirmationId }))).status, 409);
  assert.equal(db.tables[confirmationTable][0].id, second.confirmationId);
  db.tables[reviewTable][0].raw_result.confirmationSnapshot.findingsFingerprint = "b".repeat(64);
  assert.equal((await route.PATCH(confirmationRequest(item))).status, 409);
});
test("a simultaneous author edit can only confirm the old fingerprint, never the new content", async () => {
  const { route, item } = await scanFixture("one_on_one", { beforeExec: (q, tables) => {
    if (q.table === confirmationTable && q.op === "upsert") tables.dating_1on1_cards[0].intro_text += " 병신";
  } });
  assert.equal((await route.PATCH(confirmationRequest(item))).status, 200);
  const body = await (await route.POST(request("one_on_one"))).json();
  assert.equal(body.items.length, 1); assert.equal(body.confirmedCount, 0);
});
test("missing confirmation schema keeps suspicious results visible and refuses to claim a saved confirmation", async () => {
  const { db, route, item } = await scanFixture("one_on_one", { fail: (q) => q.table === confirmationTable });
  assert.equal(item.confirmationSnapshot, null);
  const scan = await (await route.POST(request("one_on_one"))).json();
  assert.equal(scan.items.length, 1); assert.equal(scan.confirmationAvailable, false); assert.ok(scan.warning);
  const pending = await (await route.GET(listRequest("one_on_one"))).json();
  assert.equal(pending.items.length, 1); assert.equal(pending.items[0].confirmationSnapshot, null); assert.ok(pending.warning);
  assert.equal((await route.GET(listRequest("one_on_one", true))).status, 503);
  assert.equal((await route.PATCH(confirmationRequest(item, { snapshot: db.tables[reviewTable][0].raw_result.confirmationSnapshot }))).status, 500);
  assert.equal(db.tables[confirmationTable].length, 0);
});
test("failed scan persistence cannot hide results or enable confirmation", async () => {
  const { route, item } = await scanFixture("one_on_one", { saveFailure: true });
  assert.equal(item.confirmationSnapshot, null);
  assert.equal((await route.PATCH(confirmationRequest(item))).status, 400);
});
test("legacy review results require rescan, and normal users cannot confirm or undo", async () => {
  const { db, route, item } = await scanFixture();
  delete db.tables[reviewTable][0].raw_result.confirmationSnapshot;
  const result = await (await route.GET(listRequest("one_on_one"))).json();
  assert.equal(result.items[0].confirmationSnapshot, null);
  assert.equal((await route.PATCH(confirmationRequest(item))).status, 409);
  const denied = loadRoute(db, { denied: true });
  assert.equal((await denied.PATCH(confirmationRequest(item))).status, 403);
  assert.equal((await denied.PATCH(confirmationRequest(item, { action: "undo_confirmation", confirmationId: uid(99) }))).status, 403);
  assert.equal((await denied.GET(listRequest("one_on_one", true))).status, 403);
  assert.equal(db.tables[confirmationTable].length, 0);
});
test("older unconfirmed rows are reachable behind 300 confirmed rows without hydrating all photos", async () => {
  const { db, route } = await scanFixture("open_card");
  const template = db.tables[reviewTable][0];
  db.tables[reviewTable] = Array.from({ length: 301 }, (_, i) => ({ ...structuredClone(template), id: uid(i + 1000), card_id: uid(i + 1000), scanned_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 400 - i)).toISOString() }));
  db.tables[confirmationTable] = db.tables[reviewTable].slice(0, 300).map((row) => ({ id: row.id, source_type: "open_card", card_id: row.card_id,
    content_fingerprint: row.raw_result.confirmationSnapshot.contentFingerprint, findings_fingerprint: row.raw_result.confirmationSnapshot.findingsFingerprint, confirmed_at: row.scanned_at }));
  const first = await (await route.GET(listRequest("open_card"))).json();
  assert.equal(first.items.length, 0); assert.equal(first.nextOffset, 250);
  const next = await (await route.GET(listRequest("open_card", false, first.nextOffset))).json();
  assert.equal(next.items.length, 1); assert.equal(next.items[0].cardId, db.tables[reviewTable][300].card_id); assert.equal(next.nextOffset, null);
});
test("list offsets are validated", async () => {
  const route = loadRoute(database(fixtures()));
  for (const offset of [-1, 1.5, "oops", 1000001]) assert.equal((await route.GET(listRequest("open_card", false, offset))).status, 400);
});
test("confirmation fingerprints exclude expiring URLs/status/recipient metadata but include author, photos and new rules/findings", () => {
  const card = { sourceType: "one_on_one", cardId, userId: owner, displayName: "민수", age: 30, region: "서울", texts: { intro: "씨발" }, photoPaths: ["a.webp"], bucket: "fixture", createdAt: "2026-09-13" };
  const fingerprint = confirmationRules.reviewContentFingerprint(card);
  assert.equal(confirmationRules.reviewContentFingerprint({ ...card, status: "pending", previewUrls: ["signed?new=1"], texts: { ...card.texts, candidateName: "새 상대" } }), fingerprint);
  for (const changes of [{ cardId: uid(80) }, { userId: peer }, { displayName: "새 이름" }, { photoPaths: ["b.webp"] }, { texts: { intro: "다른 내용" } }]) {
    assert.notEqual(confirmationRules.reviewContentFingerprint({ ...card, ...changes }), fingerprint);
  }
  const review = { suspicionLevel: "high", flags: ["b", "a"], textFlags: ["a"], photoFlags: [], raw: { provider: "rules" } };
  const findings = confirmationRules.reviewFindingsFingerprint(review, "v1");
  assert.equal(confirmationRules.reviewFindingsFingerprint({ ...review, summary: "다른 요약", flags: ["a", "b", "a"] }, "v1"), findings);
  assert.notEqual(confirmationRules.reviewFindingsFingerprint(review, "v2"), findings);
  assert.notEqual(confirmationRules.reviewFindingsFingerprint({ ...review, raw: { provider: "gemini" }, photoFlags: ["부적절 사진"] }, "v1"), findings);
});

const reviewPglitePath = process.env.REVIEW_TEST_PGLITE_PATH || process.env.REPORT_TEST_PGLITE_PATH;
test("confirmation SQL runs twice, keeps existing data, denies all client access and supports service-role CAS undo", { skip: !reviewPglitePath }, async () => {
  const { PGlite } = require(reviewPglitePath);
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create table public.dating_cards(id uuid primary key, status text, intro text);
      insert into auth.users values ('${owner}');
      insert into public.dating_cards values ('${cardId}', 'public', '한글 프로필 원본');`);
    const sql = fs.readFileSync(path.join(root, "supabase/sql/admin_dating_review_confirmations.sql"), "utf8");
    await db.exec(sql); await db.exec(sql);
    assert.deepEqual((await db.query("select status,intro from dating_cards")).rows, [{ status: "public", intro: "한글 프로필 원본" }]);
    assert.equal((await db.query("select relrowsecurity from pg_class where relname = 'admin_dating_review_confirmations'")).rows[0].relrowsecurity, true);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select * from admin_dating_review_confirmations"), /permission denied/);
      await assert.rejects(db.query(`insert into admin_dating_review_confirmations(source_type,card_id,content_fingerprint,findings_fingerprint) values ('open_card','${cardId}','${"a".repeat(64)}','${"b".repeat(64)}')`), /permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    const insert = await db.query(`insert into admin_dating_review_confirmations(source_type,card_id,content_fingerprint,findings_fingerprint,confirmed_by)
      values ('open_card','${cardId}','${"a".repeat(64)}','${"b".repeat(64)}','${owner}') returning id`);
    const oldId = insert.rows[0].id;
    const changed = await db.query(`insert into admin_dating_review_confirmations(source_type,card_id,content_fingerprint,findings_fingerprint)
      values ('open_card','${cardId}','${"c".repeat(64)}','${"d".repeat(64)}') on conflict(source_type,card_id) do update
      set id=excluded.id,content_fingerprint=excluded.content_fingerprint,findings_fingerprint=excluded.findings_fingerprint returning id`);
    assert.notEqual(oldId, changed.rows[0].id);
    assert.equal((await db.query(`delete from admin_dating_review_confirmations where id='${oldId}' returning id`)).rows.length, 0);
    assert.equal((await db.query(`delete from admin_dating_review_confirmations where id='${changed.rows[0].id}' returning id`)).rows.length, 1);
    await assert.rejects(db.query(`insert into admin_dating_review_confirmations(source_type,card_id,content_fingerprint,findings_fingerprint) values ('unknown','${cardId}','${"a".repeat(64)}','${"b".repeat(64)}')`), /check constraint/);
    await assert.rejects(db.query(`insert into admin_dating_review_confirmations(source_type,card_id,content_fingerprint,findings_fingerprint) values ('open_card','${cardId}','bad','${"b".repeat(64)}')`), /check constraint/);
  } finally { await db.close(); }
});
