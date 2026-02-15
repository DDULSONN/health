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

function formatLiftValue(value: string | null): string {
  if (!value) return "-";
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return `${Math.round(n)}kg`;
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
    const squatValue = formatLiftValue(sp.get("squat"));
    const benchValue = formatLiftValue(sp.get("bench"));
    const deadValue = formatLiftValue(sp.get("dead"));

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
    const classPercentile = 100 - safePercentByClass;
    const tagline = getTagline(safePercentAll);
    const needsReferenceNote = safePercentByClass - safePercentAll >= 20;

    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            position: "relative",
            alignItems: "center",
            justifyContent: "center",
            background:
              "linear-gradient(165deg, #d9e4fb 0%, #cddcf7 38%, #d9f2ec 100%)",
            color: "#0f172a",
            overflow: "hidden",
            fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          }}
        >
          <div
            style={{
              display: "flex",
              position: "absolute",
              width: 680,
              height: 680,
              borderRadius: 9999,
              background: "radial-gradient(circle, rgba(109,94,246,0.22) 0%, rgba(109,94,246,0) 72%)",
              top: -150,
              right: -140,
            }}
          />
          <div
            style={{
              display: "flex",
              position: "absolute",
              width: 740,
              height: 740,
              borderRadius: 9999,
              background: "radial-gradient(circle, rgba(39,224,179,0.24) 0%, rgba(39,224,179,0) 75%)",
              bottom: -260,
              left: -180,
            }}
          />

          <div
            style={{
              display: "flex",
              width: 900,
              height: 1280,
              justifyContent: "space-between",
              flexDirection: "column",
              borderRadius: 40,
              border: "1px solid rgba(255,255,255,0.55)",
              background: "linear-gradient(180deg, rgba(255,255,255,0.34) 0%, rgba(255,255,255,0.14) 100%)",
              boxShadow: "0 24px 60px rgba(31, 41, 55, 0.18)",
              padding: "52px 54px",
              zIndex: 1,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 34 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div style={{ display: "flex", fontSize: 42, fontWeight: 800, letterSpacing: "0.04em", color: "#1E293B" }}>GYMTOOLS</div>
                <div style={{ display: "flex", fontSize: 28, fontWeight: 600, color: "#334155" }}>helchang.com</div>
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: 28,
                  fontWeight: 600,
                  color: "#334155",
                }}
              >
                짐툴 3대 퍼센트 분석
              </div>

              <div
                style={{
                  ...chipStyle(),
                  width: 226,
                  color: "#4338CA",
                  border: "1px solid rgba(67,56,202,0.22)",
                  background: "rgba(255,255,255,0.56)",
                  fontSize: 25,
                }}
              >
                {`TOP ${formatPercent(safePercentAll)}%`}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, letterSpacing: "-0.01em" }}>
                  <span style={{ display: "flex", fontSize: 64, fontWeight: 800, color: "#0F172A" }}>대한민국 상위</span>
                  <span style={{ display: "flex", fontSize: 120, fontWeight: 900, color: "#5B4CF0" }}>
                    {`${formatPercent(safePercentAll)}%`}
                  </span>
                </div>
                <div style={{ display: "flex", fontSize: 32, fontWeight: 600, color: "#334155" }}>{tagline}</div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ display: "flex", gap: 12 }}>
                <div
                  style={{
                    ...chipStyle(),
                    flex: 1,
                    borderRadius: 22,
                    justifyContent: "space-between",
                    background: "rgba(255,255,255,0.48)",
                    border: "1px solid rgba(255,255,255,0.66)",
                    color: "#1E293B",
                    padding: "14px 16px",
                    fontSize: 24,
                  }}
                >
                  <span style={{ display: "flex", fontWeight: 600, color: "#475569" }}>SQUAT</span>
                  <span style={{ display: "flex", fontWeight: 800 }}>{squatValue}</span>
                </div>
                <div
                  style={{
                    ...chipStyle(),
                    flex: 1,
                    borderRadius: 22,
                    justifyContent: "space-between",
                    background: "rgba(255,255,255,0.48)",
                    border: "1px solid rgba(255,255,255,0.66)",
                    color: "#1E293B",
                    padding: "14px 16px",
                    fontSize: 24,
                  }}
                >
                  <span style={{ display: "flex", fontWeight: 600, color: "#475569" }}>BENCH</span>
                  <span style={{ display: "flex", fontWeight: 800 }}>{benchValue}</span>
                </div>
                <div
                  style={{
                    ...chipStyle(),
                    flex: 1,
                    borderRadius: 22,
                    justifyContent: "space-between",
                    background: "rgba(255,255,255,0.48)",
                    border: "1px solid rgba(255,255,255,0.66)",
                    color: "#1E293B",
                    padding: "14px 16px",
                    fontSize: 24,
                  }}
                >
                  <span style={{ display: "flex", fontWeight: 600, color: "#475569" }}>DEAD</span>
                  <span style={{ display: "flex", fontWeight: 800 }}>{deadValue}</span>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                <div
                  style={{
                    ...chipStyle(),
                    borderRadius: 18,
                    background: "rgba(91,76,240,0.9)",
                    border: "1px solid rgba(91,76,240,1)",
                    color: "#FFFFFF",
                    fontWeight: 800,
                    fontSize: 32,
                    padding: "12px 24px",
                  }}
                >
                  {`TOTAL ${safeTotal}kg`}
                </div>
                <div style={{ display: "flex", fontSize: 32, fontWeight: 700, color: "#1F2937" }}>{`닉네임 · ${nickname}`}</div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
                <div style={{ display: "flex", fontSize: 24, color: "#475569", fontWeight: 600 }}>
                  {`참고: ${classRange} 체급 백분위 ${formatPercent(classPercentile)}`}
                </div>
                {needsReferenceNote ? (
                  <div style={{ display: "flex", fontSize: 18, color: "#64748B" }}>
                    ※ 체급 기준은 표본/모델 차이로 참고용입니다
                  </div>
                ) : null}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "center",
                fontSize: 28,
                fontWeight: 600,
                color: "#334155",
                borderTop: "1px solid rgba(255,255,255,0.62)",
                paddingTop: 20,
              }}
            >
              짐툴에서 확인하기 → helchang.com
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
