import { getKstDayRangeUtc } from "@/lib/dating-open";
import { hasMoreViewAccess } from "@/lib/dating-more-view";
import { hasCityViewAccess } from "@/lib/dating-city-view";
import { sendDatingEmailNotification } from "@/lib/dating-swipe";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ApiCode =
  | "SUCCESS"
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR"
  | "NICKNAME_REQUIRED"
  | "CARD_NOT_FOUND"
  | "CARD_EXPIRED"
  | "FORBIDDEN"
  | "DAILY_APPLY_LIMIT"
  | "DUPLICATE_APPLICATION"
  | "SCHEMA_MISMATCH"
  | "DATABASE_ERROR"
  | "RATE_LIMIT"
  | "INTERNAL_SERVER_ERROR";

type DbErrorShape = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

function isDev() {
  return process.env.NODE_ENV !== "production";
}

function normalizeInstagramId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^@+/, "").replace(/\s+/g, "");
}

function validInstagramId(value: string) {
  return /^[A-Za-z0-9._]{1,30}$/.test(value);
}

function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

function toDbErrorShape(error: unknown): DbErrorShape {
  if (!error || typeof error !== "object") return {};
  const e = error as Record<string, unknown>;
  return {
    code: typeof e.code === "string" ? e.code : null,
    message: typeof e.message === "string" ? e.message : null,
    details: typeof e.details === "string" ? e.details : null,
    hint: typeof e.hint === "string" ? e.hint : null,
  };
}

function maskPayloadForLog(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const photoPaths = Array.isArray(b.photo_paths)
    ? b.photo_paths.filter((item): item is string => typeof item === "string")
    : [];
  return {
    card_id: typeof b.card_id === "string" ? b.card_id : null,
    age: b.age ?? null,
    height_cm: b.height_cm ?? null,
    training_years: b.training_years ?? null,
    intro_text_len: typeof b.intro_text === "string" ? b.intro_text.trim().length : 0,
    instagram_id_masked: typeof b.instagram_id === "string" ? `${b.instagram_id.slice(0, 2)}***` : null,
    photo_paths_count: photoPaths.length,
    consent: Boolean(b.consent),
  };
}

function jsonResponse(
  status: number,
  code: ApiCode,
  requestId: string,
  message: string,
  extra?: Record<string, unknown>,
  dbError?: DbErrorShape
) {
  const payload: Record<string, unknown> = {
    ok: status >= 200 && status < 300,
    code,
    requestId,
    message,
    ...extra,
  };

  if (dbError && isDev()) {
    payload.supabaseError = {
      code: dbError.code ?? null,
      message: dbError.message ?? null,
      details: dbError.details ?? null,
      hint: dbError.hint ?? null,
    };
  }

  return NextResponse.json(payload, { status });
}

function mapDbErrorToHttp(code?: string | null): { status: number; apiCode: ApiCode; message: string } {
  if (code === "23505") return { status: 409, apiCode: "DUPLICATE_APPLICATION", message: "???? ?????????노듋??????饔낅떽??????雅?퍔瑗?땟???????????" };
  if (code === "23502") return { status: 400, apiCode: "VALIDATION_ERROR", message: "?????諛몃마????????????諛몃마??ｌ꽔???????????" };
  if (code === "23503") return { status: 400, apiCode: "VALIDATION_ERROR", message: "?饔낅떽?????????????????? ??????? ????????????놁졄." };
  if (code === "42501") return { status: 403, apiCode: "FORBIDDEN", message: "??????????????깅즿??????嫄?????饔낅떽???壤굿?戮㏐광???????????깅즽????????놁졄." };
  if (code === "PGRST202" || code === "PGRST204" || code === "42883") {
    return { status: 503, apiCode: "SCHEMA_MISMATCH", message: "???꿔꺂??틝???彛???????꾣뤃???얜굝??????⑥ル럯?????β뼯爰????????????酉귘뵾??饔낅떽???壤굿?戮㏐광???????????깅즽????????놁졄." };
  }
  return { status: 500, apiCode: "DATABASE_ERROR", message: "?饔낅떽???????饔낅떽???壤굿?戮㏐광??????????ㅼ굣?????ル늉?? ????썹땟戮녹??醫딆맚嶺뚮㉡???????????????놁졄." };
}
function logSupabaseError(requestId: string, stage: string, dbError: DbErrorShape) {
  console.error(`[apply] ${requestId} ${stage} SUPABASE_ERROR`, {
    code: dbError.code ?? null,
    message: dbError.message ?? null,
    details: dbError.details ?? null,
    hint: dbError.hint ?? null,
  });
}

type ConsumeTokenResult = {
  used: "base" | "credit" | "none";
  base_used: number;
  credits_remaining: number;
};

function safeNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

function isMissingTokenRpcError(dbError: DbErrorShape): boolean {
  const code = String(dbError.code ?? "");
  const message = String(dbError.message ?? "").toLowerCase();
  return (
    code === "PGRST202" ||
    code === "PGRST204" ||
    code === "42883" ||
    message.includes("consume_apply_token") ||
    (message.includes("function") && message.includes("does not exist"))
  );
}

async function withSlowQueryLog<T>(requestId: string, queryName: string, fn: () => Promise<T>, warnMs = 200): Promise<T> {
  const started = Date.now();
  const result = await fn();
  const elapsed = Date.now() - started;
  if (elapsed > warnMs) {
    console.warn(`[slow.query] requestId=${requestId} name=${queryName} durationMs=${elapsed}`);
  }
  return result;
}

async function getLegacyCreditBalance(adminClient: ReturnType<typeof createAdminClient>, userId: string): Promise<number> {
  const creditsRes = await adminClient.from("user_apply_credits").select("credits").eq("user_id", userId).maybeSingle();
  if (creditsRes.error) {
    throw creditsRes.error;
  }
  return Math.max(0, Number(creditsRes.data?.credits ?? 0));
}

async function refundLegacyCredit(adminClient: ReturnType<typeof createAdminClient>, userId: string): Promise<void> {
  const credits = await getLegacyCreditBalance(adminClient, userId);
  const nowIso = new Date().toISOString();

  if (credits <= 0) {
    const upsertRes = await adminClient
      .from("user_apply_credits")
      .upsert({ user_id: userId, credits: 1, updated_at: nowIso }, { onConflict: "user_id" });
    if (upsertRes.error) {
      throw upsertRes.error;
    }
    return;
  }

  const updateRes = await adminClient
    .from("user_apply_credits")
    .update({ credits: credits + 1, updated_at: nowIso })
    .eq("user_id", userId);
  if (updateRes.error) {
    throw updateRes.error;
  }
}
export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  let userId: string | null = null;
  let body: unknown = null;

  try {
    console.log(`[apply] ${requestId} L1 start`);

    const supabase = await createClient();
    const userRes = await supabase.auth.getUser();
    const authError = toDbErrorShape(userRes.error);
    userId = userRes.data.user?.id ?? null;
    const ip = extractClientIp(req);
    const rateLimit = await checkRouteRateLimit({
      requestId,
      scope: "dating-cards-apply",
      userId,
      ip,
      userLimitPerMin: 10,
      ipLimitPerMin: 60,
      path: "/api/dating/cards/apply",
    });
    if (!rateLimit.allowed) {
      return jsonResponse(429, "RATE_LIMIT", requestId, "Too many requests");
    }
    console.log(`[apply] ${requestId} L2 auth.getUser`, {
      hasUser: Boolean(userId),
      userId,
      hasError: Boolean(userRes.error),
    });
    if (userRes.error) {
      logSupabaseError(requestId, "L2 auth.getUser", authError);
    }

    if (!userId) {
      return jsonResponse(401, "UNAUTHORIZED", requestId, "????癲???饔낅떽???????깃묄???????獄쏅챶留????轅붽틓??????");
    }

    body = await req.json().catch(() => null);
    console.log(`[apply] ${requestId} L3 body.received`, {
      userId,
      payload: maskPayloadForLog(body),
    });

    if (!body) {
      return jsonResponse(400, "VALIDATION_ERROR", requestId, "???????????椰????????筌?캉??");
    }

    const input = body as Record<string, unknown>;
    const cardId = sanitizeText(input.card_id, 100);
    const age = toInt(input.age);
    const heightCm = toInt(input.height_cm);
    const trainingYears = toInt(input.training_years);
    const region = sanitizeText(input.region, 30);
    const job = sanitizeText(input.job, 50);
    const introText = sanitizeText(input.intro_text, 1000);
    const instagramId = normalizeInstagramId(input.instagram_id);
    const consent = Boolean(input.consent);
    const photoPathsRaw = input.photo_paths;
    const photoPaths = Array.isArray(photoPathsRaw)
      ? photoPathsRaw.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];

    const validationErrors: string[] = [];
    if (!cardId) validationErrors.push("card_id");
    if (!instagramId) validationErrors.push("instagram_id");
    if (!introText) validationErrors.push("intro_text");
    if (!consent) validationErrors.push("consent");
    if (photoPaths.length !== 2) validationErrors.push("photo_paths");
    if (!validInstagramId(instagramId)) validationErrors.push("instagram_id_format");
    if (age == null || age < 19 || age > 99) validationErrors.push("age");
    if (heightCm == null || heightCm < 120 || heightCm > 230) validationErrors.push("height_cm");
    if (trainingYears == null || trainingYears < 0 || trainingYears > 50) validationErrors.push("training_years");
    if (!photoPaths.every((path) => path.startsWith(`card-applications/${userId}/`))) validationErrors.push("photo_paths_prefix");

    console.log(`[apply] ${requestId} L3 body.validated`, {
      userId,
      valid: validationErrors.length === 0,
      validationErrors,
    });

    if (validationErrors.length > 0) {
      return jsonResponse(400, "VALIDATION_ERROR", requestId, "???????쇨덫櫻?????ル뒌??????饔낅떽????????????欲꼲????饔낅떽??????", { fields: validationErrors });
    }

    const profileRes = await supabase
      .from("profiles")
      .select("nickname")
      .eq("user_id", userId)
      .maybeSingle();
    const profileError = toDbErrorShape(profileRes.error);
    console.log(`[apply] ${requestId} L4 profile.read`, {
      userId,
      hasRow: Boolean(profileRes.data),
      nickname: profileRes.data?.nickname ?? null,
      hasError: Boolean(profileRes.error),
    });
    if (profileRes.error) {
      logSupabaseError(requestId, "L4 profile.read", profileError);
      const mapped = mapDbErrorToHttp(profileError.code);
      return jsonResponse(mapped.status, mapped.apiCode, requestId, mapped.message, undefined, profileError);
    }

    const applicantDisplayNickname = sanitizeText(profileRes.data?.nickname, 20);
    if (!applicantDisplayNickname) {
      return jsonResponse(400, "NICKNAME_REQUIRED", requestId, "??????怨????????μ떜媛?걫????????????ㅻ쑄???????ル뒌???????嚥〓끃異??????????곸죩.", {
        profile_edit_url: "/mypage",
      });
    }

    const adminClient = createAdminClient();
    const cardRes = await adminClient
      .from("dating_cards")
      .select("id, owner_user_id, status, expires_at, sex, region")
      .eq("id", cardId)
      .single();
    const cardError = toDbErrorShape(cardRes.error);
    console.log(`[apply] ${requestId} L5 card.read`, {
      userId,
      cardId,
      hasCard: Boolean(cardRes.data),
      cardStatus: cardRes.data?.status ?? null,
      cardExpiresAt: cardRes.data?.expires_at ?? null,
      hasError: Boolean(cardRes.error),
    });
    if (cardRes.error || !cardRes.data) {
      if (cardRes.error) {
        logSupabaseError(requestId, "L5 card.read", cardError);
      }
      if (cardError.code === "PGRST116") {
        return jsonResponse(404, "CARD_NOT_FOUND", requestId, "?????몃뱥?????鶯ㅺ동???볥궚???耀붾굝????????????????源낆┰?????????곸죩.");
      }
      const mapped = mapDbErrorToHttp(cardError.code);
      return jsonResponse(mapped.status, mapped.apiCode, requestId, mapped.message, undefined, cardError);
    }

    const card = cardRes.data;
    if (card.owner_user_id === userId) {
      return jsonResponse(403, "FORBIDDEN", requestId, "?????곕츥?嶺뚮?爰????????몃뱥?????????耀붾굝??????????붺몭???????堉?????????源낆┰?????????곸죩.");
    }
    if (card.status === "expired") {
      return jsonResponse(410, "CARD_EXPIRED", requestId, "?????몃뱥???????猷몃??? ?耀붾굝?????????????????");
    }
    let allowedByMoreView = false;
    let allowedByCityView = false;
    if (card.status === "pending") {
      allowedByMoreView = await hasMoreViewAccess(adminClient, userId, card.sex);
      allowedByCityView = await hasCityViewAccess(adminClient, userId, card.region ?? null);
    }
    if (card.status !== "public" && !allowedByMoreView && !allowedByCityView) {
      return jsonResponse(403, "FORBIDDEN", requestId, "?轅붽틓????????ル봿????μ떝?롳쭗?????ㅳ늾??????猷붾읁? ?????밸븶?癲??????낆젵.");
    }
    if (card.status === "public" && (!card.expires_at || new Date(card.expires_at).getTime() <= Date.now())) {
      return jsonResponse(410, "CARD_EXPIRED", requestId, "???ㅳ늾??????猷붾읁? ?轅붽틓????鶯??癲???????");
    }
    const consumeRes = await adminClient.rpc("consume_apply_token", { p_user_id: userId });
    const consumeError = toDbErrorShape(consumeRes.error);
    const consumeRow = (Array.isArray(consumeRes.data) ? consumeRes.data[0] : null) as
      | { used?: string; base_used?: number; credits_remaining?: number }
      | null;
    let tokenUsage: ConsumeTokenResult = {
      used:
        consumeRow?.used === "base" || consumeRow?.used === "credit" || consumeRow?.used === "none"
          ? consumeRow.used
          : "none",
      base_used: safeNumber(consumeRow?.base_used),
      credits_remaining: safeNumber(consumeRow?.credits_remaining),
    };
    let usedLegacyManualCredit = false;

    console.log(`[apply] ${requestId} L6 token.consume`, {
      userId,
      tokenUsage,
      hasError: Boolean(consumeRes.error),
    });
    if (consumeRes.error && isMissingTokenRpcError(consumeError)) {
      console.warn(`[apply] ${requestId} L6 token.consume fallback_to_legacy_daily_limit`, {
        userId,
        code: consumeError.code ?? null,
        message: consumeError.message ?? null,
      });

      const { startUtcIso, endUtcIso } = getKstDayRangeUtc();
      const todayRowsRes = await withSlowQueryLog(requestId, "daily_apply_usage_fallback", async () =>
        supabase
          .from("dating_card_applications")
          .select("id")
          .eq("applicant_user_id", userId)
          .in("status", ["submitted", "accepted", "rejected"])
          .gte("created_at", startUtcIso)
          .lt("created_at", endUtcIso)
          .limit(2)
      );
      const todayRowsError = toDbErrorShape(todayRowsRes.error);
      if (todayRowsRes.error) {
        logSupabaseError(requestId, "L6 fallback.daily.count", todayRowsError);
        const mapped = mapDbErrorToHttp(todayRowsError.code);
        return jsonResponse(mapped.status, mapped.apiCode, requestId, mapped.message, undefined, todayRowsError);
      }

      const todayCount = Array.isArray(todayRowsRes.data) ? todayRowsRes.data.length : 0;
      const currentCredits = await getLegacyCreditBalance(adminClient, userId);
      if (todayCount < 2) {
        tokenUsage = {
          used: "base",
          base_used: Math.min(2, todayCount + 1),
          credits_remaining: currentCredits,
        };
      } else if (currentCredits > 0) {
        const consumeCreditRes = await adminClient
          .from("user_apply_credits")
          .update({ credits: currentCredits - 1, updated_at: new Date().toISOString() })
          .eq("user_id", userId);
        const consumeCreditError = toDbErrorShape(consumeCreditRes.error);
        if (consumeCreditRes.error) {
          logSupabaseError(requestId, "L6 fallback.credit.consume", consumeCreditError);
          const mapped = mapDbErrorToHttp(consumeCreditError.code);
          return jsonResponse(mapped.status, mapped.apiCode, requestId, mapped.message, undefined, consumeCreditError);
        }
        usedLegacyManualCredit = true;
        tokenUsage = {
          used: "credit",
          base_used: 2,
          credits_remaining: Math.max(0, currentCredits - 1),
        };
      } else {
        return jsonResponse(
          429,
          "DAILY_APPLY_LIMIT",
          requestId,
          "?ㅻ뒛 湲곕낯 吏??2?뚮? 紐⑤몢 ?ъ슜?덉뒿?덈떎. 異붽? 吏?먭텒???덉쑝硫?怨꾩냽 吏?먰븷 ???덉뒿?덈떎.",
          {
            baseRemaining: 0,
            creditsRemaining: 0,
          }
        );
      }
    } else if (consumeRes.error) {
      logSupabaseError(requestId, "L6 token.consume", consumeError);
      const mapped = mapDbErrorToHttp(consumeError.code);
      return jsonResponse(mapped.status, mapped.apiCode, requestId, mapped.message, undefined, consumeError);
    }
    if (tokenUsage.used === "none") {
      const currentCredits = await getLegacyCreditBalance(adminClient, userId);
      if (currentCredits > 0) {
        const consumeCreditRes = await adminClient
          .from("user_apply_credits")
          .update({ credits: currentCredits - 1, updated_at: new Date().toISOString() })
          .eq("user_id", userId);
        const consumeCreditError = toDbErrorShape(consumeCreditRes.error);
        if (consumeCreditRes.error) {
          logSupabaseError(requestId, "L6 token.consume.none.credit", consumeCreditError);
          const mapped = mapDbErrorToHttp(consumeCreditError.code);
          return jsonResponse(mapped.status, mapped.apiCode, requestId, mapped.message, undefined, consumeCreditError);
        }
        usedLegacyManualCredit = true;
        tokenUsage = {
          used: "credit",
          base_used: Math.min(2, tokenUsage.base_used),
          credits_remaining: Math.max(0, currentCredits - 1),
        };
      }
    }
    if (tokenUsage.used === "none") {
      return jsonResponse(429, "DAILY_APPLY_LIMIT", requestId, "오늘 기본 지원 2회를 모두 사용했습니다. 추가 지원권이 있으면 계속 지원할 수 있습니다.", {
        baseRemaining: Math.max(0, 2 - tokenUsage.base_used),
        creditsRemaining: Math.max(0, tokenUsage.credits_remaining),
      });
    }

    const insertPayload = {
      card_id: cardId,
      applicant_user_id: userId,
      applicant_display_nickname: applicantDisplayNickname,
      age,
      height_cm: heightCm,
      region,
      job,
      training_years: trainingYears,
      intro_text: introText,
      instagram_id: instagramId,
      photo_paths: photoPaths,
      status: "submitted" as const,
    };

    const insertPayloadNoNickname = {
      card_id: cardId,
      applicant_user_id: userId,
      age,
      height_cm: heightCm,
      region,
      job,
      training_years: trainingYears,
      intro_text: introText,
      instagram_id: instagramId,
      photo_paths: photoPaths,
      status: "submitted" as const,
    };

    const insertPayloadLegacyPhoto = {
      card_id: cardId,
      applicant_user_id: userId,
      applicant_display_nickname: applicantDisplayNickname,
      age,
      height_cm: heightCm,
      region,
      job,
      training_years: trainingYears,
      intro_text: introText,
      instagram_id: instagramId,
      photo_urls: photoPaths,
      status: "submitted" as const,
    };

    const insertPayloadLegacyPhotoNoNickname = {
      card_id: cardId,
      applicant_user_id: userId,
      age,
      height_cm: heightCm,
      region,
      job,
      training_years: trainingYears,
      intro_text: introText,
      instagram_id: instagramId,
      photo_urls: photoPaths,
      status: "submitted" as const,
    };

    const candidates: Array<{ label: string; payload: Record<string, unknown> }> = [
      { label: "new_with_nickname", payload: insertPayload },
      { label: "new_no_nickname", payload: insertPayloadNoNickname },
      { label: "legacy_photo_with_nickname", payload: insertPayloadLegacyPhoto },
      { label: "legacy_photo_no_nickname", payload: insertPayloadLegacyPhotoNoNickname },
    ];

    const useAdminInsert = card.status === "pending" && (allowedByMoreView || allowedByCityView);
    const applicationWriter = useAdminInsert ? adminClient : supabase;

    let insertRes: { data: { id: string } | null; error: unknown } = { data: null, error: null };
    let insertError: DbErrorShape = {};

    for (const candidate of candidates) {
      console.log(`[apply] ${requestId} L7 insert.try`, { candidate: candidate.label });
      const res = await applicationWriter
        .from("dating_card_applications")
        .insert(candidate.payload)
        .select("id")
        .single();
      insertRes = { data: (res.data as { id: string } | null) ?? null, error: res.error };
      insertError = toDbErrorShape(res.error);
      if (!res.error) {
        break;
      }
      logSupabaseError(requestId, `L7 insert.${candidate.label}`, insertError);
      if (insertError.code !== "PGRST204") {
        break;
      }
    }

    console.log(`[apply] ${requestId} L7 insert.result`, {
      userId,
      cardId,
      insertedId: insertRes.data?.id ?? null,
      hasError: Boolean(insertRes.error),
    });
    if (insertRes.error) {
      if (tokenUsage.used === "base" || tokenUsage.used === "credit") {
        if (usedLegacyManualCredit && tokenUsage.used === "credit") {
          try {
            await refundLegacyCredit(adminClient, userId);
          } catch (legacyRefundError) {
            logSupabaseError(requestId, "L7 token.refund.legacy", toDbErrorShape(legacyRefundError));
          }
        } else {
          const refundRes = await adminClient.rpc("refund_apply_token", {
            p_user_id: userId,
            p_used: tokenUsage.used,
          });
          if (refundRes.error) {
            logSupabaseError(requestId, "L7 token.refund", toDbErrorShape(refundRes.error));
          } else {
            console.log(`[apply] ${requestId} L7 token.refund`, { refunded: true, used: tokenUsage.used });
          }
        }
      }
      logSupabaseError(requestId, "L7 insert.result", insertError);
      const mapped = mapDbErrorToHttp(insertError.code);
      return jsonResponse(mapped.status, mapped.apiCode, requestId, mapped.message, undefined, insertError);
    }
    if (!insertRes.data?.id) {
      if (tokenUsage.used === "base" || tokenUsage.used === "credit") {
        if (usedLegacyManualCredit && tokenUsage.used === "credit") {
          try {
            await refundLegacyCredit(adminClient, userId);
          } catch (legacyRefundError) {
            logSupabaseError(requestId, "L7 token.refund.legacy", toDbErrorShape(legacyRefundError));
          }
        } else {
          const refundRes = await adminClient.rpc("refund_apply_token", {
            p_user_id: userId,
            p_used: tokenUsage.used,
          });
          if (refundRes.error) {
            logSupabaseError(requestId, "L7 token.refund", toDbErrorShape(refundRes.error));
          } else {
            console.log(`[apply] ${requestId} L7 token.refund`, { refunded: true, used: tokenUsage.used });
          }
        }
      }
      return jsonResponse(500, "DATABASE_ERROR", requestId, "?耀붾굝????????耀붾굝????鶯ㅺ동??筌믡룓愿???????????쇨덫??????ル뒌?? ?????밸븶筌믩끃???ル봿留싷┼??돘????????????????곸죩.");
    }

    console.log(`[apply] ${requestId} L8 before return`, {
      userId,
      cardId,
      insertedId: insertRes.data.id,
    });

    await sendDatingEmailNotification(
      adminClient,
      card.owner_user_id,
      "??쎈탞燁삳?諭????筌왖?癒?퐣揶쎛 ?袁⑷컩??됰뮸??덈뼄",
      `${applicantDisplayNickname}??륁뵠 ???뜚??륁벥 ??쎈탞燁삳?諭??筌왖?癒?퐣??癰귣?源??щ빍??\n????紐꾨퓠???類ㅼ뵥????紐꾩뒄.`
    ).catch((notifyError) => {
      console.error(`[apply] ${requestId} L8 notify failed`, notifyError);
    });

    return jsonResponse(200, "SUCCESS", requestId, "?耀붾굝???????????????獄쏅챶留???????????", {
      id: insertRes.data.id,
      usedToken: tokenUsage.used,
      baseRemaining: Math.max(0, 2 - tokenUsage.base_used),
      creditsRemaining: Math.max(0, tokenUsage.credits_remaining),
    });
  } catch (e) {
    const dbError = toDbErrorShape(e);
    console.error(`[apply] ${requestId} ERROR`, {
      message: e instanceof Error ? e.message : undefined,
      stack: e instanceof Error ? e.stack : undefined,
      name: e instanceof Error ? e.name : undefined,
    });
    if (dbError.code || dbError.message || dbError.details || dbError.hint) {
      logSupabaseError(requestId, "catch", dbError);
    }
    console.error(`[apply] ${requestId} ERROR_CONTEXT`, {
      userId,
      payload: maskPayloadForLog(body),
    });

    return jsonResponse(500, "INTERNAL_SERVER_ERROR", requestId, "?耀붾굝????????耀붾굝????鶯ㅺ동??筌믡룓愿???????????쇨덫??????ル뒌?? ?????밸븶筌믩끃???ル봿留싷┼??돘????????????????곸죩.", undefined, dbError);
  }
}













