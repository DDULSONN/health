import { ImageResponse } from "next/og";

export const runtime = "edge";

type CardTheme = {
  background: string;
  border: string;
  titleColor: string;
  subtitleColor: string;
  percentColor: string;
  totalColor: string;
  metricBoxBg: string;
  metricBoxBorder: string;
  topLine: string;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
  sealBorder: string;
  sealText: string;
};

const normalTheme: CardTheme = {
  background: "linear-gradient(180deg, #f8fbff 0%, #eef4ff 50%, #f4f8ff 100%)",
  border: "1px solid #dbe4f2",
  titleColor: "#1e293b",
  subtitleColor: "#64748b",
  percentColor: "#5b4cf0",
  totalColor: "#2f3ca8",
  metricBoxBg: "rgba(255,255,255,0.65)",
  metricBoxBorder: "1px solid #d6e1ef",
  topLine: "transparent",
  badgeBg: "rgba(91,76,240,0.1)",
  badgeBorder: "1px solid rgba(91,76,240,0.3)",
  badgeText: "#4c3fd6",
  sealBorder: "#94a3b8",
  sealText: "#475569",
};

const eliteTheme: CardTheme = {
  background: "linear-gradient(180deg, #fffaf0 0%, #fff4d9 42%, #fef0c7 100%)",
  border: "2px solid #d4a826",
  titleColor: "#422006",
  subtitleColor: "#7c5a10",
  percentColor: "#b8860b",
  totalColor: "#9a6700",
  metricBoxBg: "rgba(255,252,240,0.88)",
  metricBoxBorder: "1px solid #e6c977",
  topLine: "#d4a826",
  badgeBg: "linear-gradient(180deg, #ffe8a3 0%, #f8cd5e 100%)",
  badgeBorder: "1px solid #c6921f",
  badgeText: "#5c3d00",
  sealBorder: "#c6921f",
  sealText: "#7c5700",
};

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

function formatLiftValue(value: string | null): string {
  if (!value) return "-";
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return `${Math.round(n)}kg`;
}

function getTagline(percentAll: number, isElite: boolean): string {
  if (isElite) return "상위 1% 미만 · 극소수";
  if (percentAll <= 5) return "상위 5% 엘리트";
  if (percentAll <= 15) return "상위 15% 헬창";
  if (percentAll <= 30) return "상위 30% 상위권";
  return "성장 중 - 다음 기록이 기대돼요";
}

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;

    const total = Number(sp.get("total") ?? "440");
    const percentAll = Number(sp.get("percentAll") ?? "4");
    const nickname = (sp.get("nickname") ?? "GymTools").trim();
    const squatValue = formatLiftValue(sp.get("squat"));
    const benchValue = formatLiftValue(sp.get("bench"));
    const deadValue = formatLiftValue(sp.get("dead"));

    if (!Number.isFinite(total) || !Number.isFinite(percentAll)) {
      return jsonError(400, "invalid_number_params", {
        total: sp.get("total"),
        percentAll: sp.get("percentAll"),
      });
    }

    if (!nickname || nickname.length > 12 || !/^[0-9A-Za-z가-힣_]+$/.test(nickname)) {
      return jsonError(400, "invalid_nickname");
    }

    const safeTotal = Math.max(0, Math.round(total));
    const safePercentAll = Math.max(0, Math.min(100, percentAll));
    const isElite = safePercentAll <= 1.0;
    const theme = isElite ? eliteTheme : normalTheme;
    const tagline = getTagline(safePercentAll, isElite);

    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            background: theme.background,
            color: "#0F172A",
            fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
            border: theme.border,
            borderRadius: 28,
            overflow: "hidden",
            padding: "58px 62px",
            position: "relative",
          }}
        >
          {isElite ? <div style={{ display: "flex", position: "absolute", top: 0, left: 0, right: 0, height: 6, background: theme.topLine }} /> : null}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", fontSize: 38, fontWeight: 800, letterSpacing: "0.05em", color: theme.titleColor }}>GYMTOOLS</div>
            <div style={{ display: "flex", fontSize: 21, color: theme.subtitleColor, letterSpacing: "0.08em", fontWeight: 700 }}>3-LIFT PROFILE</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {isElite ? (
              <div
                style={{
                  display: "flex",
                  alignSelf: "flex-start",
                  borderRadius: 9999,
                  padding: "10px 20px",
                  background: theme.badgeBg,
                  border: theme.badgeBorder,
                  color: theme.badgeText,
                  fontSize: 20,
                  fontWeight: 800,
                  letterSpacing: "0.04em",
                }}
              >
                TOP 1% CLUB
              </div>
            ) : null}

            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <span style={{ display: "flex", fontSize: 54, fontWeight: 700, color: theme.titleColor }}>대한민국 상위</span>
              <span style={{ display: "flex", fontSize: 140, fontWeight: 900, color: theme.percentColor, letterSpacing: "-0.03em" }}>{`${formatPercent(safePercentAll)}%`}</span>
            </div>

            <div style={{ display: "flex", fontSize: 33, fontWeight: 600, color: theme.subtitleColor }}>{tagline}</div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
              border: theme.metricBoxBorder,
              borderRadius: 22,
              background: theme.metricBoxBg,
              padding: "24px 26px",
            }}
          >
            <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: theme.titleColor }}>{`SQUAT ${squatValue}  |  BENCH ${benchValue}  |  DEAD ${deadValue}`}</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", fontSize: 46, fontWeight: 900, color: theme.totalColor }}>{`TOTAL ${safeTotal}kg`}</div>
              <div style={{ display: "flex", fontSize: 32, fontWeight: 700, color: theme.subtitleColor }}>{`닉네임 ${nickname}`}</div>
            </div>
          </div>

          <div style={{ display: "flex", borderTop: "1px solid #d8e2f1", paddingTop: 18, alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", fontSize: 24, color: theme.subtitleColor, fontWeight: 700 }}>helchang.com</div>
            <div style={{ display: "flex", fontSize: 24, color: theme.subtitleColor, fontWeight: 700 }}>GYMTOOLS</div>
          </div>

          {isElite ? (
            <div
              style={{
                display: "flex",
                position: "absolute",
                right: 34,
                bottom: 110,
                width: 128,
                height: 128,
                borderRadius: 9999,
                border: `2px solid ${theme.sealBorder}`,
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(255,255,255,0.55)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  width: 108,
                  height: 108,
                  borderRadius: 9999,
                  border: `1px solid ${theme.sealBorder}`,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", textAlign: "center", color: theme.sealText, gap: 2 }}>
                  <span style={{ display: "flex", justifyContent: "center", fontSize: 11, fontWeight: 800 }}>GYMTOOLS</span>
                  <span style={{ display: "flex", justifyContent: "center", fontSize: 12, fontWeight: 900 }}>TOP 1%</span>
                  <span style={{ display: "flex", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>★ ★ ★</span>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ),
      {
        width: 1080,
        height: 1350,
        headers: { "cache-control": "no-store" },
      }
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "unknown";
    return jsonError(500, "share_card_render_failed", { message });
  }
}
