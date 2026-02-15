import { ImageResponse } from "@vercel/og";

export const runtime = "edge";

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
    const { searchParams } = new URL(req.url);

    const totalRaw = asNumber(searchParams.get("total"));
    const percentAllRaw = asNumber(searchParams.get("percentAll"));
    const percentByClassRaw = asNumber(searchParams.get("percentByClass"));
    const classRange = (searchParams.get("classRange") || "").trim();
    const nickname = sanitizeNickname(searchParams.get("nickname") || "");

    if (!Number.isFinite(totalRaw) || !Number.isFinite(percentAllRaw) || !Number.isFinite(percentByClassRaw)) {
      return new Response(JSON.stringify({ error: "invalid_number_params" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    if (!nickname) {
      return new Response(JSON.stringify({ error: "missing_nickname" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const total = Math.max(0, Math.round(totalRaw));
    const percentAll = Math.max(0, Math.min(100, Number(percentAllRaw.toFixed(2))));
    const percentByClass = Math.max(0, Math.min(100, Number(percentByClassRaw.toFixed(2))));
    const safeClassRange = (classRange || "체급 정보 없음").slice(0, 28);
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
    return new Response(JSON.stringify({ error: "share_card_render_failed", message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
