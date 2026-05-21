import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";

type LoveFortuneGenerateBody = {
  readingId?: string;
  birthDate?: string;
  birthTime?: string;
  birthTimeCertainty?: string;
  birthPlace?: string;
  calendarType?: string;
  gender?: string;
  loveState?: string;
  relationshipGoal?: string;
  meetingPreference?: string;
  focus?: string;
  concern?: string;
  partnerBirthDate?: string;
  partnerBirthTime?: string;
  partnerRelation?: string;
};

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function textOrFallback(value: unknown, fallback = "미입력") {
  const text = cleanText(value, 900);
  return text || fallback;
}

function readableBirthTime(value: string) {
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
  return map[value] ?? textOrFallback(value);
}

function readableCertainty(value: string) {
  const map: Record<string, string> = {
    exact: "태어난 시간을 선택함",
    about: "태어난 시간이 대략적임",
    unknown: "태어난 시간을 모름",
  };
  return map[value] ?? textOrFallback(value);
}

function buildPromptV2(body: LoveFortuneGenerateBody) {
  const birthDate = cleanText(body.birthDate, 20);
  const birthTime = cleanText(body.birthTime, 30);
  const birthTimeCertainty = cleanText(body.birthTimeCertainty, 30);
  const birthPlace = cleanText(body.birthPlace, 80);
  const calendarType = cleanText(body.calendarType, 30);
  const gender = cleanText(body.gender, 20);
  const loveState = cleanText(body.loveState, 80);
  const relationshipGoal = cleanText(body.relationshipGoal, 100);
  const meetingPreference = cleanText(body.meetingPreference, 100);
  const focus = cleanText(body.focus, 100);
  const concern = cleanText(body.concern, 900);
  const partnerBirthDate = cleanText(body.partnerBirthDate, 20);
  const partnerBirthTime = cleanText(body.partnerBirthTime, 30);
  const partnerRelation = cleanText(body.partnerRelation, 80);
  const concernLines = textOrFallback(concern)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);

  return [
    "당신은 사랑과 연애 상담에 특화된 한국식 명리 상담가입니다.",
    "관리자 테스트용 생성이지만 실제 유료 리포트에 준하는 품질로 작성하세요. 사용자가 결제해도 아깝지 않다고 느낄 만큼 개인화와 구체성을 보여주세요.",
    "",
    "[상담 원칙]",
    "- 사랑/연애 전문으로만 답하세요. 재물운, 직업운, 건강운은 연애 행동에 영향을 주는 범위에서만 짧게 언급하세요.",
    "- 일반론 금지. 모든 큰 섹션에는 생년월일, 태어난 시간, 현재 연애 상태, 연애 목표, 만남 방식, 고민 중 최소 1개를 근거로 사용하세요.",
    "- 사주 용어는 일간, 일지, 오행, 십성, 대운, 세운, 시주, 배우자궁 같은 말로 전문성을 주되 바로 옆에 쉬운 뜻을 붙이세요.",
    "- 정확한 만세력 계산값을 단정하지 말고, 입력값 기반 상담식 해석으로 표현하세요.",
    "- 좋은 말만 하지 말고 연애에서 반복되는 약점, 상대가 답답해할 지점, 바꿔야 할 행동을 구체적으로 말하세요.",
    "- 첫 연락, 첫 만남, 대화 주제, 연락 텀, 피해야 할 말투처럼 바로 쓸 수 있는 예시를 반드시 넣으세요.",
    "- 결과는 3,500자 이상, 모바일에서 읽기 쉽게 짧은 문단으로 작성하세요.",
    "- AI, 알고리즘, 데이터상이라는 표현은 쓰지 마세요.",
    "- 운명 확정, 결혼 보장, 상대 마음 단정, 외모 단정은 금지입니다.",
    "- 퍼센트 점수, MBTI식 유형명, 카드뉴스식 얕은 요약은 쓰지 마세요. 사주집에서 종이에 풀어주는 느낌으로 쓰세요.",
    "- 굵게 표시용 마크다운 기호(**텍스트**)나 불릿 별표(*)를 쓰지 마세요. 제목은 ## 제목 형식만 사용하세요.",
    "",
    "[입력 정보]",
    `생년월일: ${birthDate || "미입력"}`,
    `달력 기준: ${calendarType || "미입력"}`,
    `태어난 시간: ${readableBirthTime(birthTime)}`,
    `시간 정보: ${readableCertainty(birthTimeCertainty)}`,
    `태어난 지역: ${birthPlace || "미입력"}`,
    `성별: ${gender || "미입력"}`,
    `현재 연애 상태: ${loveState || "미입력"}`,
    `연애 목표: ${relationshipGoal || "미입력"}`,
    `선호 만남 방식: ${meetingPreference || "미입력"}`,
    `가장 궁금한 주제: ${focus || "미입력"}`,
    `상세 고민: ${concern || "미입력"}`,
    `상대 생년월일: ${partnerBirthDate || "미입력"}`,
    `상대 태어난 시간: ${partnerBirthTime || "미입력"}`,
    `상대와의 관계: ${partnerRelation || "미입력"}`,
    "",
    "[고민 단서]",
    ...(concernLines.length ? concernLines.map((line) => `- ${line}`) : ["- 상세 고민이 적지 않아 기본 입력값 중심으로 풀이합니다."]),
    "",
    "[출력 형식]",
    "## 1. 풀이 기준과 명식 골격",
    "연주, 월주, 일주, 시주를 상담용 골격으로 정리하고 일간, 일지, 배우자궁, 시주의 역할을 쉬운 말로 설명하세요.",
    "## 2. 오행 분포와 사랑에서 드러나는 결",
    "목/화/토/금/수 중 어떤 기운이 연애에서 강하게 느껴지는지 설명하고, 과한 기운과 부족한 기운이 표현 방식, 불안, 선택 기준에 어떻게 나타나는지 풀어주세요.",
    "## 3. 내 연애의 중심 기질",
    "사주 용어와 쉬운 해설을 함께 사용해 사랑 앞에서 열리는 속도, 방어 방식, 안정감을 느끼는 조건을 설명하세요.",
    "## 4. 도화와 배우자궁으로 보는 끌림",
    "도화, 홍염, 천희 같은 연애성 기운을 무리하게 단정하지 말고 상담식으로 설명하세요. 왜 특정 분위기의 사람에게 끌리는지, 왜 오래 맞는 사람은 따로 있는지 짚으세요.",
    "## 5. 끌리는 사람과 오래 맞는 사람",
    "순간적으로 끌리는 유형과 오래 맞는 유형을 분리하세요.",
    "## 6. 반복되는 연애 패턴",
    "겉모습, 속마음, 상대가 받는 느낌, 바꾸는 방법으로 나누어 3개 이상 적으세요.",
    "## 7. 대운과 세운으로 보는 지금의 흐름",
    "대운/세운을 쉬운 말로 풀어 지금은 어떤 선택이 유리한지 설명하세요.",
    "## 8. 첫 만남과 연락 처방",
    "첫 메시지, 첫 만남 장소, 대화 주제, 연락 텀, 피해야 할 말투를 구체적으로 제안하세요.",
    "## 9. 잘 맞는 인상과 분위기",
    "외모 단정 없이 눈빛, 말투, 분위기, 스타일, 첫 데이트 결을 묘사하세요.",
    "## 10. 궁합 확인 질문",
    "상대 정보가 있으면 궁합 포인트를, 없으면 앞으로 확인할 질문 5개를 제안하세요.",
    "## 11. 다음 7일 행동 가이드",
    "오늘, 3일 안, 7일 안으로 나누어 실제 행동을 적으세요.",
    "## 참고 안내",
    "사주는 자기 이해를 돕는 참고용이며 실제 관계는 선택과 상호작용에 따라 달라진다고 안내하세요.",
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

export async function POST(req: Request) {
  const admin = await requireAdminRoute();
  if (!admin.ok) return admin.response;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, message: "GEMINI_API_KEY 환경변수가 아직 설정되지 않았습니다." }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as LoveFortuneGenerateBody;
  const birthDate = cleanText(body.birthDate, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    return NextResponse.json({ ok: false, message: "생년월일을 먼저 입력해 주세요." }, { status: 400 });
  }

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  const prompt = buildPromptV2({ ...body, birthDate });

  try {
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
          maxOutputTokens: 5600,
        },
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: "연애운 상세 풀이 생성에 실패했습니다.",
          status: res.status,
          detail: typeof data === "object" && data && "error" in data ? data.error : undefined,
        },
        { status: 502 }
      );
    }

    const text = cleanGeneratedReport(extractGeminiText(data));
    if (!text) {
      return NextResponse.json({ ok: false, message: "연애운 상세 풀이 응답이 비어 있습니다." }, { status: 502 });
    }

    const readingId = cleanText(body.readingId, 80);
    if (UUID_RE.test(readingId)) {
      const updateRes = await admin.admin
        .from("love_fortune_readings")
        .update({
          status: "generated",
          ai_model: model,
          ai_result: text,
          generated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", readingId)
        .eq("user_id", admin.user.id)
        .in("status", ["paid", "generated"]);

      if (updateRes.error) {
        console.error("love fortune reading result save failed", updateRes.error);
      }
    }

    return NextResponse.json({ ok: true, model, text });
  } catch (error) {
    console.error("love fortune gemini generate failed", error);
    return NextResponse.json({ ok: false, message: "연애운 생성 중 오류가 발생했습니다." }, { status: 500 });
  }
}
