export type LoveFortuneIdealFace = {
  title?: string;
  eye?: string;
  smile?: string;
  mood?: string;
  style?: string;
  firstDate?: string;
  avoid?: string;
  note?: string;
} | null;

export type LoveFortuneFaceTarget = "male" | "female";

export type LoveFortuneFaceAsset = {
  src: string;
  target: LoveFortuneFaceTarget;
  label: string;
  tone: string;
  keywords: string[];
};

const FACE_ASSETS: LoveFortuneFaceAsset[] = [
  {
    src: "/love-fortune/faces/face-01.jpg",
    target: "male",
    label: "부드러운 남자 얼굴상",
    tone: "첫인상이 순하고 오래 볼수록 안정감이 드는 얼굴",
    keywords: ["부드", "편안", "담백", "안정", "따뜻", "순한", "온기"],
  },
  {
    src: "/love-fortune/faces/face-02.jpg",
    target: "male",
    label: "선명한 남자 얼굴상",
    tone: "눈매가 또렷하고 자기 기준이 분명해 보이는 얼굴",
    keywords: ["선명", "또렷", "집중", "카리스마", "직선", "강한", "명확"],
  },
  {
    src: "/love-fortune/faces/face-03.jpg",
    target: "male",
    label: "단정한 남자 얼굴상",
    tone: "깔끔하고 예의 바른 분위기가 먼저 느껴지는 얼굴",
    keywords: ["단정", "깔끔", "차분", "예의", "신뢰", "정돈", "성실"],
  },
  {
    src: "/love-fortune/faces/face-04.jpg",
    target: "male",
    label: "밝은 남자 얼굴상",
    tone: "웃는 인상이 좋고 대화가 쉽게 풀릴 것 같은 얼굴",
    keywords: ["밝", "웃", "미소", "친근", "귀여", "활기", "가벼운"],
  },
  {
    src: "/love-fortune/faces/face-05.jpg",
    target: "male",
    label: "깊은 남자 얼굴상",
    tone: "차분하지만 감정선이 깊어 보이는 얼굴",
    keywords: ["깊", "차분", "무게", "섬세", "고요", "진중", "서늘"],
  },
  {
    src: "/love-fortune/faces/face-06.jpg",
    target: "female",
    label: "부드러운 여자 얼굴상",
    tone: "편하게 말을 걸 수 있고 따뜻한 기운이 느껴지는 얼굴",
    keywords: ["부드", "편안", "담백", "안정", "따뜻", "순한", "온기"],
  },
  {
    src: "/love-fortune/faces/face-07.jpg",
    target: "female",
    label: "몽환적인 여자 얼굴상",
    tone: "첫눈에는 조용하지만 가까워질수록 분위기가 깊어지는 얼굴",
    keywords: ["몽환", "깊", "차분", "섬세", "고요", "분위기", "여운"],
  },
  {
    src: "/love-fortune/faces/face-08.jpg",
    target: "female",
    label: "단아한 여자 얼굴상",
    tone: "단정하고 신뢰감이 먼저 오는 정갈한 얼굴",
    keywords: ["단아", "단정", "깔끔", "예의", "신뢰", "정돈", "성실"],
  },
  {
    src: "/love-fortune/faces/face-09.jpg",
    target: "female",
    label: "밝은 여자 얼굴상",
    tone: "웃는 인상이 맑고 함께 있으면 긴장이 풀리는 얼굴",
    keywords: ["밝", "웃", "미소", "친근", "귀여", "활기", "맑"],
  },
  {
    src: "/love-fortune/faces/face-10.jpg",
    target: "female",
    label: "선명한 여자 얼굴상",
    tone: "눈매와 분위기가 또렷해 처음부터 존재감이 있는 얼굴",
    keywords: ["선명", "또렷", "집중", "카리스마", "직선", "강한", "도시"],
  },
];

function seedFromParts(parts: Array<string | null | undefined>) {
  return parts
    .filter(Boolean)
    .join("|")
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function idealText(ideal: LoveFortuneIdealFace | undefined) {
  if (!ideal) return "";
  return [ideal.title, ideal.eye, ideal.smile, ideal.mood, ideal.style, ideal.firstDate, ideal.avoid, ideal.note]
    .filter(Boolean)
    .join(" ");
}

export function getLoveFortuneFaceTarget(gender: string | null | undefined): LoveFortuneFaceTarget | null {
  if (gender === "female") return "male";
  if (gender === "male") return "female";
  return null;
}

export function pickLoveFortuneFaceAsset(params: {
  gender?: string | null;
  idealFace?: LoveFortuneIdealFace;
  seedParts?: Array<string | null | undefined>;
}) {
  const target = getLoveFortuneFaceTarget(params.gender) ?? "male";
  const candidates = FACE_ASSETS.filter((asset) => asset.target === target);
  const text = idealText(params.idealFace);

  const scored = candidates
    .map((asset, index) => ({
      asset,
      score: asset.keywords.reduce((score, keyword) => score + (text.includes(keyword) ? 1 : 0), 0),
      index,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  if (scored[0]?.score) return scored[0].asset;

  const seed = seedFromParts(params.seedParts ?? []);
  return candidates[Math.abs(seed) % candidates.length] ?? FACE_ASSETS[0];
}
