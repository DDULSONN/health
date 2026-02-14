"use client";

import { useEffect, useMemo, useState } from "react";

type RangeDays = 30 | 90;

type LiftPoint = {
  date: string;
  total: number;
};

const CHART_W = 320;
const CHART_H = 180;
const PAD_X = 18;
const PAD_Y = 16;

function toKoreanDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${m}.${d}`;
}

function buildPolyline(points: LiftPoint[]): {
  polyline: string;
  circles: Array<{ x: number; y: number; value: number; date: string; isPeak: boolean }>;
  minValue: number;
  maxValue: number;
} {
  if (points.length === 0) {
    return { polyline: "", circles: [], minValue: 0, maxValue: 0 };
  }

  const values = points.map((point) => point.total);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const span = Math.max(1, maxValue - minValue);
  const innerW = CHART_W - PAD_X * 2;
  const innerH = CHART_H - PAD_Y * 2;
  const peak = maxValue;

  const circles = points.map((point, index) => {
    const x = points.length === 1 ? PAD_X + innerW / 2 : PAD_X + (innerW * index) / (points.length - 1);
    const normalizedY = (point.total - minValue) / span;
    const y = PAD_Y + innerH - normalizedY * innerH;
    return { x, y, value: point.total, date: point.date, isPeak: point.total === peak };
  });

  const polyline = circles.map((dot) => `${dot.x},${dot.y}`).join(" ");
  return { polyline, circles, minValue, maxValue };
}

export default function MyLiftGrowthChart() {
  const [range, setRange] = useState<RangeDays>(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<LiftPoint[]>([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError("");

      try {
        const response = await fetch(`/api/my-lift-history?range=${range}`, { cache: "no-store" });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "그래프 데이터를 불러오지 못했습니다.");
        }

        const json = (await response.json()) as LiftPoint[];
        if (!cancelled) {
          setData(Array.isArray(json) ? json : []);
        }
      } catch (fetchError) {
        if (!cancelled) {
          const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
          setError(message);
          setData([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [range]);

  const chart = useMemo(() => buildPolyline(data), [data]);
  const peak = useMemo(() => data.reduce((best, point) => (point.total > best.total ? point : best), data[0] ?? null), [data]);

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-bold text-neutral-900">📈 내 3대 성장 그래프</h2>
        <div className="flex rounded-xl border border-neutral-200 overflow-hidden shrink-0">
          <button
            type="button"
            onClick={() => setRange(30)}
            className={`px-3 h-9 text-xs font-medium ${range === 30 ? "bg-emerald-600 text-white" : "bg-white text-neutral-700"}`}
          >
            최근 30일
          </button>
          <button
            type="button"
            onClick={() => setRange(90)}
            className={`px-3 h-9 text-xs font-medium ${range === 90 ? "bg-emerald-600 text-white" : "bg-white text-neutral-700"}`}
          >
            최근 90일
          </button>
        </div>
      </div>

      {loading && <p className="text-sm text-neutral-500 mt-4">그래프를 불러오는 중...</p>}
      {!loading && error && <p className="text-sm text-red-600 mt-4">{error}</p>}

      {!loading && !error && data.length === 0 && (
        <p className="text-sm text-neutral-500 mt-4">기록을 저장하면 성장 그래프가 표시됩니다.</p>
      )}

      {!loading && !error && data.length > 0 && (
        <div className="mt-4">
          <div className="w-full overflow-x-auto">
            <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full min-w-[280px]" role="img" aria-label="내 3대 합계 성장 그래프">
              <rect x="0" y="0" width={CHART_W} height={CHART_H} rx="12" fill="#f8fafc" />
              <line x1={PAD_X} y1={PAD_Y} x2={PAD_X} y2={CHART_H - PAD_Y} stroke="#d4d4d8" strokeWidth="1" />
              <line x1={PAD_X} y1={CHART_H - PAD_Y} x2={CHART_W - PAD_X} y2={CHART_H - PAD_Y} stroke="#d4d4d8" strokeWidth="1" />
              <polyline fill="none" stroke="#059669" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" points={chart.polyline} />
              {chart.circles.map((dot) => (
                <g key={`${dot.date}-${dot.x}`}>
                  <circle cx={dot.x} cy={dot.y} r={dot.isPeak ? 4.5 : 3.2} fill={dot.isPeak ? "#dc2626" : "#10b981"} />
                  {dot.isPeak && (
                    <text x={dot.x} y={dot.y - 8} textAnchor="middle" fontSize="9" fill="#dc2626">
                      최고 {dot.value}
                    </text>
                  )}
                </g>
              ))}
            </svg>
          </div>

          <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
            <span>{toKoreanDate(data[0].date)}</span>
            <span>{toKoreanDate(data[data.length - 1].date)}</span>
          </div>

          {peak && (
            <p className="text-xs text-neutral-600 mt-2">
              최고 기록: <strong>{peak.total}kg</strong> ({peak.date})
            </p>
          )}
        </div>
      )}
    </section>
  );
}

