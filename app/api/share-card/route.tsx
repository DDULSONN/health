import { ImageResponse } from "next/og";

export const runtime = "edge";

function jsonError(status: number, code: string, extra?: Record<string, unknown>) {
  return new Response(JSON.stringify({ error: code, ...(extra ?? {}) }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function kgToLb(kg: number): number {
  return Math.round(kg * 2.2046226218);
}

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;

    const total = Number(sp.get("total") ?? "0");
    const nickname = (sp.get("nickname") ?? "").trim();

    if (!Number.isFinite(total) || total < 0) {
      return jsonError(400, "invalid_total", { total: sp.get("total") });
    }

    if (nickname && (nickname.length > 12 || !/^[0-9A-Za-z가-힣_]+$/.test(nickname))) {
      return jsonError(400, "invalid_nickname");
    }

    const safeTotal = Math.max(0, Math.round(total));
    const totalLb = kgToLb(safeTotal);
    const hasNickname = nickname.length > 0;

    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "white",
            fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          }}
        >
          {/* 카드 */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              width: 820,
              height: 360,
              background: "#FCECEC",
              borderRadius: 28,
              border: "1px solid rgba(220,80,80,0.2)",
              boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
              padding: "0 40px",
              gap: 0,
            }}
          >
            {/* 라벨 */}
            <div style={{ display: "flex", fontSize: 18, fontWeight: 500, color: "#999999", letterSpacing: "0.06em", marginBottom: 12 }}>
              3대 합계
            </div>

            {/* 메인 숫자 */}
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ display: "flex", fontSize: 60, fontWeight: 800, color: "#C0392B" }}>{safeTotal}</span>
              <span style={{ display: "flex", fontSize: 36, fontWeight: 600, color: "#C0392B" }}>kg</span>
            </div>

            {/* lb 환산 */}
            <div style={{ display: "flex", fontSize: 24, fontWeight: 500, color: "#D35F5F", marginTop: 8 }}>
              {`${totalLb} lb`}
            </div>

            {/* 닉네임 (있을 때만) */}
            {hasNickname ? (
              <div style={{ display: "flex", fontSize: 16, fontWeight: 400, color: "#AAAAAA", marginTop: 20 }}>
                {nickname}
              </div>
            ) : null}
          </div>
        </div>
      ),
      {
        width: 900,
        height: 420,
        headers: { "cache-control": "no-store" },
      }
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "unknown";
    return jsonError(500, "share_card_render_failed", { message });
  }
}
