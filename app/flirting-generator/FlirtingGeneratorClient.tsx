"use client";

import { useEffect, useState } from "react";

const LINES = [
  "혹시 오늘 등 하는 날이에요? 제 마음도 같이 당겨졌는데요.",
  "레그프레스 무게보다 말 걸 용기가 더 무겁네요.",
  "유산소는 그쪽이 하는데 왜 제 심박수가 올라가죠?",
  "보충제는 챙기셨나요? 저는 용기 보충하고 왔어요.",
  "랫풀다운 하시는 줄 알았는데 제 시선까지 같이 당겨졌네요.",
  "스쿼트보다 어려운 게 말 걸기였는데, 방금 성공한 것 같아요.",
  "러닝머신은 제자리인데 저는 한 걸음 다가왔네요.",
  "프로틴보다 필요한 건 용기였는데 방금 충전됐어요.",
  "오늘 운동 루틴 좋아 보여요. 저도 살짝 자극받고 갑니다.",
  "풀업은 못 해도 인사는 할 수 있을 것 같아서 왔어요.",
  "오늘 운동 열심히 하시는 거 보고 제 핑계가 사라졌어요.",
  "심박수 체크하다가 제 긴장감까지 같이 체크됐어요.",
  "프로틴 쉐이크처럼 대화도 가볍게 섞어봐도 될까요?",
  "운동은 혼자 왔는데, 인사는 같이 해도 될 것 같아서요.",
  "오늘 루틴 보니까 제 운동 의지도 같이 올라왔어요.",
  "덤벨은 내려놓았는데 호감은 아직 못 내려놨어요.",
  "세트 사이 쉬는 시간인가요? 저는 말 걸 타이밍만 기다렸어요.",
  "운동 자세가 너무 좋아서 제 집중력이 잠깐 흔들렸어요.",
  "헬스장에서는 무게보다 타이밍이 어렵네요. 지금 괜찮을까요?",
  "오늘은 단백질보다 인사 타이밍을 챙겨봤어요.",
  "운동 끝나고 나가려다가 용기 한 세트만 더 하고 왔어요.",
  "기구 사용법보다 지금 이 인사가 더 어렵네요.",
  "오늘 컨디션 좋아 보이세요. 저도 덕분에 한 세트 더 할 힘이 났어요.",
  "러닝머신 속도보다 제 심박수가 더 빨라진 것 같아요.",
  "운동 루틴은 모르겠고, 멋있다는 말은 해야 할 것 같았어요.",
  "바벨은 무거워도 참겠는데, 말 안 걸고 지나가는 건 더 어렵네요.",
  "오늘 헬스장 온 보람이 방금 생긴 것 같아요.",
  "운동 기록보다 오늘 이 인사가 더 기억에 남을 것 같아요.",
  "스트레칭보다 먼저 긴장부터 풀고 인사드릴게요.",
  "운동 잘하시는 분 보면 배우고 싶은데, 오늘은 이름도 궁금하네요.",
  "쉬는 시간 방해라면 죄송해요. 그래도 인사는 놓치기 아쉬웠어요.",
  "오늘 루틴이 빡세 보여서요. 저는 용기 루틴만 겨우 성공했습니다.",
  "거울 보다가 운동 자세 말고 그쪽이 눈에 들어왔어요.",
  "운동은 꾸준함이 중요하다는데, 저도 꾸준히 인사해도 될까요?",
  "기구 대기 중인데, 사실 제일 기다린 건 말 걸 타이밍이었어요.",
  "운동 끝나기 전에 인사라도 해야 오늘 루틴이 완성될 것 같았어요.",
];

type Idea = {
  id: string;
  content: string;
  created_at: string;
  nickname: string;
  canDelete: boolean;
};

function pickLine() {
  return LINES[Math.floor(Math.random() * LINES.length)];
}

export default function FlirtingGeneratorClient() {
  const [line, setLine] = useState(() => LINES[0]);
  const [copied, setCopied] = useState(false);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [ideaText, setIdeaText] = useState("");
  const [ideaMessage, setIdeaMessage] = useState("");
  const [isLoadingIdeas, setIsLoadingIdeas] = useState(true);
  const [isSubmittingIdea, setIsSubmittingIdea] = useState(false);

  useEffect(() => {
    let alive = true;
    const loadIdeas = async () => {
      try {
        const response = await fetch("/api/flirting-generator/ideas", { cache: "no-store" });
        const body = (await response.json().catch(() => ({}))) as { ideas?: Idea[] };
        if (alive) setIdeas(body.ideas ?? []);
      } catch {
        if (alive) setIdeaMessage("아이디어를 불러오지 못했습니다.");
      } finally {
        if (alive) setIsLoadingIdeas(false);
      }
    };

    void loadIdeas();
    return () => {
      alive = false;
    };
  }, []);

  const generate = () => {
    setCopied(false);
    setLine(pickLine());
  };

  const copy = async () => {
    await navigator.clipboard.writeText(line);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const submitIdea = async () => {
    const content = ideaText.trim();
    if (!content) {
      setIdeaMessage("대사 아이디어를 적어주세요.");
      return;
    }

    setIsSubmittingIdea(true);
    setIdeaMessage("");
    try {
      const response = await fetch("/api/flirting-generator/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const body = (await response.json().catch(() => ({}))) as { idea?: Idea; error?: string };
      if (!response.ok || !body.idea) {
        setIdeaMessage(body.error ?? "저장에 실패했습니다.");
        return;
      }

      setIdeas((prev) => [body.idea as Idea, ...prev]);
      setIdeaText("");
      setIdeaMessage("저장됐어요.");
    } catch {
      setIdeaMessage("저장에 실패했습니다.");
    } finally {
      setIsSubmittingIdea(false);
    }
  };

  const deleteIdea = async (id: string) => {
    setIdeaMessage("");
    const response = await fetch(`/api/flirting-generator/ideas/${id}`, { method: "DELETE" });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setIdeaMessage(body.error ?? "삭제에 실패했습니다.");
      return;
    }

    setIdeas((prev) => prev.filter((idea) => idea.id !== id));
  };

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <section className="rounded-[28px] border border-black/5 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
        <div>
          <span className="inline-flex rounded-full bg-rose-50 px-3 py-1 text-xs font-black text-rose-600">도구</span>
          <h1 className="mt-3 text-2xl font-black tracking-tight text-neutral-950">헬스장 플러팅 대사</h1>
        </div>

        <div className="mt-6 rounded-3xl bg-neutral-50 p-5">
          <p className="text-lg font-black leading-8 text-neutral-950">{line}</p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={generate} className="min-h-[48px] rounded-2xl bg-neutral-950 px-4 text-sm font-black text-white">
            새로 뽑기
          </button>
          <button type="button" onClick={() => void copy()} className="min-h-[48px] rounded-2xl border border-neutral-200 px-4 text-sm font-black text-neutral-700">
            {copied ? "복사됨" : "복사"}
          </button>
        </div>
      </section>

      <section className="mt-4 rounded-[28px] border border-black/5 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
        <div>
          <h2 className="text-lg font-black text-neutral-950">대사 아이디어 적기</h2>
          <p className="mt-1 text-sm font-semibold text-neutral-500">재밌는 헬스장 멘트를 같이 모아봐요.</p>
        </div>

        <div className="mt-4 space-y-2">
          <textarea
            value={ideaText}
            onChange={(event) => setIdeaText(event.target.value.slice(0, 120))}
            placeholder="예: 덤벨은 내려놨는데 호감은 못 내려놨어요."
            rows={3}
            className="w-full resize-none rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm font-semibold text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-neutral-950"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-bold text-neutral-400">{ideaText.trim().length}/120</p>
            <button
              type="button"
              onClick={() => void submitIdea()}
              disabled={isSubmittingIdea}
              className="min-h-[40px] rounded-2xl bg-rose-600 px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
            >
              {isSubmittingIdea ? "저장 중" : "올리기"}
            </button>
          </div>
          {ideaMessage ? <p className="text-sm font-bold text-neutral-500">{ideaMessage}</p> : null}
        </div>

        <div className="mt-5 space-y-2">
          {isLoadingIdeas ? (
            <p className="rounded-2xl bg-neutral-50 px-4 py-3 text-sm font-bold text-neutral-500">불러오는 중</p>
          ) : ideas.length > 0 ? (
            ideas.map((idea) => (
              <div key={idea.id} className="rounded-2xl bg-neutral-50 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-neutral-950">{idea.content}</p>
                    <p className="mt-2 text-xs font-bold text-neutral-400">{idea.nickname}</p>
                  </div>
                  {idea.canDelete ? (
                    <button
                      type="button"
                      onClick={() => void deleteIdea(idea.id)}
                      className="shrink-0 rounded-full border border-neutral-200 px-3 py-1 text-xs font-black text-neutral-500"
                    >
                      삭제
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          ) : (
            <p className="rounded-2xl bg-neutral-50 px-4 py-3 text-sm font-bold text-neutral-500">아직 올라온 아이디어가 없어요.</p>
          )}
        </div>
      </section>
    </main>
  );
}
