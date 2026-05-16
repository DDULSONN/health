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
    "당신은 한국어로 상담하는 사랑/연애 전문 사주 리포트 작가입니다.",
    "목표는 사용자가 '내 이야기 같다'고 느끼고, 짐툴에서 실제 소개팅 행동으로 이어지게 만드는 것입니다.",
    "",
    "[중요 원칙]",
    "- 실제 만세력 계산값이 없는 상태라면 특정 간지, 오행, 대운, 세운을 단정하지 마세요.",
    "- 양력/음력/윤달, 출생시간 확실도, 출생지, 상대 정보 유무를 먼저 체크한 뒤 신뢰도 있게 설명하세요.",
    "- 출생시간이 불확실하면 타이밍을 단정하지 말고 성향/관계 패턴 중심으로 말하세요.",
    "- 공포 마케팅, 운명 단정, 질병/임신/투자 보장, 과도한 예언은 금지합니다.",
    "- 사주는 참고용이라는 톤을 유지하되, 결과는 유료 리포트처럼 구체적이고 밀도 있게 작성하세요.",
    "- 짐툴 서비스와 자연스럽게 연결하세요: 오픈카드, 빠른매칭, 1대1 소개팅 중 어떤 행동이 맞는지 제안합니다.",
    "",
    "[입력]",
    `생년월일: ${birthDate || "미입력"}`,
    `달력: ${calendarType || "미입력"}`,
    `태어난 시간: ${birthTime || "미입력"}`,
    `태어난 시간 확실도: ${birthTimeCertainty || "미입력"}`,
    `출생지/지역: ${birthPlace || "미입력"}`,
    `성별: ${gender || "미입력"}`,
    `현재 상황: ${loveState || "미입력"}`,
    `연애 목표: ${relationshipGoal || "미입력"}`,
    `선호 만남 방식: ${meetingPreference || "미입력"}`,
    `보고 싶은 항목: ${focus || "미입력"}`,
    `현재 고민: ${concern || "미입력"}`,
    `상대 생년월일: ${partnerBirthDate || "미입력"}`,
    `상대 태어난 시간: ${partnerBirthTime || "미입력"}`,
    `상대와의 관계: ${partnerRelation || "미입력"}`,
    "",
    "[출력 형식]",
    "## 한 줄 리딩",
    "- 사용자가 바로 저장하고 싶을 만큼 짧고 선명한 문장 1개",
    "",
    "## 입력 정확도 체크",
    "- 현재 입력으로 볼 수 있는 부분",
    "- 더 정확해지려면 필요한 정보",
    "- 출생시간 불확실도에 따른 해석 범위",
    "",
    "## 나의 연애 타입",
    "- 사랑을 시작하는 방식",
    "- 호감이 생겼을 때 보이는 패턴",
    "- 관계에서 안정감을 느끼는 조건",
    "",
    "## 끌리는 사람 vs 오래 맞는 사람",
    "- 순간적으로 끌리는 사람 유형",
    "- 실제로 오래 맞는 사람 유형",
    "- 피해야 할 관계 신호",
    "",
    "## 지금 연애 흐름",
    "- 현재 상황 기준으로 2~3문장",
    "- 소개팅, 연애, 재회, 상대 찾기 중 입력 상황에 맞춰 작성",
    "",
    "## 잘 맞는 인상/관상 카드",
    "- 실제 외모 단정이 아니라, 잘 맞는 분위기와 인상 키워드로 설명",
    "- 눈매, 미소, 말투, 스타일, 첫 만남에서 편한 분위기를 구체적으로 작성",
    "",
    "## 상대 정보가 있을 때 보는 궁합 포인트",
    "- 상대 정보가 부족하면 부족하다고 말하고, 확인 가능한 범위만 안내",
    "- 상대 정보가 있다면 서로의 속도, 표현 방식, 오해 포인트를 설명",
    "",
    "## 이번 주 행동 가이드",
    "- 연락",
    "- 첫 만남",
    "- 피해야 할 패턴",
    "",
    "## 짐툴에서 바로 할 일",
    "- 오픈카드 문구 방향",
    "- 빠른매칭/1대1 소개팅 중 어떤 방식이 맞는지",
    "- 오늘 바로 할 수 있는 행동 1개",
    "",
    "문장은 너무 길지 않게, 하지만 유료 리포트처럼 밀도 있게 작성하세요.",
    "마지막은 결제 유도 문구처럼 쓰지 말고, 자연스러운 리포트 안내처럼 마무리하세요.",
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
    return NextResponse.json(
      {
        ok: false,
        message: "GEMINI_API_KEY 환경변수가 아직 설정되지 않았습니다.",
      },
      { status: 500 }
    );
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
          maxOutputTokens: 1200,
        },
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: "Gemini 연애운 생성에 실패했습니다.",
          status: res.status,
          detail: typeof data === "object" && data && "error" in data ? data.error : undefined,
        },
        { status: 502 }
      );
    }

    const text = extractGeminiText(data);
    if (!text) {
      return NextResponse.json({ ok: false, message: "Gemini 응답이 비어 있습니다." }, { status: 502 });
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
