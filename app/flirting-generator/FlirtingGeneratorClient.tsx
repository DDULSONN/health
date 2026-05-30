"use client";

import { useEffect, useState } from "react";

const RECENT_STORAGE_KEY = "jimtool_recent_flirting_lines";
const MAX_RECENT_LINES = 18;

const LINES = [
  "혹시 오늘 등 하는 날이에요? 제 마음도 같이 당겨졌는데요.",
  "덤벨은 내려놔도 되는데, 제 관심은 못 내려놓겠네요.",
  "러닝머신 속도 몇이에요? 제 심장박동이 따라가고 있어요.",
  "프로틴 뭐 드세요? 저는 방금 설렘 한 스쿱 먹은 것 같은데요.",
  "스쿼트 자세보다 제 고백 타이밍이 더 흔들리네요.",
  "벤치프레스보다 말 거는 용기가 더 무겁네요.",
  "랫풀다운 하시는 줄 알았는데 제 시선까지 당겨졌어요.",
  "레그프레스 무게보다 제 마음이 더 눌렸네요.",
  "유산소는 그쪽이 하는데 왜 제 숨이 차죠?",
  "덤벨은 양손에 들지만 제 관심은 한쪽으로만 가네요.",
  "바벨은 내려놔도 되는데 이 설렘은 못 내려놓겠어요.",
  "스미스머신은 고정인데 제 표정은 고정이 안 되네요.",
  "폼롤러로 몸은 풀리는데 제 긴장은 더 말리네요.",
  "스트랩은 손목에 감는데 제 마음은 그쪽에 감겼어요.",
  "러닝머신은 제자리인데 제 마음은 앞으로 가고 있어요.",
  "스텝밀 올라가시네요. 제 심장도 같이 올라갑니다.",
  "프로틴보다 지금 필요한 건 그쪽이랑 대화 한 스쿱이에요.",
  "물 마시러 왔는데 심장만 더 목말라졌네요.",
  "오늘 하체 날이에요? 저는 심장이 먼저 털렸어요.",
  "오늘 어깨 날인가요? 분위기가 벌써 든든하네요.",
  "오늘 가슴 운동하세요? 제 심장도 같이 운동 중이에요.",
  "풀업 하시는 줄 알았는데 제 마음이 먼저 올라갔네요.",
  "푸쉬업보다 어려운 게 자연스럽게 말 걸기네요.",
  "데드리프트보다 이 첫마디가 더 무겁네요.",
  "스쿼트 깊이보다 제 고민이 더 깊었어요. 말 걸까 말까.",
  "플랭크보다 지금 눈 마주치는 게 더 오래 버티기 힘드네요.",
  "인터벌 하세요? 제 심장은 이미 고강도 인터벌이에요.",
  "러닝머신 칼로리보다 제 긴장이 더 빨리 타는 중이에요.",
  "사이클 페달은 그쪽이 밟는데 제 마음이 굴러가네요.",
  "케이블은 당기면 오는데, 제 관심도 당겨졌어요.",
  "로우 하시는 거예요? 제 마음도 같이 끌려갔네요.",
  "숄더프레스 중이세요? 제 기대감도 같이 올라가요.",
  "암컬 하시네요. 저는 용기부터 컬하고 왔어요.",
  "힙쓰러스트보다 제 심장이 더 튀어나올 것 같아요.",
  "런지 하시는 거 보니까 제 마음도 한 발 다가갔어요.",
  "스쿼트 랙 예약하셨어요? 제 관심은 이미 예약됐어요.",
  "벤치 자리보다 그쪽 옆자리가 더 치열해 보이네요.",
  "기구 대기 중인데 사실 인사할 타이밍을 더 기다렸어요.",
  "세트 사이 쉬는 시간인가요? 제 인사도 한 세트만 해도 될까요?",
  "마지막 세트세요? 그럼 제 용기도 마지막으로 짜내볼게요.",
  "워밍업 중이세요? 저는 심장이 이미 본운동입니다.",
  "쿨다운 하셔야 하는데 제가 심박수 올린 건 아니죠?",
  "스트레칭 중이세요? 저도 대화 좀 풀어봐도 될까요?",
  "오늘 루틴 뭐예요? 제 하루 루틴은 방금 바뀐 것 같아요.",
  "운동 루틴은 모르겠고, 제 관심 루틴은 확실해졌어요.",
  "세트 수는 모르겠는데 제 관심은 풀세트예요.",
  "중량은 천천히 올리라는데 호감도 천천히 올려도 될까요?",
  "무게 올리는 중이세요? 저는 호감만 살짝 올려볼게요.",
  "오늘 기록 갱신 중이세요? 저는 용기 기록 갱신 중이에요.",
  "운동 기록보다 오늘 이 순간이 더 오래 남을 것 같아요.",
  "그립 잡는 법보다 말 거는 법이 더 어렵네요.",
  "폼 체크하다가 제 표정 관리가 안 됐네요.",
  "자세가 안정적이라 그런가 제 마음만 불안정해졌어요.",
  "자세가 너무 좋아서 제 집중력이 자세를 잃었어요.",
  "거울은 앞에 있는데 자꾸 옆을 보게 되네요.",
  "거울보다 그쪽이 더 자세히 보이는 건 왜죠?",
  "헬스장 조명보다 오늘 더 밝아 보이세요.",
  "운동복 색 잘 어울리세요. 제 심장 색도 방금 바뀐 것 같아요.",
  "운동화 끈은 묶으셨는데 제 마음은 풀렸네요.",
  "물통 어디서 사셨어요? 제 관심도 같이 담긴 것 같아요.",
  "수건은 땀 닦는 용도인데 제 긴장도 좀 닦아주면 좋겠네요.",
  "프로틴 쉐이커 흔드시네요. 제 마음도 같이 흔들렸어요.",
  "인바디보다 제 심장 상태가 더 궁금해졌어요.",
  "체지방은 모르겠고 제 방어력은 방금 0% 됐어요.",
  "헬스장에 좋은 기구 많지만 오늘 제일 눈에 띄는 건 따로 있네요.",
  "운동 매너가 좋아 보여서 제 마음도 정리 정돈됐어요.",
  "덤벨 정리하시는 모습까지 멋있으면 반칙 아닌가요?",
  "기구 닦는 모습 봤는데 제 마음까지 깨끗하게 치였네요.",
  "오늘 컨디션 좋아 보이세요. 제 컨디션도 방금 좋아졌어요.",
  "운동 텐션 좋아 보이세요. 제 텐션도 같이 올라갔어요.",
  "오늘 헬스장 온 보람이 방금 생겼네요.",
  "운동 끝나고 그냥 가시면 제 용기가 벌크업을 못 해요.",
  "헬스장 출석률 좋아 보이세요. 저는 오늘 출석 이유가 생겼어요.",
  "오늘도 운동 오신 거면 자기관리 만렙이신가 봐요.",
  "헬스장 초보인데요, 인사하는 법부터 배워도 될까요?",
  "같은 헬스장 다니는 사이니까 인사 정도는 해도 되죠?",
  "운동은 혼자 해도 되지만 인사는 같이 해도 되잖아요.",
  "운동 파트너는 아니어도 응원 파트너는 가능할까요?",
  "스팟은 필요 없으세요? 저는 대화 스팟이 필요합니다.",
  "보조는 못 해도 응원은 잘할 수 있어요.",
  "오늘 운동 빡세 보이는데 제 심장도 같이 빡세졌어요.",
  "오늘 루틴이 힘들어 보여요. 제 고백 루틴도 만만치 않네요.",
  "운동 끝나면 단백질 챙기시죠? 저는 용기부터 챙겨왔어요.",
  "운동 끝나고 뭐 드세요? 저는 지금 말 걸 용기만 먹었습니다.",
  "헬스장 음악보다 제 심장 박자가 더 크게 들려요.",
  "이어폰 끼고 계셔도 제 심장 소리는 들킬 것 같네요.",
  "세트 사이 쉬는 시간에 제 마음이 끼어들어도 될까요?",
  "휴식 시간인데 제 심장은 쉬지를 않네요.",
  "오늘 운동 강도 몇이에요? 제 설렘 강도는 이미 고강도예요.",
  "오늘 운동 목표가 뭐예요? 저는 인사 성공으로 정했습니다.",
  "오늘 루틴 성공하셨나요? 저는 방금 말 걸어서 성공입니다.",
  "기구 사용법은 검색하면 나오는데, 그쪽한테 말 거는 법은 안 나오네요.",
  "운동 앱보다 제 마음이 먼저 알림을 보냈어요.",
  "운동 기록 저장하시죠? 저는 이 순간 저장했습니다.",
  "운동 자세는 안정적인데 제 멘트는 아직 워밍업이에요.",
  "심박수 체크하시면 제 긴장도 같이 나올 것 같아요.",
  "오늘 땀 많이 나셨네요. 저는 말 걸기 전부터 식은땀 났어요.",
  "하체 털리는 날이라던데 저는 심장이 털렸네요.",
  "상체 운동 중이세요? 저는 상상만으로도 심장이 운동 중이에요.",
  "코어 운동하세요? 제 중심은 방금 흔들렸어요.",
  "어깨 운동 중이세요? 제 시선도 같이 올라가네요.",
  "등 운동 중이세요? 제 마음도 등 뒤에서 밀어주고 싶네요.",
  "오늘 팔 운동하세요? 손 흔들 용기부터 키워야겠네요.",
  "운동 끝나고 스트레칭하시죠? 저는 긴장부터 늘려야겠어요.",
  "헬스장 문 열고 들어온 건 저인데, 제 마음은 이미 넘어갔네요.",
  "오늘은 운동보다 인사가 더 큰 도전이었어요.",
  "말 걸 타이밍 찾다가 유산소 한 세트 한 것 같아요.",
  "저 지금 운동하러 온 건지 설레러 온 건지 헷갈려요.",
  "방금 제 심장 PR 찍은 것 같은데요.",
  "오늘 제일 무거운 건 바벨이 아니라 이 첫마디였어요.",
  "그쪽 보니까 제 루틴에 휴식이 사라졌어요.",
  "오늘 운동 잘 되세요? 저는 방금부터 너무 잘 안 됩니다.",
  "지금 이 멘트 실패하면 바로 유산소로 도망가겠습니다.",
  "혹시 제 심장 소리 때문에 음악 안 들리는 건 아니죠?",
  "말 걸 용기 충전하는 데 프로틴보다 오래 걸렸어요.",
  "운동 끝나고 쿨다운하듯이 저랑 대화도 천천히 식혀볼까요?",
  "오늘 여기 공기가 왜 이렇게 좋은가 했더니 그쪽 때문이었네요.",
  "저는 세트 끝났는데 심장은 아직 반복 중이에요.",
  "이 멘트가 가볍다면 다음 세트에서 더 무겁게 가져오겠습니다.",
  "그쪽 지나가니까 제 집중력이 드롭세트처럼 떨어졌어요.",
  "오늘 제 운동 목표는 수정됐어요. 자연스럽게 인사하기.",
];

type Idea = {
  id: string;
  content: string;
  created_at: string;
  nickname: string;
  canDelete: boolean;
};

function getStoredRecentLines() {
  if (typeof window === "undefined") return [];

  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function saveRecentLine(line: string) {
  if (typeof window === "undefined") return;

  const next = [line, ...getStoredRecentLines().filter((item) => item !== line)].slice(0, MAX_RECENT_LINES);
  window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
}

function pickLine(currentLine = "") {
  const recent = new Set(getStoredRecentLines());
  const freshPool = LINES.filter((item) => item !== currentLine && !recent.has(item));
  const fallbackPool = LINES.filter((item) => item !== currentLine);
  const pool = freshPool.length > 0 ? freshPool : fallbackPool;
  const next = pool[Math.floor(Math.random() * pool.length)] ?? LINES[0];
  saveRecentLine(next);
  return next;
}

export default function FlirtingGeneratorClient() {
  const [line, setLine] = useState(() => pickLine());
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
    setLine((prev) => pickLine(prev));
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
            placeholder="예: 덤벨은 내려놔도 되는데, 제 관심은 못 내려놓겠네요."
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
