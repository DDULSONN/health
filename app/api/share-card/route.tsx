import { ImageResponse } from "next/og";

export const runtime = "edge";

function jsonError(status: number, code: string, extra?: Record<string, unknown>) {
  return new Response(JSON.stringify({ error: code, ...(extra ?? {}) }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function parseOptionalNumber(raw: string | null, fallback: number) {
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return Number.NaN;
  return value;
}

function sanitizeNickname(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function getTierMessage(percentAll: number): string {
  if (percentAll <= 1) return "전국 상위 1% 괴물";
  if (percentAll <= 5) return "상위 5% 엘리트";
  if (percentAll <= 15) return "상위 15% 헬창";
  if (percentAll <= 30) return "상위 30% 상위권";
  return "성장 중";
}

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;

    const totalRaw = parseOptionalNumber(sp.get("total"), 0);
    const percentAllRaw = parseOptionalNumber(sp.get("percentAll"), 30);
    const percentByClassRaw = parseOptionalNumber(sp.get("percentByClass"), 30);

    if (!Number.isFinite(totalRaw) || !Number.isFinite(percentAllRaw) || !Number.isFinite(percentByClassRaw)) {
      return jsonError(400, "invalid_number_params", {
        total: sp.get("total"),
        percentAll: sp.get("percentAll"),
        percentByClass: sp.get("percentByClass"),
      });
    }

    const classRangeRaw = (sp.get("classRange") || "체급 정보 없음").trim();
    const nicknameRaw = sanitizeNickname(sp.get("nickname") || "GymTools User");

    if (!/^[0-9A-Za-z가-힣_ ]{1,12}$/.test(nicknameRaw)) {
      return jsonError(400, "invalid_nickname", { nickname: sp.get("nickname") });
    }

    if (!/^[0-9A-Za-z가-힣~%+\- ]{1,20}$/.test(classRangeRaw)) {
      return jsonError(400, "invalid_classRange", { classRange: sp.get("classRange") });
    }

    const total = Math.max(0, Math.round(totalRaw));
    const percentAll = Math.max(0, Math.min(100, Number(percentAllRaw.toFixed(2))));
    const percentByClass = Math.max(0, Math.min(100, Number(percentByClassRaw.toFixed(2))));
    const classRange = classRangeRaw.slice(0, 20);
    const nickname = nicknameRaw.slice(0, 12);

    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            background: "linear-gradient(180deg, #111827 0%, #0f766e 55%, #022c22 100%)",
            color: "#ffffff",
            padding: "72px 64px",
            fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ fontSize: 42, fontWeight: 700, letterSpacing: "0.06em", color: "#99f6e4" }}>GYMTOOLS</div>
            <div style={{ fontSize: 44, fontWeight: 700 }}>짐툴 3대 퍼센트 분석</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "20px", textAlign: "center", marginTop: "20px" }}>
            <div style={{ fontSize: 88, fontWeight: 800, lineHeight: 1.1 }}>대한민국 상위 {percentAll}%</div>
            <div style={{ fontSize: 42, color: "#ccfbf1", fontWeight: 700 }}>{getTierMessage(percentAll)}</div>
            <div style={{ fontSize: 38, color: "#d1fae5" }}>
              {classRange} 체급 상위 {percentByClass}%
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ fontSize: 34 }}>닉네임: {nickname}</div>
            <div style={{ fontSize: 40, fontWeight: 700 }}>총합: {total}kg</div>
            <div style={{ marginTop: "10px", fontSize: 28, color: "#a7f3d0" }}>helchang.com</div>
          </div>
        </div>
      ),
      { width: 1080, height: 1920 }
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "unknown";
    return jsonError(500, "share_card_render_failed", { message });
  }
}
