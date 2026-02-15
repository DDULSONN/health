import { ImageResponse } from "@vercel/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

function toNumber(value: string | null, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function sanitizeNickname(raw: string | null) {
  const clean = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!clean) return "GymTools User";
  return clean.slice(0, 12);
}

function getTierMessage(percentAll: number) {
  if (percentAll <= 1) return "전국 상위 1% 괴물";
  if (percentAll <= 5) return "상위 5% 엘리트";
  if (percentAll <= 15) return "상위 15% 헬창";
  if (percentAll <= 30) return "상위 30% 상위권";
  return "성장 중";
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const total = Math.max(0, Math.round(toNumber(searchParams.get("total"), 0)));
  const percentAll = Math.max(0, Math.min(100, Number(toNumber(searchParams.get("percentAll"), 100).toFixed(2))));
  const percentByClass = Math.max(0, Math.min(100, Number(toNumber(searchParams.get("percentByClass"), 100).toFixed(2))));
  const classRange = (searchParams.get("classRange") || "체급 정보 없음").slice(0, 28);
  const nickname = sanitizeNickname(searchParams.get("nickname"));
  const tierMessage = getTierMessage(percentAll);

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
          <div style={{ fontSize: 42, color: "#ccfbf1", fontWeight: 700 }}>{tierMessage}</div>
          <div style={{ fontSize: 38, color: "#d1fae5" }}>
            {classRange} 체급 상위 {percentByClass}%
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ fontSize: 34 }}>닉네임: {nickname}</div>
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
}
