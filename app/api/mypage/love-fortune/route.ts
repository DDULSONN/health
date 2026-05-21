import { after, NextResponse } from "next/server";
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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOVE_FORTUNE_SELECT =
  "id,user_id,status,calendar_type,birth_date,birth_time,birth_time_certainty,birth_place,gender,love_state,relationship_goal,meeting_preference,focus,concern,partner_birth_date,partner_birth_time,partner_relation,amount,ai_model,ai_result,ideal_face_profile,ideal_face_prompt,ideal_face_image_url,paid_at,generated_at,created_at";

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function textOrFallback(value: unknown, fallback = "미입력") {
  const text = cleanText(value, 900);
  return text || fallback;
}

function seedFromReading(
  row: Pick<
    LoveFortuneRow,
    "birth_date" | "birth_time" | "love_state" | "relationship_goal" | "meeting_preference" | "focus" | "concern"
  >
) {
  return [
    row.birth_date,
    row.birth_time,
    row.love_state ?? "",
    row.relationship_goal ?? "",
    row.meeting_preference ?? "",
    row.focus ?? "",
    row.concern ?? "",
  ].join("|").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function pick<T>(seed: number, values: T[]) {
  return values[Math.abs(seed) % values.length];
}

function readableBirthTime(value: string | null) {
  const map: Record<string, string> = {
    unknown: "모름",
    ja: "자시(23-1시)",
    chuk: "축시(1-3시)",
    in: "인시(3-5시)",
    myo: "묘시(5-7시)",
    jin: "진시(7-9시)",
    sa: "사시(9-11시)",
    oh: "오시(11-13시)",
    mi: "미시(13-15시)",
    sin: "신시(15-17시)",
    yu: "유시(17-19시)",
    sul: "술시(19-21시)",
    hae: "해시(21-23시)",
  };
  return map[value ?? ""] ?? textOrFallback(value);
}

function readableCertainty(value: string | null) {
  const map: Record<string, string> = {
    exact: "태어난 시간을 선택함",
    about: "태어난 시간이 대략적임",
    unknown: "태어난 시간을 모름",
  };
  return map[value ?? ""] ?? textOrFallback(value);
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
    "차분하고 오래 마주 봐도 부담스럽지 않은 눈매",
    "웃을 때 경계심을 자연스럽게 내려주는 선한 눈빛",
    "말을 흘려듣지 않고 집중해 주는 또렷한 눈매",
    "처음에는 담백하지만 가까워질수록 온기가 보이는 눈매",
  ]);
  const smile = pick(seed + 3, [
    "장난기보다 안정감이 먼저 느껴지는 미소",
    "처음 만난 긴장을 자연스럽게 풀어주는 부드러운 미소",
    "말보다 배려가 먼저 보이는 담백한 미소",
    "과하지 않지만 오래 기억에 남는 온도 있는 미소",
  ]);
  const mood = pick(seed + 5, [
    "급하게 다가오기보다 관계의 속도를 맞춰주는 분위기",
    "자기 경계가 있으면서도 상대를 편하게 바라보는 분위기",
    "차분하지만 가까워질수록 장난기가 살아나는 분위기",
    "겉멋보다 진정성이 먼저 보여 신뢰가 쌓이는 분위기",
  ]);
  const style = pick(seed + 7, [
    "깔끔한 기본 스타일과 절제된 색감",
    "편한 자리에도 자연스럽게 어울리는 캐주얼한 스타일",
    "부드러운 색감과 정돈된 실루엣",
    "자기 관리가 보이지만 과하게 꾸미지 않은 스타일",
  ]);
  const firstDate = pick(seed + 9, [
    "카페에서 대화가 길어져도 부담 없는 자리",
    "조용한 만남에서 텐션보다 편안함을 먼저 확인할 수 있는 자리",
    "처음부터 강한 이벤트보다 서로의 리듬을 보는 자리",
    "말의 양보다 약속과 태도를 확인할 수 있는 자리",
  ]);
  const avoid = pick(seed + 11, [
    "초반부터 감정 기복을 크게 드러내는 흐름",
    "대화보다 평가가 앞서고 상대를 시험하는 태도",
    "연락 속도는 빠르지만 약속과 책임감이 약한 흐름",
    "처음부터 관계의 정답을 강요하거나 몰아붙이는 분위기",
  ]);
  const prompt = [
    "simple warm ink sketch of an ideal romantic partner, Korean saju fortune report style",
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
    note: "실제 외모를 단정하는 기능이 아니라, 입력된 연애 성향과 사주 상담 결과에 맞는 분위기를 참고 카드처럼 정리한 내용입니다.",
    prompt,
  };
}

function buildPromptV2(row: LoveFortuneRow) {
  const ideal = buildIdealFaceProfileV2(row);
  const concernEvidence = buildConcernEvidence(row);
  const inputSummary = [
    `생년월일: ${textOrFallback(row.birth_date)}`,
    `달력 기준: ${textOrFallback(row.calendar_type)}`,
    `태어난 시간: ${readableBirthTime(row.birth_time)}`,
    `시간 정보: ${readableCertainty(row.birth_time_certainty)}`,
    `태어난 지역: ${textOrFallback(row.birth_place)}`,
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
    "당신은 사랑과 연애 문제만 오래 상담해온 한국식 명리 상담가입니다.",
    "이 결과는 사용자가 결제 후 보는 유료 리포트입니다. 사용자가 '그냥 챗봇 답변'이 아니라 실제 사주집에서 내 이야기를 듣고 풀이받는 느낌을 받아야 합니다.",
    "",
    "[풀이 원칙]",
    "- 사랑, 연애, 관계 선택에만 집중하세요. 재물운, 직업운, 건강운은 연애 행동에 영향을 주는 범위에서만 짧게 언급하세요.",
    "- 정확한 만세력 계산값을 단정하지 마세요. 입력된 생년월일, 시간, 현재 상황을 바탕으로 상담식 명리 해석으로 표현하세요.",
    "- 일간, 일지, 오행, 십성, 대운, 세운, 시주, 배우자궁 같은 명리 용어를 쓰되, 바로 옆에 쉬운 풀이를 붙이세요.",
    "- 태어난 시간이 모름이면 시주 단정은 금지하고, 성향과 관계 패턴 중심으로 풀이하세요.",
    "- 좋은 말만 하지 말고 연애에서 반복되는 약점, 상대가 답답해할 지점, 바꿔야 할 행동을 구체적으로 짚으세요.",
    "- 모든 큰 섹션에는 입력 정보나 고민을 근거로 끌어와 개인 상담처럼 쓰세요.",
    "- '대화를 많이 하세요' 같은 당연한 조언으로 끝내지 말고, 첫 연락 문장, 첫 만남 장소, 연락 텀, 피해야 할 말투까지 현실 예시를 주세요.",
    "- 퍼센트 점수, MBTI식 유형명, AI, 알고리즘, 데이터상이라는 표현은 쓰지 마세요.",
    "- 굵게 표시용 마크다운 기호(**텍스트**)나 불릿 별표(*)를 쓰지 마세요. 제목은 ## 제목 형식만 사용하세요.",
    "- 운명 확정, 결혼 보장, 상대 마음 단정, 외모 단정은 금지입니다.",
    "- 전체는 4,000자 이상으로 깊게 쓰되, 모바일에서 읽기 쉽게 짧은 문단으로 나누세요.",
    "",
    "[사용자 입력]",
    ...inputSummary,
    "",
    "[고민에서 뽑은 핵심 단서]",
    ...(concernEvidence.length ? concernEvidence.map((line) => `- ${line}`) : ["- 상세 고민이 적지 않아 기본 입력값 중심으로 풀이합니다."]),
    "",
    "[나와 잘 맞는 인상 카드 참고]",
    `분위기: ${ideal.mood}`,
    `눈빛: ${ideal.eye}`,
    `미소: ${ideal.smile}`,
    `스타일: ${ideal.style}`,
    `첫 만남: ${ideal.firstDate}`,
    `피하면 좋은 흐름: ${ideal.avoid}`,
    "",
    "[반드시 아래 제목으로 출력]",
    "## 1. 풀이 기준과 명식 골격",
    "연주, 월주, 일주, 시주를 상담용 골격으로 정리하고 일간, 일지, 배우자궁, 시주의 역할을 쉬운 말로 설명하세요.",
    "## 2. 오행 분포와 사랑에서 드러나는 결",
    "목/화/토/금/수 중 어떤 기운이 연애에서 강하게 느껴지는지, 과한 기운과 부족한 기운이 표현 방식, 불안, 선택 기준에 어떻게 나타나는지 풀어주세요.",
    "## 3. 내 연애의 중심 기질",
    "사주 용어와 쉬운 해설을 엮어 사랑 앞에서 열리는 속도, 방어 방식, 안정감을 느끼는 조건을 설명하세요.",
    "## 4. 도화와 배우자궁으로 보는 끌림",
    "도화, 홍염, 천희 같은 연애성 기운을 무리하게 단정하지 말고 상담식으로 설명하세요. 왜 특정 분위기의 사람에게 끌리는지, 왜 오래 맞는 사람은 따로 있는지 짚으세요.",
    "## 5. 끌리는 사람과 오래 맞는 사람",
    "순간적으로 끌리는 유형과 실제로 오래 안정되는 유형을 분리해서 설명하세요.",
    "## 6. 반복되는 연애 패턴",
    "겉모습, 속마음, 상대가 받는 느낌, 바꾸는 방법으로 나누어 3개 이상 적으세요.",
    "## 7. 대운과 세운으로 보는 지금의 흐름",
    "대운과 세운을 쉬운 말로 풀어 지금은 기다릴 때인지, 새 만남을 열 때인지, 기존 관계를 정리하거나 조율할 때인지 설명하세요.",
    "## 8. 첫 만남과 연락 처방",
    "첫 메시지, 피해야 할 첫 메시지, 좋은 장소, 대화 주제, 연락 텀을 구체적으로 제안하세요.",
    "## 9. 나와 잘 맞는 인상과 분위기",
    "외모 단정 없이 눈빛, 말투, 분위기, 스타일, 첫 데이트 결을 묘사하고 왜 그 결이 이 사람에게 맞는지 설명하세요.",
    "## 10. 궁합 확인 질문",
    "상대 정보가 있으면 궁합 포인트를, 없으면 앞으로 확인해야 할 질문 5개를 제안하세요.",
    "## 11. 절대 피해야 할 연애 선택",
    "이 사람에게 특히 손해가 되는 선택 3가지를 현실 예시와 함께 적으세요.",
    "## 12. 다음 7일 행동 가이드",
    "오늘, 3일 안, 7일 안으로 나누어 실제 행동을 제안하세요.",
    "## 13. 결제 리포트 핵심 정리",
    "마지막에 '당신이 오늘 가져갈 한 문장'과 '이번 주 연애 행동 원칙 3개'를 정리하세요.",
    "## 참고 안내",
    "사주는 자기 이해를 돕는 참고용이며 실제 관계는 본인의 선택과 상호작용에 따라 달라진다고 안내하세요.",
  ].join("\n");
}

function extractGeminiText(payload: unknown) {
  const data = payload as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  return data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).map((part) => part.text ?? "").join("\n").trim() ?? "";
}

function cleanGeneratedReport(text: string) {
  return text
    .replace(/```/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
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

async function generateAndSaveReading(row: LoveFortuneRow, requestId: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY_MISSING");

  const admin = createAdminClient();
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
    throw new Error("GEMINI_GENERATION_FAILED");
  }

  const text = cleanGeneratedReport(extractGeminiText(data));
  if (!text) throw new Error("GEMINI_EMPTY_RESPONSE");

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
    .eq("user_id", row.user_id)
    .is("ai_result", null)
    .select("id")
    .maybeSingle();

  if (updateRes.error) {
    console.error(`[mypage-love-fortune] ${requestId} update failed`, updateRes.error);
    throw updateRes.error;
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
    if (!UUID_RE.test(readingId)) {
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
      return json(500, { ok: false, requestId, message: "상세 분석 설정이 아직 완료되지 않았습니다." });
    }

    const preparedIdealFace = buildIdealFaceProfileV2(row);
    const preparedRes = await admin
      .from("love_fortune_readings")
      .update({
        ideal_face_profile: preparedIdealFace,
        ideal_face_prompt: preparedIdealFace.prompt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("user_id", user.id)
      .select(LOVE_FORTUNE_SELECT)
      .maybeSingle();

    if (preparedRes.error) {
      console.error(`[mypage-love-fortune] ${requestId} prepare failed`, preparedRes.error);
      return json(500, { ok: false, requestId, message: "연애운 결과 준비에 실패했습니다." });
    }

    const preparedRow = (preparedRes.data as LoveFortuneRow | null) ?? {
      ...row,
      ideal_face_profile: preparedIdealFace,
      ideal_face_prompt: preparedIdealFace.prompt,
    };

    after(async () => {
      try {
        await generateAndSaveReading(preparedRow, requestId);
      } catch (error) {
        console.error(`[mypage-love-fortune] ${requestId} background generation failed`, error);
      }
    });

    return json(202, { ok: true, requestId, generating: true, reading: serialize(preparedRow) });

    /*
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

    const text = cleanGeneratedReport(extractGeminiText(data));
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
    */
  } catch (error) {
    console.error(`[mypage-love-fortune] ${requestId} generate unhandled`, error);
    return json(500, { ok: false, requestId, message: "서버 오류가 발생했습니다." });
  }
}
