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

    if (!nickname || nickname.length > 12) return jsonError(400, "invalid_nickname");
    if (!classRange || classRange.length > 24) return jsonError(400, "invalid_classRange");

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
            backgroundColor: "#111111",
            color: "#ffffff",
            fontSize: 56,
            fontWeight: 700,
            gap: 20,
          }}
        >
          <div style={{ display: "flex" }}>GYMTOOLS SHARE CARD OK</div>
          <div style={{ display: "flex" }}>{`${nickname} / ${Math.round(total)}kg`}</div>
          <div style={{ display: "flex" }}>{`${percentAll}% / ${percentByClass}% / ${classRange}`}</div>
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
