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

function parseNumber(raw: string | null, fallback: number) {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.NaN;
}

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;

    const totalRaw = parseNumber(sp.get("total"), 0);
    const percentAllRaw = parseNumber(sp.get("percentAll"), 30);
    const percentByClassRaw = parseNumber(sp.get("percentByClass"), 30);
    const classRangeRaw = (sp.get("classRange") || "체급 정보 없음").trim();
    const nicknameRaw = (sp.get("nickname") || "GymTools").trim();

    if (!Number.isFinite(totalRaw) || !Number.isFinite(percentAllRaw) || !Number.isFinite(percentByClassRaw)) {
      return jsonError(400, "invalid_number_params", {
        total: sp.get("total"),
        percentAll: sp.get("percentAll"),
        percentByClass: sp.get("percentByClass"),
      });
    }

    if (!nicknameRaw || nicknameRaw.length > 12) {
      return jsonError(400, "invalid_nickname", { nickname: sp.get("nickname") });
    }

    if (!classRangeRaw || classRangeRaw.length > 24) {
      return jsonError(400, "invalid_classRange", { classRange: sp.get("classRange") });
    }

    const total = Math.max(0, Math.round(totalRaw));
    const percentAll = Math.max(0, Math.min(100, Number(percentAllRaw.toFixed(2))));
    const percentByClass = Math.max(0, Math.min(100, Number(percentByClassRaw.toFixed(2))));
    const classRange = classRangeRaw.slice(0, 24);
    const nickname = nicknameRaw.slice(0, 12);

    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#0f172a",
            color: "#ffffff",
            fontFamily: "system-ui, -apple-system, sans-serif",
            gap: 20,
            padding: 48,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 48, fontWeight: 800 }}>GYMTOOLS SHARE CARD</div>
          <div style={{ fontSize: 34, fontWeight: 700 }}>GYMTOOLS OK · {nickname} · {total}kg</div>
          <div style={{ fontSize: 62, fontWeight: 900 }}>대한민국 상위 {percentAll}%</div>
          <div style={{ fontSize: 34 }}>{classRange} 체급 상위 {percentByClass}%</div>
          <div style={{ fontSize: 26, opacity: 0.85 }}>helchang.com</div>
        </div>
      ),
      {
        width: 1080,
        height: 1920,
        headers: {
          "cache-control": "no-store",
        },
      }
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "unknown";
    return jsonError(500, "share_card_render_failed", { message });
  }
}
