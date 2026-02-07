import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

const RESULTS: Record<string, { title: string; emoji: string }> = {
  heavy_ss: { title: "중증 헬창 (SS급)", emoji: "🏆" },
  senior: { title: "상급 헬창 (S급)", emoji: "💪" },
  routine: { title: "루틴 집착러", emoji: "📋" },
  talk: { title: "스몰톡 헬창", emoji: "💬" },
  pump: { title: "펌프 중독자", emoji: "🪞" },
  frame: { title: "근육 태토남", emoji: "🎯" },
  egennam: { title: "근육 에겐남", emoji: "🌟" },
  newbie: { title: "귀여운 헬린이", emoji: "🌱" },
  manage: { title: "관리형 헬스러", emoji: "⚖️" },
  reality: { title: "건강 현실파", emoji: "🏃" },
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const resultId = searchParams.get('r') || 'reality';

  const result = RESULTS[resultId] || RESULTS.reality;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(to bottom right, #059669, #10b981)',
          padding: '40px',
        }}
      >
        {/* 이모지 */}
        <div
          style={{
            fontSize: 140,
            marginBottom: 30,
          }}
        >
          {result.emoji}
        </div>

        {/* 제목 */}
        <div
          style={{
            fontSize: 56,
            fontWeight: 'bold',
            color: 'white',
            textAlign: 'center',
            marginBottom: 20,
          }}
        >
          {result.title}
        </div>

        {/* 브랜드명 */}
        <div
          style={{
            fontSize: 28,
            color: 'rgba(255, 255, 255, 0.9)',
            marginTop: 40,
          }}
        >
          헬창 판록기
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
