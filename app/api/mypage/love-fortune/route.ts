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
    "- 'AI', '알고리즘', '데이터상' 같은 표현은 절대 쓰지 마세요.",
    "- 듣기 좋은 말만 하지 말고, 반복될 수 있는 연애 약점과 조심할 점도 부드럽게 짚으세요.",
    "- 각 섹션은 2~5문장으로, 모바일에서 읽기 쉽게 문단을 짧게 나누세요.",
    "- 마지막에는 짐툴에서 바로 할 수 있는 행동을 자연스럽게 제안하세요.",
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
    "상담자가 첫마디로 짚어주는 듯한 결과 전체의 한 문장.",
    "## 입력 신뢰도",
    "현재 입력으로 볼 수 있는 것과 부족한 것, 태어난 시간 확실성에 따른 해석 범위.",
    "## 연애할 때 드러나는 결",
    "표현 방식, 감정 속도, 호감이 생기는 방식, 관계에서 안정감을 느끼는 조건.",
    "## 끌리는 사람 vs 오래 맞는 사람",
    "순간적으로 끌리는 상대와 실제로 오래 가는 상대를 구분해서 설명.",
    "## 지금 연애 흐름의 맥",
    "현재 상태 기준으로 소개팅/썸/재회/새 만남 중 무엇이 유리한지와 이유.",
    "## 잘 맞는 인상과 분위기",
    "외모 단정 없이 눈빛, 미소, 말투, 스타일, 첫 만남 분위기를 구체적으로 설명.",
    "## 상대 정보로 짚는 궁합 포인트",
    "상대 정보가 있으면 궁합 포인트를, 없으면 나중에 확인하면 좋은 항목을 안내.",
    "## 7일 행동 가이드",
    "오늘 할 일, 이번 주 할 일, 피해야 할 행동을 각각 구체적으로.",
    "## 짐툴 활용 추천",
    "오픈카드, 빠른매칭, 1:1 매칭 중 어떤 방식이 맞는지와 프로필 문구 방향.",
    "## 참고 안내",
    "재미와 자기 이해를 위한 참고용이며 실제 선택은 본인 판단이 중요하다는 안내.",
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
    : buildIdealFaceProfile(row);

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
      const idealFace = buildIdealFaceProfile(row);
      return json(200, { ok: true, requestId, reading: serialize({ ...row, ideal_face_profile: row.ideal_face_profile ?? idealFace }) });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return json(500, { ok: false, requestId, message: "상세 풀이 설정이 아직 완료되지 않았습니다." });
    }

    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
    const prompt = buildPrompt(row);
    const idealFace = buildIdealFaceProfile(row);
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
          maxOutputTokens: 2600,
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
