import { NextResponse } from "next/server";
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
  const eye = pick(seed + 1, ["차분하고 선한 눈매", "웃을 때 부드러워지는 눈매", "집중력이 느껴지는 또렷한 눈매", "편안하게 오래 마주볼 수 있는 눈매"]);
  const smile = pick(seed + 3, ["장난기보다 안정감 있는 미소", "먼저 긴장을 풀어주는 환한 미소", "말보다 표정으로 배려가 보이는 미소", "담백하지만 따뜻한 미소"]);
  const mood = pick(seed + 5, ["편안하고 신뢰감 있는 분위기", "운동 후에도 단정함이 살아 있는 분위기", "차분하지만 대화하면 밝아지는 분위기", "과하지 않고 오래 볼수록 매력적인 분위기"]);
  const style = pick(seed + 7, ["깔끔한 기본 스타일", "담백한 스포츠 캐주얼", "부드러운 색감의 단정한 스타일", "자기 관리가 느껴지는 미니멀한 스타일"]);
  const firstDate = pick(seed + 9, ["카페에서 짧게 만나도 대화가 끊기지 않는 사람", "운동이나 산책처럼 편한 활동에서 매력이 나오는 사람", "처음부터 강하게 밀어붙이기보다 속도를 맞춰주는 사람", "말보다 약속과 태도로 신뢰를 주는 사람"]);
  const avoid = pick(seed + 11, ["감정 기복을 과하게 드러내는 인상", "대화보다 평가가 앞서는 태도", "연락 속도만 빠르고 약속이 불안정한 타입", "처음부터 확답을 강요하는 분위기"]);
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
    note: "실제 외모를 단정하는 기능이 아니라, 내 연애 성향과 잘 맞는 분위기를 이미지 카드처럼 정리한 참고용입니다.",
    prompt,
  };
}

function buildPrompt(row: LoveFortuneRow) {
  const ideal = buildIdealFaceProfile(row);

  return [
    "당신은 한국어로 상담하는 사랑/연애 전문 사주 리포트 작가입니다.",
    "사용자가 결제 후 보는 유료 리포트입니다. 무료 미리보기보다 훨씬 구체적이고 실용적으로 작성하세요.",
    "",
    "[중요 원칙]",
    "- 실제 만세력 계산값이 없으므로 특정 간지, 오행, 대운, 세운을 단정하지 마세요.",
    "- 출생시간 확실도가 낮으면 타이밍을 단정하지 말고 성향과 관계 패턴 중심으로 안내하세요.",
    "- 공포 마케팅, 운명 단정, 질병/임신/투자 보장, 과도한 예언은 금지합니다.",
    "- 짐툴 서비스 행동으로 자연스럽게 연결하세요: 오픈카드, 빠른매칭, 1대1 소개팅.",
    "",
    "[입력]",
    `생년월일: ${row.birth_date}`,
    `달력: ${row.calendar_type}`,
    `태어난 시간: ${row.birth_time}`,
    `태어난 시간 확실도: ${row.birth_time_certainty}`,
    `출생지/지역: ${row.birth_place ?? "미입력"}`,
    `성별: ${row.gender}`,
    `현재 상황: ${row.love_state ?? "미입력"}`,
    `연애 목표: ${row.relationship_goal ?? "미입력"}`,
    `선호 만남 방식: ${row.meeting_preference ?? "미입력"}`,
    `보고 싶은 항목: ${row.focus ?? "미입력"}`,
    `현재 고민: ${row.concern ?? "미입력"}`,
    `상대 생년월일: ${row.partner_birth_date ?? "미입력"}`,
    `상대 태어난 시간: ${row.partner_birth_time ?? "미입력"}`,
    `상대와의 관계: ${row.partner_relation ?? "미입력"}`,
    "",
    "[잘 맞는 인상 카드 참고]",
    `인상: ${ideal.mood}`,
    `눈매: ${ideal.eye}`,
    `미소: ${ideal.smile}`,
    `스타일: ${ideal.style}`,
    "",
    "[출력 형식]",
    "## 한 줄 리딩",
    "## 입력 정확도 체크",
    "## 나의 연애 타입",
    "## 끌리는 사람 vs 오래 맞는 사람",
    "## 지금 연애 흐름",
    "## 잘 맞는 인상/관상 카드",
    "## 상대 정보가 있을 때 보는 궁합 포인트",
    "## 이번 주 행동 가이드",
    "## 짐툴에서 바로 할 일",
    "",
    "각 섹션은 2~5문장 안에서 밀도 있게 작성하세요. 결과 마지막에는 참고용 안내를 자연스럽게 포함하세요.",
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
  const idealFace = (row.ideal_face_profile && Object.keys(row.ideal_face_profile).length > 0)
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

    const admin = createAdminClient();
    const res = await admin
      .from("love_fortune_readings")
      .select("id,user_id,status,calendar_type,birth_date,birth_time,birth_time_certainty,birth_place,gender,love_state,relationship_goal,meeting_preference,focus,concern,partner_birth_date,partner_birth_time,partner_relation,amount,ai_model,ai_result,ideal_face_profile,ideal_face_prompt,ideal_face_image_url,paid_at,generated_at,created_at")
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

    const body = (await req.json().catch(() => ({}))) as { readingId?: unknown };
    const readingId = cleanText(body.readingId, 80);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(readingId)) {
      return json(400, { ok: false, requestId, message: "연애운 내역을 찾지 못했습니다." });
    }

    const admin = createAdminClient();
    const readRes = await admin
      .from("love_fortune_readings")
      .select("id,user_id,status,calendar_type,birth_date,birth_time,birth_time_certainty,birth_place,gender,love_state,relationship_goal,meeting_preference,focus,concern,partner_birth_date,partner_birth_time,partner_relation,amount,ai_model,ai_result,ideal_face_profile,ideal_face_prompt,ideal_face_image_url,paid_at,generated_at,created_at")
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
      return json(500, { ok: false, requestId, message: "AI 설정이 아직 완료되지 않았습니다." });
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
          maxOutputTokens: 1300,
        },
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[mypage-love-fortune] ${requestId} gemini failed`, { status: res.status, data });
      return json(502, { ok: false, requestId, message: "AI 연애운 생성에 실패했습니다. 잠시 후 다시 시도해 주세요." });
    }

    const text = extractGeminiText(data);
    if (!text) {
      return json(502, { ok: false, requestId, message: "AI 응답이 비어 있습니다. 잠시 후 다시 시도해 주세요." });
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
      .select("id,user_id,status,calendar_type,birth_date,birth_time,birth_time_certainty,birth_place,gender,love_state,relationship_goal,meeting_preference,focus,concern,partner_birth_date,partner_birth_time,partner_relation,amount,ai_model,ai_result,ideal_face_profile,ideal_face_prompt,ideal_face_image_url,paid_at,generated_at,created_at")
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
