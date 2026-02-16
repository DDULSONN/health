import { ImageResponse } from "next/og";

export const runtime = "edge";

type CardTheme = {
  background: string;
  borderColor: string;
  boxShadow: string;
  headerColor: string;
  mainLabelColor: string;
  percentColor: string;
  subTextColor: string;
  metricLabelColor: string;
  metricValueColor: string;
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
  background: "linear-gradient(180deg, #FFFFFF 0%, #F0EDFF 100%)",
  borderColor: "rgba(140,120,220,0.15)",
  boxShadow: "0 8px 32px rgba(108,92,231,0.08)",
  headerColor: "#999999",
  mainLabelColor: "#333333",
  percentColor: "#6C5CE7",
  subTextColor: "#888888",
  metricLabelColor: "#999999",
  metricValueColor: "#222222",
  totalLabelColor: "#999999",
  totalValueColor: "#222222",
  nicknameColor: "#555555",
  brandColor: "#AAAAAA",
  dividerColor: "rgba(108,92,231,0.12)",
  badgeBg: "transparent",
  badgeText: "transparent",
  totalTopLine: "transparent",
};

const eliteTheme: CardTheme = {
  background: "linear-gradient(180deg, #FFFDF5 0%, #FFF8E7 100%)",
  borderColor: "rgba(200,168,74,0.25)",
  boxShadow: "0 8px 32px rgba(212,160,23,0.08)",
  headerColor: "#999999",
  mainLabelColor: "#333333",
  percentColor: "#D4A017",
  subTextColor: "#888888",
  metricLabelColor: "#999999",
  metricValueColor: "#222222",
  totalLabelColor: "#999999",
  totalValueColor: "#222222",
  nicknameColor: "#555555",
  brandColor: "#AAAAAA",
  dividerColor: "rgba(212,160,23,0.15)",
  badgeBg: "#1A1A2E",
  badgeText: "#F5D36C",
  totalTopLine: "#D4A017",
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
  return `${Math.round(n)}`;
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
            fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
            border: `1px solid ${theme.borderColor}`,
            borderRadius: 32,
            overflow: "hidden",
            boxShadow: theme.boxShadow,
            padding: "80px 72px",
          }}
        >
          {/* 헤더 — 1줄, 왼쪽 정렬, 작고 가벼움 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              color: theme.headerColor,
            }}
          >
            <span style={{ display: "flex", fontSize: 28, fontWeight: 700, letterSpacing: "0.08em" }}>GYMTOOLS</span>
            <span style={{ display: "flex", fontSize: 28, fontWeight: 400, letterSpacing: "0.08em" }}>·</span>
            <span style={{ display: "flex", fontSize: 28, fontWeight: 400, letterSpacing: "0.08em" }}>3-LIFT PROFILE</span>
          </div>

          {/* 메인 퍼센트 — 중앙, flex-grow로 수직 배분 */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              flexGrow: 1,
              gap: 20,
            }}
          >
            {/* Elite 배지 */}
            {isElite ? (
              <div
                style={{
                  display: "flex",
                  borderRadius: 9999,
                  padding: "8px 28px",
                  background: theme.badgeBg,
                  color: theme.badgeText,
                  fontSize: 24,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                }}
              >
                TOP 1% CLUB
              </div>
            ) : null}

            {/* 대한민국 상위 {percentAll}% */}
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 14 }}>
              <span style={{ display: "flex", fontSize: 52, fontWeight: 500, color: theme.mainLabelColor }}>대한민국 상위</span>
              <span style={{ display: "flex", fontSize: 96, fontWeight: 800, color: theme.percentColor }}>{`${formatPercent(safePercentAll)}%`}</span>
            </div>

            {/* 태그라인 */}
            <div style={{ display: "flex", fontSize: 30, fontWeight: 400, color: theme.subTextColor }}>{tagline}</div>
          </div>

          {/* 분리선 */}
          <div style={{ display: "flex", width: "100%", height: 1, background: theme.dividerColor, marginTop: 8, marginBottom: 48 }} />

          {/* S/B/D — 중앙, 라벨 연하게 + 숫자 Bold */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "baseline",
              gap: 20,
              letterSpacing: "0.01em",
            }}
          >
            <span style={{ display: "flex", fontSize: 44, fontWeight: 400, color: theme.metricLabelColor }}>S</span>
            <span style={{ display: "flex", fontSize: 44, fontWeight: 700, color: theme.metricValueColor }}>{squatValue}</span>
            <span style={{ display: "flex", fontSize: 36, fontWeight: 300, color: theme.dividerColor, marginLeft: 8, marginRight: 8 }}>·</span>
            <span style={{ display: "flex", fontSize: 44, fontWeight: 400, color: theme.metricLabelColor }}>B</span>
            <span style={{ display: "flex", fontSize: 44, fontWeight: 700, color: theme.metricValueColor }}>{benchValue}</span>
            <span style={{ display: "flex", fontSize: 36, fontWeight: 300, color: theme.dividerColor, marginLeft: 8, marginRight: 8 }}>·</span>
            <span style={{ display: "flex", fontSize: 44, fontWeight: 400, color: theme.metricLabelColor }}>D</span>
            <span style={{ display: "flex", fontSize: 44, fontWeight: 700, color: theme.metricValueColor }}>{deadValue}</span>
          </div>

          {/* TOTAL — 2줄 중앙 */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              marginTop: 36,
              gap: 4,
            }}
          >
            {isElite ? <div style={{ display: "flex", width: 120, height: 3, background: theme.totalTopLine, marginBottom: 8 }} /> : null}
            <div style={{ display: "flex", fontSize: 24, fontWeight: 600, color: theme.totalLabelColor, letterSpacing: "0.12em" }}>TOTAL</div>
            <div style={{ display: "flex", fontSize: 56, fontWeight: 700, color: theme.totalValueColor }}>{`${safeTotal}kg`}</div>
          </div>

          {/* 닉네임 */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              fontSize: 32,
              color: theme.nicknameColor,
              fontWeight: 500,
              marginTop: 48,
            }}
          >
            {nickname}
          </div>

          {/* 푸터 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginTop: "auto",
              paddingTop: 40,
            }}
          >
            <div style={{ display: "flex", fontSize: 24, color: theme.brandColor, fontWeight: 400, letterSpacing: "0.04em" }}>GYMTOOLS · helchang.com</div>
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
