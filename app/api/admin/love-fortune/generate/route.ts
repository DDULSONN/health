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

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function buildPrompt(body: LoveFortuneGenerateBody) {
  const birthDate = cleanText(body.birthDate, 20);
  const birthTime = cleanText(body.birthTime, 30);
  const birthTimeCertainty = cleanText(body.birthTimeCertainty, 30);
  const birthPlace = cleanText(body.birthPlace, 80);
  const calendarType = cleanText(body.calendarType, 30);
  const gender = cleanText(body.gender, 20);
  const loveState = cleanText(body.loveState, 60);
  const relationshipGoal = cleanText(body.relationshipGoal, 80);
  const meetingPreference = cleanText(body.meetingPreference, 80);
  const focus = cleanText(body.focus, 80);
  const concern = cleanText(body.concern, 220);
  const partnerBirthDate = cleanText(body.partnerBirthDate, 20);
  const partnerBirthTime = cleanText(body.partnerBirthTime, 30);
  const partnerRelation = cleanText(body.partnerRelation, 60);

  return [
    "당신은 오래 상담해온 한국식 사랑/연애 사주 상담가입니다.",
    "양산형 AI 문장처럼 쓰지 말고, 실제 상담자가 사용자의 앞에 앉아 조심스럽게 짚어주는 말투로 작성하세요.",
    "문장은 너무 번역투처럼 딱딱하지 않게, '이 사람은 이런 결이 보여요', '이 부분은 조심해야 해요'처럼 자연스럽게 말하세요.",
    "짐툴 서비스의 소개팅 행동으로 자연스럽게 연결하되, 노골적인 광고 문구처럼 쓰지 마세요.",
    "",
    "[작성 원칙]",
    "- 실제 만세력 계산값이 없으므로 특정 간지, 십성, 대운, 세운을 단정하지 마세요.",
    "- 생년월일, 태어난 시간의 확실성, 현재 연애 상태, 만남 목표를 바탕으로 '사주 상담을 받은 듯한' 해석으로 쓰세요.",
    "- 태어난 시간이 모름/불확실이면 그 한계를 먼저 말하고, 성향/관계 패턴 중심으로 해석하세요.",
    "- 공포 마케팅, 운명 단정, 질병/임신/사망/재물 보장, 상대 외모 단정은 금지합니다.",
    "- 사주 용어를 쓸 때는 반드시 바로 옆에 쉬운 풀이를 붙이세요. 예: 대운(10년 단위로 바뀌는 큰 환경 흐름), 세운(올해처럼 1년 단위로 들어오는 분위기), 시주(태어난 시간으로 보는 관계의 세부 결).",
    "- 대운/세운을 특정 연도로 단정하지 말고, '큰 흐름이 바뀔 때 어떤 태도를 취해야 하는지'를 연애 행동으로 구체화하세요.",
    "- 사주를 모르는 사람도 읽히도록 답장 텀, 첫 만남 장소, 호감 표현 방식, 관계 속도 같은 일상 예시를 섞으세요.",
    "- 'AI', '알고리즘', '데이터상' 같은 표현은 절대 쓰지 마세요.",
    "- 결과는 자세하지만 읽기 쉽게, 각 섹션은 2~5문장으로 작성하세요.",
    "- 좋은 말만 하지 말고, 연애에서 반복될 수 있는 약점과 조심할 점도 부드럽게 짚으세요.",
    "- 사용자가 바로 행동할 수 있게 소개팅, 오픈카드, 빠른매칭, 1:1 매칭 중 어떤 방식이 맞는지도 제안하세요.",
    "",
    "[입력 정보]",
    `생년월일: ${birthDate || "미입력"}`,
    `달력: ${calendarType || "미입력"}`,
    `태어난 시간: ${birthTime || "미입력"}`,
    `태어난 시간 확실성: ${birthTimeCertainty || "미입력"}`,
    `태어난 지역: ${birthPlace || "미입력"}`,
    `성별: ${gender || "미입력"}`,
    `현재 연애 상황: ${loveState || "미입력"}`,
    `연애 목표: ${relationshipGoal || "미입력"}`,
    `선호 만남 방식: ${meetingPreference || "미입력"}`,
    `보고 싶은 항목: ${focus || "미입력"}`,
    `현재 고민: ${concern || "미입력"}`,
    `상대 생년월일: ${partnerBirthDate || "미입력"}`,
    `상대 태어난 시간: ${partnerBirthTime || "미입력"}`,
    `상대와의 관계: ${partnerRelation || "미입력"}`,
    "",
    "[출력 형식]",
    "아래 제목을 그대로 사용하세요.",
    "## 도화냥 총평",
    "상담자가 첫마디로 짚어주는 듯한 핵심. 왜 그렇게 보는지 짧게 덧붙이세요.",
    "## 입력 신뢰도",
    "현재 입력으로 볼 수 있는 범위와 부족한 정보. 태어난 시간 불확실성 반영.",
    "## 명식 핵심 요약",
    "오행/기운/관계 결을 연애 성향으로 번역해서 설명.",
    "## 대운과 연애 흐름을 읽는 법",
    "대운이 무엇인지 쉬운 말로 설명하고, 큰 흐름이 좋을 때와 애매할 때 각각 어떻게 행동해야 하는지.",
    "## 연애할 때 드러나는 결",
    "표현 방식, 감정 속도, 관계에서 안정감을 느끼는 조건.",
    "## 반복되는 연애 패턴",
    "자주 빠지는 패턴, 끊기기 쉬운 지점, 상대가 오해할 수 있는 부분을 현실 예시로.",
    "## 끌리는 사람 vs 오래 맞는 사람",
    "순간적으로 끌리는 유형과 실제로 오래 가는 유형을 구분.",
    "## 지금 연애 흐름의 맥",
    "현재 상태 기준으로 소개팅/재회/썸/상대 찾기 중 무엇이 유리한지.",
    "## 잘 맞는 인상과 분위기",
    "외모 단정 없이 눈빛, 미소, 말투, 스타일, 첫 만남 분위기를 묘사.",
    "## 상대 정보로 짚는 궁합 포인트",
    "상대 정보가 있으면 궁합 포인트, 없으면 추후 확인하면 좋은 항목.",
    "## 7일 행동 가이드",
    "오늘/이번 주에 바로 할 수 있는 행동 3가지.",
    "## 짐툴 활용 추천",
    "오픈카드, 빠른매칭, 1:1 매칭 중 맞는 사용법과 프로필 문구 방향.",
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
  const prompt = buildPrompt({ ...body, birthDate });

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
          maxOutputTokens: 2200,
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

    const text = extractGeminiText(data);
    if (!text) {
      return NextResponse.json({ ok: false, message: "연애운 상세 풀이 응답이 비어 있습니다." }, { status: 502 });
    }

    const readingId = cleanText(body.readingId, 80);
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(readingId)) {
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
