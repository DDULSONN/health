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

function fmtLift(v: string | null): string {
  if (!v) return "-";
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return String(Math.round(n));
}

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;

    const totalRaw = sp.get("total");
    const percentRaw = sp.get("percentAll");

    if (totalRaw == null || percentRaw == null) {
      return jsonError(400, "missing_params", {
        hint: "total and percentAll are required",
      });
    }

    const total = Number(totalRaw);
    const percentAll = Number(percentRaw);

    if (!Number.isFinite(total) || total < 0) {
      return jsonError(400, "invalid_total", { total: totalRaw });
    }
    if (!Number.isFinite(percentAll) || percentAll < 0) {
      return jsonError(400, "invalid_percentAll", { percentAll: percentRaw });
    }

    const nickname = (sp.get("nickname") ?? "").trim();
    if (nickname && (nickname.length > 12 || !/^[0-9A-Za-z가-힣_]+$/.test(nickname))) {
      return jsonError(400, "invalid_nickname");
    }

    const safeTotal = Math.max(0, Math.round(total));
    const safePercent = Math.max(0, Math.min(100, percentAll));
    const totalLb = kgToLb(safeTotal);
    const squat = fmtLift(sp.get("squat"));
    const bench = fmtLift(sp.get("bench"));
    const dead = fmtLift(sp.get("dead"));
    const hasNickname = nickname.length > 0;

    const sexRaw = (sp.get("sex") ?? sp.get("gender") ?? "").toLowerCase();
    const sexLabel =
      sexRaw === "male" || sexRaw === "m" ? "남성 기준" :
      sexRaw === "female" || sexRaw === "f" ? "여성 기준" :
      "전체 기준";

    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            background: "#FDF2F2",
            fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
            borderRadius: 28,
            border: "1px solid #F3B3B3",
            padding: "44px",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          {/* ─── Top: 라벨 + 퍼센트 ─── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", fontSize: 17, fontWeight: 500, color: "#AAAAAA", letterSpacing: "0.05em" }}>
              3대 합계
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ display: "flex", fontSize: 30, fontWeight: 500, color: "#444444" }}>대한민국 상위</span>
              <span style={{ display: "flex", fontSize: 34, fontWeight: 800, color: "#C0392B" }}>{`${safePercent.toFixed(1)}%`}</span>
            </div>
            <div style={{ display: "flex", fontSize: 15, fontWeight: 400, color: "rgba(0,0,0,0.4)", marginTop: 6 }}>
              {sexLabel}
            </div>
          </div>

          {/* ─── Middle: S/B/D + TOTAL + lb ─── */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            {/* S/B/D */}
            <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 8 }}>
              <span style={{ display: "flex", fontSize: 26, fontWeight: 400, color: "#999999" }}>S</span>
              <span style={{ display: "flex", fontSize: 26, fontWeight: 700, color: "#333333" }}>{squat}</span>
              <span style={{ display: "flex", fontSize: 22, color: "#CCCCCC" }}>·</span>
              <span style={{ display: "flex", fontSize: 26, fontWeight: 400, color: "#999999" }}>B</span>
              <span style={{ display: "flex", fontSize: 26, fontWeight: 700, color: "#333333" }}>{bench}</span>
              <span style={{ display: "flex", fontSize: 22, color: "#CCCCCC" }}>·</span>
              <span style={{ display: "flex", fontSize: 26, fontWeight: 400, color: "#999999" }}>D</span>
              <span style={{ display: "flex", fontSize: 26, fontWeight: 700, color: "#333333" }}>{dead}</span>
            </div>

            {/* TOTAL */}
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ display: "flex", fontSize: 18, fontWeight: 600, color: "#999999", letterSpacing: "0.08em", marginRight: 4 }}>TOTAL</span>
              <span style={{ display: "flex", fontSize: 60, fontWeight: 800, color: "#C0392B" }}>{safeTotal}</span>
              <span style={{ display: "flex", fontSize: 32, fontWeight: 600, color: "#C0392B" }}>kg</span>
            </div>

            {/* lb */}
            <div style={{ display: "flex", fontSize: 22, fontWeight: 500, color: "#D35F5F" }}>
              {`${totalLb} lb`}
            </div>
          </div>

          {/* ─── Bottom: 닉네임 + 푸터 ─── */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div style={{ display: "flex", fontSize: 18, fontWeight: 400, color: "#AAAAAA" }}>
              {hasNickname ? nickname : ""}
            </div>
            <div style={{ display: "flex", fontSize: 15, fontWeight: 400, color: "#CCCCCC", letterSpacing: "0.03em" }}>
              GYMTOOLS · helchang.com
            </div>
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
