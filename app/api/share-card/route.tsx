import { ImageResponse } from "next/og";

export const runtime = "edge";

function jsonError(status: number, code: string, extra?: Record<string, unknown>) {
  return new Response(JSON.stringify({ error: code, ...(extra ?? {}) }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function asNumber(raw: string | null): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : Number.NaN;
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

    const totalRaw = asNumber(sp.get("total"));
    const percentAllRaw = asNumber(sp.get("percentAll"));
    const percentByClassRaw = asNumber(sp.get("percentByClass"));
    const classRange = (sp.get("classRange") || "").trim();
    const nickname = sanitizeNickname(sp.get("nickname") || "");

    if (!Number.isFinite(totalRaw) || !Number.isFinite(percentAllRaw) || !Number.isFinite(percentByClassRaw)) {
      return jsonError(400, "invalid_number_params", {
        total: sp.get("total"),
        percentAll: sp.get("percentAll"),
        percentByClass: sp.get("percentByClass"),
      });
    }

    if (!nickname || nickname.length > 12) {
      return jsonError(400, "invalid_nickname");
    }

    if (!classRange || classRange.length > 20) {
      return jsonError(400, "invalid_classRange");
    }

    const total = Math.max(0, Math.round(totalRaw));
    const percentAll = Math.max(0, Math.min(100, Number(percentAllRaw.toFixed(2))));
    const percentByClass = Math.max(0, Math.min(100, Number(percentByClassRaw.toFixed(2))));
    const safeClassRange = classRange.slice(0, 20);
    const safeNickname = nickname.slice(0, 12);

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
              {safeClassRange} 체급 상위 {percentByClass}%
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ fontSize: 34 }}>닉네임: {safeNickname}</div>
            <div style={{ fontSize: 40, fontWeight: 700 }}>총합: {total}kg</div>
            <div style={{ marginTop: "10px", fontSize: 28, color: "#a7f3d0" }}>helchang.com</div>
          </div>
        </div>
      ),
      {
        width: 1080,
        height: 1920,
      }
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "unknown";
    return jsonError(500, "share_card_render_failed", { message });
  }
}
