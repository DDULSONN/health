import { ImageResponse } from "next/og";

export const runtime = "edge";

type CardTheme = {
  background: string;
  borderColor: string;
  headerColor: string;
  mainLabelColor: string;
  percentColor: string;
  subTextColor: string;
  metricColor: string;
  totalLabelColor: string;
  totalValueColor: string;
  nicknameColor: string;
  brandColor: string;
  dividerColor: string;
  badgeBg: string;
  badgeText: string;
  totalTopLine: string;
};

const normalTheme: CardTheme = {
  background: "linear-gradient(180deg, #F2F4F8 0%, #C9DAEF 100%)",
  borderColor: "rgba(255,255,255,0.65)",
  headerColor: "#111111",
  mainLabelColor: "#222222",
  percentColor: "#111111",
  subTextColor: "#444444",
  metricColor: "#111111",
  totalLabelColor: "#111111",
  totalValueColor: "#111111",
  nicknameColor: "#222222",
  brandColor: "#555555",
  dividerColor: "rgba(0,0,0,0.15)",
  badgeBg: "transparent",
  badgeText: "transparent",
  totalTopLine: "transparent",
};

const eliteTheme: CardTheme = {
  background: "linear-gradient(180deg, #F2F4F8 0%, #C9DAEF 100%)",
  borderColor: "rgba(200,168,74,0.55)",
  headerColor: "#111111",
  mainLabelColor: "#222222",
  percentColor: "#C8A84A",
  subTextColor: "#444444",
  metricColor: "#111111",
  totalLabelColor: "#111111",
  totalValueColor: "#C8A84A",
  nicknameColor: "#222222",
  brandColor: "#555555",
  dividerColor: "rgba(0,0,0,0.15)",
  badgeBg: "#111111",
  badgeText: "#F5D36C",
  totalTopLine: "#C8A84A",
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
  if (isElite) return "전국 최상위 레벨";
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
            background: theme.background,
            color: "#0F172A",
            fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
            border: `1px solid ${theme.borderColor}`,
            borderRadius: 48,
            overflow: "hidden",
            boxShadow: "0 16px 36px rgba(15, 23, 42, 0.14)",
            padding: "96px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: theme.headerColor }}>
            <div style={{ display: "flex", fontSize: 36, fontWeight: 600, letterSpacing: "0.04em" }}>GYMTOOLS</div>
            <div style={{ display: "flex", fontSize: 36, fontWeight: 600, letterSpacing: "0.04em" }}>3-LIFT PROFILE</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 24, marginTop: 40 }}>
            {isElite ? (
              <div
                style={{
                  display: "flex",
                  alignSelf: "flex-start",
                  borderRadius: 9999,
                  padding: "10px 24px",
                  background: theme.badgeBg,
                  color: theme.badgeText,
                  fontSize: 24,
                  fontWeight: 800,
                  letterSpacing: "0.04em",
                }}
              >
                TOP 1% CLUB
              </div>
            ) : null}

            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <span style={{ display: "flex", fontSize: 64, fontWeight: 600, color: theme.mainLabelColor }}>대한민국 상위</span>
              <span style={{ display: "flex", fontSize: 96, fontWeight: 700, color: theme.percentColor }}>{`${formatPercent(safePercentAll)}%`}</span>
            </div>

            <div style={{ display: "flex", fontSize: 36, fontWeight: 600, color: theme.subTextColor }}>{tagline}</div>
          </div>

          <div style={{ display: "flex", width: "100%", height: 1, background: theme.dividerColor, marginTop: 64, marginBottom: 64 }} />

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 40,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 48, fontWeight: 700, color: theme.metricColor, letterSpacing: "0.02em" }}>
              <span style={{ display: "flex" }}>{`S ${squatValue.replace("kg", "")}`}</span>
              <span style={{ display: "flex" }}>{`B ${benchValue.replace("kg", "")}`}</span>
              <span style={{ display: "flex" }}>{`D ${deadValue.replace("kg", "")}`}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {isElite ? <div style={{ display: "flex", width: "100%", height: 3, background: theme.totalTopLine }} /> : null}
              <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
                <span style={{ display: "flex", fontSize: 56, fontWeight: 600, color: theme.totalLabelColor }}>TOTAL</span>
                <span style={{ display: "flex", fontSize: 56, fontWeight: 700, color: theme.totalValueColor }}>{`${safeTotal}kg`}</span>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", fontSize: 36, color: theme.nicknameColor, fontWeight: 600, marginTop: 72 }}>{nickname}</div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto", paddingTop: 48 }}>
            <div style={{ display: "flex", fontSize: 28, color: theme.brandColor, fontWeight: 600 }}>GYMTOOLS · helchang.com</div>
          </div>
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
