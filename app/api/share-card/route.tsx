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

    if (!nickname || nickname.length > 12 || !/^[0-9A-Za-z가-힣_]+$/.test(nickname)) {
      return jsonError(400, "invalid_nickname");
    }
    if (!classRange || classRange.length > 24) return jsonError(400, "invalid_classRange");

    const safeTotal = Math.max(0, Math.round(total));
    const safePercentAll = Math.max(0, Math.min(100, percentAll));
    const safePercentByClass = Math.max(0, Math.min(100, percentByClass));
    const classPercentile = 100 - safePercentByClass;
    const tagline = getTagline(safePercentAll);
    const needsReferenceNote = safePercentByClass - safePercentAll >= 20;
    const now = new Date();
    const issueDate = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(
      now.getDate()
    ).padStart(2, "0")}`;

    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            background: "#F7F8FB",
            color: "#0F172A",
            border: "1px solid #D4D9E5",
            fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              height: 166,
              padding: "34px 62px",
              alignItems: "center",
              justifyContent: "space-between",
              background: "linear-gradient(180deg, #1E2634 0%, #2B3444 100%)",
              color: "#F8FAFC",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", fontSize: 52, fontWeight: 800, letterSpacing: "0.09em" }}>
                GYMTOOLS CERTIFICATE
              </div>
              <div style={{ display: "flex", fontSize: 17, letterSpacing: "0.24em", opacity: 0.88 }}>
                OF 3-LIFT TOTAL
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
              <div style={{ display: "flex", fontSize: 28, fontWeight: 800, letterSpacing: "0.04em" }}>GYMTOOLS</div>
              <div style={{ display: "flex", fontSize: 16, opacity: 0.92 }}>helchang.com</div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flex: 1,
              padding: "40px 62px 28px",
              gap: 36,
              background: "linear-gradient(180deg, #FCFDFF 0%, #F3F6FC 100%)",
            }}
          >
            <div style={{ display: "flex", flex: 1.2, flexDirection: "column", justifyContent: "space-between" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", fontSize: 16, color: "#64748B", letterSpacing: "0.08em" }}>
                  THIS CERTIFIES THAT
                </div>
                <div style={{ display: "flex", fontSize: 62, fontWeight: 800, letterSpacing: "0.01em", color: "#0F172A" }}>
                  {nickname}
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ display: "flex", fontSize: 38, fontWeight: 700, color: "#1E293B" }}>대한민국 상위</span>
                  <span style={{ display: "flex", fontSize: 76, fontWeight: 900, color: "#5B4CF0" }}>
                    {`${formatPercent(safePercentAll)}%`}
                  </span>
                </div>
                <div style={{ display: "flex", fontSize: 24, fontWeight: 600, color: "#334155" }}>{tagline}</div>
                <div style={{ display: "flex", fontSize: 22, fontWeight: 700, color: "#1F2937" }}>{`3대 합계 ${safeTotal}kg`}</div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", fontSize: 21, color: "#475569", fontWeight: 600 }}>
                  {`SQUAT ${squatValue}  |  BENCH ${benchValue}  |  DEAD ${deadValue}`}
                </div>
                <div style={{ display: "flex", fontSize: 15, color: "#64748B" }}>
                  {`REFERENCE: ${classRange} / PCTL ${formatPercent(classPercentile)}`}
                </div>
                {needsReferenceNote ? (
                  <div style={{ display: "flex", fontSize: 13, color: "#94A3B8" }}>
                    ※ CLASS REFERENCE IS FOR CONTEXT ONLY
                  </div>
                ) : null}
              </div>
            </div>

            <div style={{ display: "flex", width: 1, background: "#D3DAE8" }} />

            <div style={{ display: "flex", width: 300, flexDirection: "column", justifyContent: "space-between" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {[
                  ["RANK (KOREA)", `TOP ${formatPercent(safePercentAll)}%`],
                  ["TOTAL", `${safeTotal} kg`],
                  ["CLASS (REF)", `${classRange} / PCTL ${formatPercent(classPercentile)}`],
                ].map(([label, value]) => (
                  <div key={label} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    <div style={{ display: "flex", width: "100%", height: 1, background: "#CBD5E1" }} />
                    <div style={{ display: "flex", fontSize: 13, color: "#64748B", letterSpacing: "0.08em" }}>{label}</div>
                    <div style={{ display: "flex", fontSize: 24, fontWeight: 700, color: "#111827" }}>{value}</div>
                  </div>
                ))}
              </div>

              <div
                style={{
                  display: "flex",
                  width: 162,
                  height: 162,
                  borderRadius: 9999,
                  border: "2px solid #94A3B8",
                  alignSelf: "center",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(148,163,184,0.08)",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 3, textAlign: "center" }}>
                  <span style={{ display: "flex", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#334155" }}>
                    GYMTOOLS
                  </span>
                  <span style={{ display: "flex", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#334155" }}>
                    VERIFIED
                  </span>
                  <span style={{ display: "flex", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#334155" }}>
                    3-LIFT
                  </span>
                  <span style={{ display: "flex", justifyContent: "center", fontSize: 11, color: "#64748B" }}>helchang.com</span>
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              height: 84,
              padding: "0 62px",
              borderTop: "1px solid #D3DAE8",
              background: "#F6F8FC",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", fontSize: 18, color: "#475569", fontWeight: 600 }}>{`DATE ${issueDate}`}</div>
            <div style={{ display: "flex", fontSize: 18, color: "#475569", fontWeight: 600 }}>GYMTOOLS / SHARE CARD</div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 675,
        headers: { "cache-control": "no-store" },
      }
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "unknown";
    return jsonError(500, "share_card_render_failed", { message });
  }
}
