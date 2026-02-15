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

function formatPercent(value: number): string {
  return value.toFixed(1);
}

function getTagline(percentAll: number): string {
  if (percentAll <= 1) return "전국 상위 1% 괴물";
  if (percentAll <= 5) return "상위 5% 엘리트";
  if (percentAll <= 15) return "상위 15% 헬창";
  if (percentAll <= 30) return "상위 30% 상위권";
  return "성장 중 - 다음 기록이 기대돼요";
}

function chipStyle() {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9999,
    border: "1px solid rgba(255,255,255,0.24)",
    background: "rgba(255,255,255,0.08)",
    color: "#E6E9F4",
    fontSize: 30,
    fontWeight: 600,
    padding: "12px 24px",
    letterSpacing: "0.02em",
  } as const;
}

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;

    const total = Number(sp.get("total") ?? "440");
    const percentAll = Number(sp.get("percentAll") ?? "4");
    const percentByClass = Number(sp.get("percentByClass") ?? "41.2");
    const classRange = (sp.get("classRange") ?? "83~93kg").trim();
    const nickname = (sp.get("nickname") ?? "GymTools").trim();

    if (!Number.isFinite(total) || !Number.isFinite(percentAll) || !Number.isFinite(percentByClass)) {
      return jsonError(400, "invalid_number_params", {
        total: sp.get("total"),
        percentAll: sp.get("percentAll"),
        percentByClass: sp.get("percentByClass"),
      });
    }

    if (!nickname || nickname.length > 12 || !/^[0-9A-Za-z가-힣_]+$/.test(nickname)) return jsonError(400, "invalid_nickname");
    if (!classRange || classRange.length > 24) return jsonError(400, "invalid_classRange");

    const safeTotal = Math.max(0, Math.round(total));
    const safePercentAll = Math.max(0, Math.min(100, percentAll));
    const safePercentByClass = Math.max(0, Math.min(100, percentByClass));
    const tagline = getTagline(safePercentAll);

    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            position: "relative",
            padding: 72,
            justifyContent: "space-between",
            background:
              "linear-gradient(160deg, #0B0F1A 0%, #10172B 46%, #0A0A0A 100%)",
            color: "#F6F8FF",
            overflow: "hidden",
            fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          }}
        >
          <div
            style={{
              display: "flex",
              position: "absolute",
              width: 520,
              height: 520,
              borderRadius: 9999,
              background: "radial-gradient(circle, rgba(109,94,246,0.32) 0%, rgba(109,94,246,0) 70%)",
              top: -120,
              right: -110,
            }}
          />
          <div
            style={{
              display: "flex",
              position: "absolute",
              width: 620,
              height: 620,
              borderRadius: 9999,
              background: "radial-gradient(circle, rgba(39,224,179,0.24) 0%, rgba(39,224,179,0) 72%)",
              bottom: -220,
              left: -170,
            }}
          />
          <div
            style={{
              display: "flex",
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(0deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0) 30%)",
            }}
          />

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              zIndex: 1,
            }}
          >
            <div style={{ display: "flex", fontSize: 46, fontWeight: 800, letterSpacing: "0.04em" }}>GYMTOOLS</div>
            <div style={{ display: "flex", fontSize: 30, color: "#B9C0D9", fontWeight: 500 }}>helchang.com</div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 26,
              zIndex: 1,
              textAlign: "center",
            }}
          >
            <div style={{ ...chipStyle(), fontSize: 28 }}>{`TOP ${formatPercent(safePercentAll)}%`}</div>
            <div style={{ display: "flex", fontSize: 48, fontWeight: 600, color: "#D4D9EC" }}>짐툴 3대 퍼센트 분석</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, fontWeight: 900, letterSpacing: "-0.02em" }}>
              <span style={{ display: "flex", fontSize: 74, color: "#EEF1FF" }}>대한민국 상위</span>
              <span style={{ display: "flex", fontSize: 132, color: "#6D5EF6" }}>{`${formatPercent(safePercentAll)}%`}</span>
            </div>
            <div style={{ display: "flex", fontSize: 46, fontWeight: 600, color: "#E3E7F7" }}>
              {`${classRange} 체급 상위 ${formatPercent(safePercentByClass)}%`}
            </div>
            <div style={{ display: "flex", fontSize: 34, color: "#9BA4C5", fontWeight: 500 }}>{tagline}</div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 22,
              zIndex: 1,
            }}
          >
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <div style={chipStyle()}>{classRange}</div>
              <div style={chipStyle()}>{`TOTAL ${safeTotal}kg`}</div>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                border: "1px solid rgba(255,255,255,0.18)",
                borderRadius: 24,
                background: "rgba(8, 10, 18, 0.55)",
                padding: "18px 24px",
              }}
            >
              <div style={{ display: "flex", fontSize: 30, color: "#BFC7DF" }}>닉네임</div>
              <div style={{ display: "flex", fontSize: 42, fontWeight: 800, color: "#FFFFFF" }}>{nickname}</div>
            </div>
            <div style={{ display: "flex", fontSize: 30, color: "#AAB3CE", justifyContent: "center" }}>
              짐툴에서 확인하기 - helchang.com
            </div>
          </div>
        </div>
      ),
      {
        width: 1080,
        height: 1920,
        headers: { "cache-control": "no-store" },
      }
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "unknown";
    return jsonError(500, "share_card_render_failed", { message });
  }
}
