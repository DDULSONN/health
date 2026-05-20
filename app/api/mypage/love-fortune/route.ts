import { NextResponse } from "next/server";
import { isAllowedAdminUser } from "@/lib/admin";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";

type LoveFortuneRow = {
  id: string;
  user_id: string;
  status: "draft" | "pending_payment" | "paid" | "generated" | "refunded" | "canceled";
  calendar_type: string;
  birth_date: string;
  birth_time: string;
  birth_time_certainty: string;
  birth_place: string | null;
  gender: string;
  love_state: string | null;
  relationship_goal: string | null;
  meeting_preference: string | null;
  focus: string | null;
  concern: string | null;
  partner_birth_date: string | null;
  partner_birth_time: string | null;
  partner_relation: string | null;
  amount: number;
  ai_model: string | null;
  ai_result: string | null;
  ideal_face_profile: Record<string, unknown> | null;
  ideal_face_prompt: string | null;
  ideal_face_image_url: string | null;
  paid_at: string | null;
  generated_at: string | null;
  created_at: string;
};

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const LOVE_FORTUNE_SELECT =
  "id,user_id,status,calendar_type,birth_date,birth_time,birth_time_certainty,birth_place,gender,love_state,relationship_goal,meeting_preference,focus,concern,partner_birth_date,partner_birth_time,partner_relation,amount,ai_model,ai_result,ideal_face_profile,ideal_face_prompt,ideal_face_image_url,paid_at,generated_at,created_at";

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function seedFromReading(row: Pick<LoveFortuneRow, "birth_date" | "birth_time" | "love_state" | "relationship_goal" | "meeting_preference" | "focus" | "concern">) {
  const raw = [
    row.birth_date,
    row.birth_time,
    row.love_state ?? "",
    row.relationship_goal ?? "",
    row.meeting_preference ?? "",
    row.focus ?? "",
    row.concern ?? "",
  ].join("|");
  return raw.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function pick<T>(seed: number, values: T[]) {
  return values[Math.abs(seed) % values.length];
}

function buildIdealFaceProfile(row: LoveFortuneRow) {
  const seed = seedFromReading(row);
  const eye = pick(seed + 1, [
    "차분하고 오래 마주봐도 편안한 눈매",
    "웃을 때 부드럽게 풀리는 선한 눈매",
    "집중력이 느껴지는 또렷한 눈매",
    "말을 잘 들어줄 것 같은 안정적인 눈빛",
  ]);
  const smile = pick(seed + 3, [
    "장난기보다 안정감이 먼저 느껴지는 미소",
    "처음 만난 긴장을 자연스럽게 풀어주는 미소",
    "말보다 배려가 먼저 보이는 담백한 미소",
    "과하지 않지만 오래 기억나는 따뜻한 미소",
  ]);
  const mood = pick(seed + 5, [
    "편안하고 신뢰감 있는 분위기",
    "활동적인 자리에서도 상대를 배려하는 분위기",
    "차분하지만 가까워질수록 밝아지는 분위기",
    "과하지 않고 오래 볼수록 매력적인 분위기",
  ]);
  const style = pick(seed + 7, [
    "깔끔한 기본 스타일",
    "운동 후에도 편하게 어울리는 캐주얼 스타일",
    "부드러운 색감의 단정한 스타일",
    "자기 관리가 느껴지는 미니멀한 스타일",
  ]);
  const firstDate = pick(seed + 9, [
    "카페에서 길게 이야기해도 대화가 쉽게 끊기지 않는 사람",
    "산책이나 가벼운 활동에서 자연스럽게 매력이 드러나는 사람",
    "처음부터 강하게 밀어붙이기보다 속도를 맞춰주는 사람",
    "말보다 약속과 태도로 신뢰를 주는 사람",
  ]);
  const avoid = pick(seed + 11, [
    "감정 기복을 초반부터 크게 드러내는 분위기",
    "대화보다 평가가 앞서는 태도",
    "연락 속도만 빠르고 약속은 불안정한 타입",
    "처음부터 정답을 강요하는 분위기",
  ]);
  const prompt = [
    "warm editorial dating profile illustration",
    mood,
    eye,
    smile,
    style,
    "natural Korean dating app mood, soft light, respectful, not photorealistic",
  ].join(", ");

  return {
    title: "잘 맞는 인상 미리보기",
    eye,
    smile,
    mood,
    style,
    firstDate,
    avoid,
    note: "실제 외모를 단정하는 기능이 아니라, 입력된 연애 성향과 잘 맞는 분위기를 카드처럼 정리한 참고용입니다.",
    prompt,
  };
}

function buildPrompt(row: LoveFortuneRow) {
  const ideal = buildIdealFaceProfile(row);

  return [
    "당신은 오래 상담해온 한국식 사랑/연애 사주 상담가입니다.",
    "사용자가 결제 후 보는 유료 풀이입니다. 무료 미리보기보다 훨씬 구체적이고, 실제 상담을 받은 것처럼 밀도 있게 작성하세요.",
    "양산형 AI 문장처럼 쓰지 말고, 실제 사주 상담자가 앞에 앉아 '이 사람의 연애 결'을 짚어주는 말투로 쓰세요.",
    "",
    "[반드시 지킬 것]",
    "- 실제 만세력 계산값이 없으므로 특정 간지, 십성, 대운, 세운을 단정하지 마세요.",
    "- 태어난 시간이 불확실하면 해석 범위를 먼저 설명하고, 성향/관계 패턴 중심으로 풀어주세요.",
    "- 공포 마케팅, 운명 단정, 질병/임신/사망/재물 보장, 상대 외모 단정은 금지합니다.",
    "- '사주적으로 보자면', '이 결은', '이 흐름은' 같은 분위기는 살리되, 허무맹랑하지 않게 현실적인 연애 조언으로 연결하세요.",
    "- 사주 용어를 쓸 때는 반드시 바로 옆에 쉬운 풀이를 붙이세요. 예: 대운(10년 단위로 바뀌는 큰 환경 흐름), 세운(올해처럼 1년 단위로 들어오는 분위기), 시주(태어난 시간으로 보는 관계의 세부 결).",
    "- 대운/세운을 특정 연도로 단정하지 말고, '큰 흐름이 바뀔 때 어떤 태도를 취해야 하는지'를 연애 행동으로 구체화하세요.",
    "- 사용자가 사주를 전혀 몰라도 술술 읽히게, 일상 예시를 섞어서 풀어주세요. 예: 답장 텀, 첫 만남 장소, 호감 표현 방식, 관계 속도 조절.",
    "- 'AI', '알고리즘', '데이터상' 같은 표현은 절대 쓰지 마세요.",
    "- 듣기 좋은 말만 하지 말고, 반복될 수 있는 연애 약점과 조심할 점도 부드럽게 짚으세요.",
    "- 핵심 섹션은 5~8문장으로 충분히 깊게 쓰되, 한 문단은 2~3문장 안에서 끊어 모바일에서 읽기 쉽게 만드세요.",
    "- 전체 결과는 최소 2,800자 이상으로 작성하세요. 단, 같은 말을 반복하지 말고 각 섹션마다 새로운 판단과 행동 가이드를 주세요.",
    "- 결과가 '그럴듯한 일반론'처럼 보이면 실패입니다. 입력된 연애 상태, 목표, 고민을 반복해서 끌어와 개인 상담처럼 써주세요.",
    "- 현재 고민에 '반복 패턴', '연락 스타일', '불안해지는 순간', '상대에게 자주 듣는 말'이 포함되어 있으면 그 항목을 핵심 근거로 삼으세요.",
    "- '대화를 많이 하세요', '솔직해지세요' 같은 당연한 조언으로 끝내지 마세요. 왜 그 사람이 그 패턴을 반복하는지, 다음 만남에서 어떤 문장/속도/선택으로 바꿀지까지 써주세요.",
    "- 각 해석 뒤에는 반드시 '그래서 실제로는 어떻게 하면 좋은지'를 붙이세요.",
    "- 마지막에는 서비스 홍보가 아니라, 사용자가 실제로 오늘 할 수 있는 연애 행동을 정리하세요.",
    "",
    "[입력 정보]",
    `생년월일: ${row.birth_date}`,
    `달력: ${row.calendar_type}`,
    `태어난 시간: ${row.birth_time}`,
    `태어난 시간 확실성: ${row.birth_time_certainty}`,
    `태어난 지역: ${row.birth_place ?? "미입력"}`,
    `성별: ${row.gender}`,
    `현재 연애 상황: ${row.love_state ?? "미입력"}`,
    `연애 목표: ${row.relationship_goal ?? "미입력"}`,
    `선호 만남 방식: ${row.meeting_preference ?? "미입력"}`,
    `보고 싶은 항목: ${row.focus ?? "미입력"}`,
    `현재 고민: ${row.concern ?? "미입력"}`,
    `상대 생년월일: ${row.partner_birth_date ?? "미입력"}`,
    `상대 태어난 시간: ${row.partner_birth_time ?? "미입력"}`,
    `상대와의 관계: ${row.partner_relation ?? "미입력"}`,
    "",
    "[잘 맞는 인상 카드 참고]",
    `분위기: ${ideal.mood}`,
    `눈매: ${ideal.eye}`,
    `미소: ${ideal.smile}`,
    `스타일: ${ideal.style}`,
    `첫 만남: ${ideal.firstDate}`,
    `피하면 좋은 느낌: ${ideal.avoid}`,
    "",
    "[출력 형식]",
    "아래 제목을 그대로 사용하고, 각 제목 아래는 자연스러운 문단으로 작성하세요.",
    "## 도화냥 총평",
    "상담자가 첫마디로 짚어주는 듯한 결과 전체의 핵심. 한 문장으로 끝내지 말고, 왜 그렇게 보는지 짧게 덧붙이세요.",
    "## 입력 신뢰도",
    "현재 입력으로 볼 수 있는 것과 부족한 것, 태어난 시간 확실성에 따른 해석 범위.",
    "## 명식 핵심 요약",
    "오행/기운/관계 결을 어려운 표처럼 늘어놓지 말고, 이 사람의 연애 성향으로 번역해서 설명. 목/화/토/금/수 중 어떤 기운이 강한 사람처럼 보이는지와 연애에서 어떻게 드러나는지.",
    "## 대운과 연애 흐름을 읽는 법",
    "대운이 무엇인지 쉬운 말로 설명하고, 큰 흐름이 좋을 때와 애매할 때 각각 어떻게 행동해야 하는지 구체적으로. '운이 들어온다'를 기다리는 말이 아니라 선택과 행동의 가이드로 풀기.",
    "## 개인 패턴 적중 포인트",
    "입력된 반복 패턴, 연락 스타일, 불안해지는 순간, 상대에게 자주 듣는 말을 근거로 '왜 이 사람이 이 지점에서 흔들리는지'를 짚고, 바로 고칠 수 있는 행동을 제안.",
    "## 연애할 때 드러나는 결",
    "표현 방식, 감정 속도, 호감이 생기는 방식, 관계에서 안정감을 느끼는 조건.",
    "## 반복되는 연애 패턴",
    "자주 빠지는 패턴, 끊기기 쉬운 지점, 상대가 오해할 수 있는 부분을 현실 예시로.",
    "## 끌리는 사람 vs 오래 맞는 사람",
    "순간적으로 끌리는 상대와 실제로 오래 가는 상대를 구분해서 설명.",
    "## 지금 연애 흐름의 맥",
    "현재 상태 기준으로 소개팅/썸/재회/새 만남 중 무엇이 유리한지와 이유.",
    "## 소개팅에서 바로 써먹는 처방",
    "첫 문장, 첫 만남 장소, 답장 속도, 피해야 할 대화 소재를 입력 정보에 맞춰 구체적으로.",
    "## 잘 맞는 인상과 분위기",
    "외모 단정 없이 눈빛, 미소, 말투, 스타일, 첫 만남 분위기를 구체적으로 설명.",
    "## 상대 정보로 짚는 궁합 포인트",
    "상대 정보가 있으면 궁합 포인트를, 없으면 나중에 확인하면 좋은 항목을 안내.",
    "## 7일 행동 가이드",
    "오늘 할 일, 이번 주 할 일, 피해야 할 행동을 각각 구체적으로.",
    "## 현실 행동 가이드",
    "첫 연락, 첫 만남, 자기소개 문장, 피해야 할 행동, 다음 7일 안에 할 일을 구체적으로.",
    "## 참고 안내",
    "재미와 자기 이해를 위한 참고용이며 실제 선택은 본인 판단이 중요하다는 안내.",
  ].join("\n");
}

function textOrFallback(value: unknown, fallback = "미입력") {
  const text = cleanText(value, 900);
  return text || fallback;
}

function buildConcernEvidence(row: LoveFortuneRow) {
  return textOrFallback(row.concern)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function buildIdealFaceProfileV2(row: LoveFortuneRow) {
  const seed = seedFromReading(row);
  const eye = pick(seed + 1, [
    "시선이 오래 머물러도 부담스럽지 않은 차분한 눈매",
    "웃을 때 경계심을 자연스럽게 풀어주는 선한 눈매",
    "말을 듣고 있다는 느낌을 주는 집중력 있는 눈빛",
    "처음에는 담백하지만 가까워질수록 따뜻함이 보이는 눈매",
  ]);
  const smile = pick(seed + 3, [
    "장난기보다 안정감이 먼저 느껴지는 미소",
    "처음 만난 긴장을 자연스럽게 낮춰주는 부드러운 미소",
    "말보다 배려가 먼저 보이는 담백한 미소",
    "과하지 않지만 오래 기억에 남는 온도감 있는 미소",
  ]);
  const mood = pick(seed + 5, [
    "급하게 밀고 들어오기보다 관계의 속도를 맞춰주는 분위기",
    "자기 세계가 있으면서도 상대를 편하게 바라보는 분위기",
    "차분하지만 가까워질수록 장난기가 살아나는 분위기",
    "꾸밈보다 진정성이 먼저 보여 신뢰가 쌓이는 분위기",
  ]);
  const style = pick(seed + 7, [
    "깔끔한 기본 스타일과 절제된 색감",
    "운동 전후에도 자연스럽게 어울리는 캐주얼한 스타일",
    "부드러운 색감과 정돈된 실루엣",
    "자기 관리가 보이지만 과하게 꾸미지 않은 스타일",
  ]);
  const firstDate = pick(seed + 9, [
    "카페나 산책처럼 대화가 길어져도 부담 없는 자리",
    "짧게 만나도 텐션보다 편안함을 먼저 확인할 수 있는 자리",
    "처음부터 강한 이벤트보다 서로의 리듬을 보는 자리",
    "말을 많이 하기보다 태도와 약속을 확인할 수 있는 자리",
  ]);
  const avoid = pick(seed + 11, [
    "초반부터 감정 기복을 크게 드러내는 사람",
    "대화보다 평가가 앞서고 상대를 시험하는 태도",
    "연락 속도는 빠르지만 약속과 책임감이 흐린 사람",
    "처음부터 확답을 강요하거나 관계를 몰아붙이는 분위기",
  ]);
  const prompt = [
    "simple warm ink sketch of an ideal romantic partner, Korean editorial fortune report style",
    mood,
    eye,
    smile,
    style,
    "soft ivory background, elegant line art, respectful, not photorealistic",
  ].join(", ");

  return {
    title: "나와 잘 맞는 인상 미리보기",
    eye,
    smile,
    mood,
    style,
    firstDate,
    avoid,
    note: "실제 외모를 단정하는 기능이 아니라, 입력된 연애 성향과 사주 흐름에 맞는 분위기를 참고 카드처럼 정리한 내용입니다.",
    prompt,
  };
}

function buildPromptV2(row: LoveFortuneRow) {
  const ideal = buildIdealFaceProfileV2(row);
  const concernEvidence = buildConcernEvidence(row);
  const birthTimeCertainty = textOrFallback(row.birth_time_certainty);
  const inputSummary = [
    `생년월일: ${textOrFallback(row.birth_date)}`,
    `달력: ${textOrFallback(row.calendar_type)}`,
    `태어난 시간: ${textOrFallback(row.birth_time)}`,
    `시간 확실도: ${birthTimeCertainty}`,
    `출생 지역: ${textOrFallback(row.birth_place)}`,
    `성별: ${textOrFallback(row.gender)}`,
    `현재 연애 상태: ${textOrFallback(row.love_state)}`,
    `연애 목표: ${textOrFallback(row.relationship_goal)}`,
    `선호 만남 방식: ${textOrFallback(row.meeting_preference)}`,
    `가장 궁금한 주제: ${textOrFallback(row.focus)}`,
    `상세 고민: ${textOrFallback(row.concern)}`,
    `상대 생년월일: ${textOrFallback(row.partner_birth_date)}`,
    `상대 태어난 시간: ${textOrFallback(row.partner_birth_time)}`,
    `상대와의 관계: ${textOrFallback(row.partner_relation)}`,
  ];

  return [
    "당신은 연애와 사랑 문제만 오래 상담해온 한국식 명리 상담가입니다.",
    "이 결과는 결제 후 보여주는 유료 리포트입니다. 사용자가 '그냥 GPT가 쓴 말'이 아니라 '내 상황을 보고 짚었다'고 느껴야 합니다.",
    "사주를 전혀 모르는 사람도 술술 읽히게 쓰되, 명리의 뼈대는 분명히 보여주세요. 전문 용어는 반드시 쉬운 말로 번역하고, 그 용어가 연애에서 어떻게 나타나는지 연결하세요.",
    "",
    "[품질 기준]",
    "- 결과는 사랑/연애 전문 리포트입니다. 재물운, 직업운, 건강운으로 새지 마세요.",
    "- 일반론 금지: '소통하세요', '기회를 잡으세요', '마음을 열어보세요'처럼 누구에게나 맞는 문장만 쓰면 실패입니다.",
    "- 모든 큰 섹션에는 입력 정보 중 최소 1개를 근거로 직접 언급하세요. 현재 연애 상태, 목표, 만남 방식, 고민, 상대 정보가 있으면 반드시 활용하세요.",
    "- 사주 용어는 일간, 일지, 오행, 십성, 대운, 세운, 시주, 배우자궁, 식상/관성/재성 같은 표현을 사용하되, 정확한 만세력 계산값을 단정하지 말고 '입력된 생년월일과 시간 조건으로 읽으면'처럼 상담식으로 표현하세요.",
    "- 사용자의 태어난 시간이 모르거나 불확실하면, 시간 기둥으로 단정하지 말고 성향/관계 패턴 중심으로 읽고 한계를 정직하게 말하세요.",
    "- 듣기 좋은 말만 하지 말고, 연애에서 반복될 수 있는 약점과 상대가 답답해할 지점도 부드럽게 짚으세요.",
    "- 추상적인 조언 뒤에는 반드시 실제 행동 예시를 붙이세요. 예: 첫 메시지 문장, 첫 만남 장소, 대화 주제, 연락 텀, 피해야 할 말투.",
    "- 전체 길이는 4,000자 이상으로 충분히 깊게 쓰세요. 모바일에서 읽기 쉽도록 문단은 짧게 나누세요.",
    "- 결과 안에 'AI', '알고리즘', '데이터상'이라는 표현을 쓰지 마세요.",
    "- 운명 확정, 질병, 결혼 보장, 임신, 외모 단정, 상대 마음 단정은 금지입니다. 대신 가능성과 선택 가이드로 말하세요.",
    "",
    "[개인화 체크리스트]",
    "- 사용자가 결제한 보람을 느끼도록 '한눈에 보는 요약', '왜 그렇게 보는지', '내가 바로 바꿀 행동'을 모두 제공합니다.",
    "- 사용자의 고민 문장에 들어 있는 표현을 4회 이상 자연스럽게 재사용하세요.",
    "- 이 사람에게만 해당하는 듯한 문장을 최소 12개 이상 넣으세요.",
    "- 잘 맞는 사람의 얼굴상이 아니라 '분위기, 눈빛, 말투, 첫 만남에서 느껴지는 결'로 묘사하세요.",
    "",
    "[사용자 입력]",
    ...inputSummary,
    "",
    "[고민에서 뽑은 핵심 단서]",
    ...(concernEvidence.length ? concernEvidence.map((line) => `- ${line}`) : ["- 상세 고민이 적지 않아 기본 입력값 중심으로 해석합니다."]),
    "",
    "[잘 맞는 인상 카드 참고]",
    `분위기: ${ideal.mood}`,
    `눈매: ${ideal.eye}`,
    `미소: ${ideal.smile}`,
    `스타일: ${ideal.style}`,
    `첫 만남: ${ideal.firstDate}`,
    `피하면 좋은 결: ${ideal.avoid}`,
    "",
    "[반드시 이 출력 형식을 지키세요]",
    "## 1. 한눈에 보는 연애 명식",
    "연애운 점수, 관계 안정감, 끌림의 강도, 표현력, 오래 갈 가능성, 지금 필요한 태도를 카드처럼 요약하세요. 각 점수 옆에는 왜 그렇게 보는지 1문장씩 붙이세요.",
    "## 2. 입력 신뢰도와 해석 범위",
    "생년월일, 시간 확실도, 상대 정보 유무를 근거로 어디까지 강하게 말할 수 있고 어디부터는 경향으로 봐야 하는지 설명하세요.",
    "## 3. 내 연애의 중심 기질",
    "일간/오행/배우자궁을 쉬운 말로 풀어, 이 사람이 사랑 앞에서 어떤 속도로 열리고 어떤 순간에 방어적인지 설명하세요.",
    "## 4. 끌리는 사람과 오래 맞는 사람",
    "순간적으로 끌리는 유형과 실제로 오래 안정되는 유형을 분리해서 설명하세요. 사용자가 헷갈릴 만한 지점을 콕 짚으세요.",
    "## 5. 반복되는 연애 패턴",
    "고민과 현재 상태를 바탕으로 반복 패턴을 3가지로 정리하세요. 각각 '겉으로 보이는 모습', '속마음', '상대가 받는 느낌', '바꾸는 방법'을 넣으세요.",
    "## 6. 지금 연애운의 흐름",
    "대운/세운을 쉬운 비유로 설명하고, 지금은 기다릴 때인지, 소개팅/새 만남을 넓힐 때인지, 기존 관계를 정리하거나 조율할 때인지 말하세요.",
    "## 7. 소개팅과 첫 만남 처방",
    "첫 메시지 2개, 피해야 할 첫 메시지 2개, 좋은 장소, 대화 주제, 연락 텀을 구체적으로 제안하세요.",
    "## 8. 나와 잘 맞는 인상과 분위기",
    "외모 단정 없이 눈빛, 말투, 옷차림, 에너지, 첫 데이트 분위기를 묘사하세요. 왜 그 결이 이 사람에게 맞는지도 설명하세요.",
    "## 9. 상대 정보가 있을 때 보는 궁합 포인트",
    "상대 정보가 있으면 궁합의 긴장점/편한점/확인할 질문을 쓰고, 없으면 앞으로 상대를 볼 때 확인해야 할 질문 5개를 제안하세요.",
    "## 10. 절대 피해야 할 연애 선택",
    "이 사람에게 특히 손해가 되는 선택 3가지를 현실 예시와 함께 적으세요.",
    "## 11. 다음 7일 행동 가이드",
    "오늘, 3일 안, 7일 안으로 나눠 실제로 할 일을 제안하세요.",
    "## 12. 결제 리포트 핵심 정리",
    "마지막에는 '당신이 오늘 가져가야 할 한 문장'과 '이번 달 연애 행동 원칙 3개'를 정리하세요.",
    "## 참고 안내",
    "사주는 자기 이해를 돕는 참고용이며 실제 관계는 본인의 선택과 상대와의 상호작용에 따라 달라진다고 안내하세요.",
  ].join("\n");
}

function extractGeminiText(payload: unknown) {
  const data = payload as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  return data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).map((part) => part.text ?? "").join("\n").trim() ?? "";
}

function serialize(row: LoveFortuneRow) {
  const idealFace = row.ideal_face_profile && Object.keys(row.ideal_face_profile).length > 0
    ? row.ideal_face_profile
    : buildIdealFaceProfileV2(row);

  return {
    id: row.id,
    status: row.status,
    calendarType: row.calendar_type,
    birthDate: row.birth_date,
    birthTime: row.birth_time,
    birthTimeCertainty: row.birth_time_certainty,
    birthPlace: row.birth_place,
    gender: row.gender,
    loveState: row.love_state,
    relationshipGoal: row.relationship_goal,
    meetingPreference: row.meeting_preference,
    focus: row.focus,
    concern: row.concern,
    partnerBirthDate: row.partner_birth_date,
    partnerBirthTime: row.partner_birth_time,
    partnerRelation: row.partner_relation,
    amount: row.amount,
    aiModel: row.ai_model,
    aiResult: row.ai_result,
    idealFace,
    idealFacePrompt: row.ideal_face_prompt,
    idealFaceImageUrl: row.ideal_face_image_url,
    paidAt: row.paid_at,
    generatedAt: row.generated_at,
    createdAt: row.created_at,
  };
}

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  try {
    const { user } = await getRequestAuthContext(req);
    if (!user) {
      return json(401, { ok: false, requestId, message: "로그인이 필요합니다." });
    }

    if (!isAllowedAdminUser(user.id, user.email)) {
      return json(403, { ok: false, requestId, message: "연애운 상세 분석은 현재 관리자 테스트 중입니다." });
    }

    const admin = createAdminClient();
    const res = await admin
      .from("love_fortune_readings")
      .select(LOVE_FORTUNE_SELECT)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (res.error) {
      console.error(`[mypage-love-fortune] ${requestId} read failed`, res.error);
      return json(500, { ok: false, requestId, message: "연애운 내역을 불러오지 못했습니다." });
    }

    return json(200, {
      ok: true,
      requestId,
      readings: ((res.data ?? []) as LoveFortuneRow[]).map(serialize),
    });
  } catch (error) {
    console.error(`[mypage-love-fortune] ${requestId} unhandled`, error);
    return json(500, { ok: false, requestId, message: "서버 오류가 발생했습니다." });
  }
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  try {
    const { user } = await getRequestAuthContext(req);
    if (!user) {
      return json(401, { ok: false, requestId, message: "로그인이 필요합니다." });
    }

    if (!isAllowedAdminUser(user.id, user.email)) {
      return json(403, { ok: false, requestId, message: "연애운 상세 분석은 현재 관리자 테스트 중입니다." });
    }

    const body = (await req.json().catch(() => ({}))) as { readingId?: unknown };
    const readingId = cleanText(body.readingId, 80);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(readingId)) {
      return json(400, { ok: false, requestId, message: "연애운 내역을 찾지 못했습니다." });
    }

    const admin = createAdminClient();
    const readRes = await admin
      .from("love_fortune_readings")
      .select(LOVE_FORTUNE_SELECT)
      .eq("id", readingId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (readRes.error) {
      console.error(`[mypage-love-fortune] ${requestId} read one failed`, readRes.error);
      return json(500, { ok: false, requestId, message: "연애운 내역을 확인하지 못했습니다." });
    }

    const row = readRes.data as LoveFortuneRow | null;
    if (!row) {
      return json(404, { ok: false, requestId, message: "연애운 내역을 찾지 못했습니다." });
    }

    if (!["paid", "generated"].includes(row.status)) {
      return json(400, { ok: false, requestId, message: "결제 완료 후 상세 분석을 생성할 수 있습니다." });
    }

    if (row.ai_result) {
      const idealFace = buildIdealFaceProfileV2(row);
      return json(200, { ok: true, requestId, reading: serialize({ ...row, ideal_face_profile: row.ideal_face_profile ?? idealFace }) });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return json(500, { ok: false, requestId, message: "상세 풀이 설정이 아직 완료되지 않았습니다." });
    }

    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
    const prompt = buildPromptV2(row);
    const idealFace = buildIdealFaceProfileV2(row);
    const res = await fetch(`${GEMINI_API_URL}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.72,
          topP: 0.9,
          maxOutputTokens: 6500,
        },
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[mypage-love-fortune] ${requestId} gemini failed`, { status: res.status, data });
      return json(502, { ok: false, requestId, message: "연애운 상세 풀이 생성에 실패했습니다. 잠시 후 다시 시도해 주세요." });
    }

    const text = extractGeminiText(data);
    if (!text) {
      return json(502, { ok: false, requestId, message: "연애운 상세 풀이 응답이 비어 있습니다. 잠시 후 다시 시도해 주세요." });
    }

    const updateRes = await admin
      .from("love_fortune_readings")
      .update({
        status: "generated",
        ai_model: model,
        ai_result: text,
        ideal_face_profile: idealFace,
        ideal_face_prompt: idealFace.prompt,
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("user_id", user.id)
      .select(LOVE_FORTUNE_SELECT)
      .single();

    if (updateRes.error) {
      console.error(`[mypage-love-fortune] ${requestId} update failed`, updateRes.error);
      return json(500, { ok: false, requestId, message: "연애운 결과 저장에 실패했습니다." });
    }

    return json(200, { ok: true, requestId, reading: serialize(updateRes.data as LoveFortuneRow) });
  } catch (error) {
    console.error(`[mypage-love-fortune] ${requestId} generate unhandled`, error);
    return json(500, { ok: false, requestId, message: "서버 오류가 발생했습니다." });
  }
}
