import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { buildSignedImageUrl, extractStorageObjectPathFromBuckets } from "@/lib/images";
import { createAdminClient } from "@/lib/supabase/server";
import LandingSeenMarker from "./LandingSeenMarker";
import styles from "./LandingPage.module.css";
import LandingStories from "@/components/LandingStories";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "짐툴 소개팅",
  description: "오픈카드와 1:1 매칭으로 내 방식에 맞게 자연스럽게 시작하는 소개팅.",
};

const differences = [
  {
    no: "01",
    title: "마음에 드는 사람에게 먼저",
    description: "사진과 소개를 등록하고, 마음에 드는 후보에게 요청해 보세요.",
  },
  {
    no: "02",
    title: "서로 수락하면 연락처 교환",
    description: "1:1 요청을 주고받고, 서로 수락하면 연락처 교환으로 이어져요.",
  },
  {
    no: "03",
    title: "오픈카드도 함께 이용",
    description: "공개된 카드를 보고 지원하거나, 내 카드를 등록해 지원을 받아보세요.",
  },
];

type LandingCard = {
  id: string;
  sex: "male" | "female";
  title: string;
  meta: string;
  imageUrl: string;
};

type DatingCardRow = {
  id: string;
  sex: "male" | "female" | null;
  age: number | null;
  region: string | null;
  blur_paths: unknown;
  blur_thumb_path: unknown;
  created_at: string | null;
};

function normalizeDatingPhotoPath(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return extractStorageObjectPathFromBuckets(raw.trim(), ["dating-card-photos", "dating-photos"]) ?? raw.trim().replace(/^\/+/, "");
}

function getBlurImageUrl(row: DatingCardRow) {
  const blurPaths = Array.isArray(row.blur_paths)
    ? row.blur_paths.map((item) => normalizeDatingPhotoPath(item)).filter(Boolean)
    : [];
  const firstBlur = blurPaths[0] ?? normalizeDatingPhotoPath(row.blur_thumb_path);
  return firstBlur ? buildSignedImageUrl("dating-card-photos", firstBlur) : "";
}

async function loadLandingCards(): Promise<LandingCard[]> {
  const admin = createAdminClient();

  const fetchBySex = async (sex: "male" | "female") => {
    const { data, error } = await admin
      .from("dating_cards")
      .select("id,sex,age,region,blur_paths,blur_thumb_path,created_at")
      .eq("status", "public")
      .eq("sex", sex)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(3);

    if (error) {
      console.warn("[landing] open card preview load failed", { sex, error });
      return [] as DatingCardRow[];
    }
    return (data ?? []) as DatingCardRow[];
  };

  const [maleRows, femaleRows] = await Promise.all([fetchBySex("male"), fetchBySex("female")]);
  const maxLength = Math.max(maleRows.length, femaleRows.length);
  const mixed: DatingCardRow[] = [];

  for (let index = 0; index < maxLength; index += 1) {
    if (femaleRows[index]) mixed.push(femaleRows[index]);
    if (maleRows[index]) mixed.push(maleRows[index]);
  }

  const cards: LandingCard[] = mixed
    .map((row): LandingCard => ({
      id: row.id,
      sex: row.sex === "male" ? "male" : "female",
      title: row.sex === "male" ? "남자 오픈카드" : "여자 오픈카드",
      meta: [row.region, row.age ? `${row.age}세` : ""].filter(Boolean).join(" · "),
      imageUrl: getBlurImageUrl(row),
    }))
    .filter((card) => card.imageUrl)
    .slice(0, 4);

  if (cards.length > 0) return cards;

  return [
    { id: "fallback-female", sex: "female", title: "여자 오픈카드", meta: "서울 · 29세", imageUrl: "" },
    { id: "fallback-male", sex: "male", title: "남자 오픈카드", meta: "분당 · 31세", imageUrl: "" },
    { id: "fallback-female-2", sex: "female", title: "여자 오픈카드", meta: "수원 · 27세", imageUrl: "" },
    { id: "fallback-male-2", sex: "male", title: "남자 오픈카드", meta: "강남 · 30세", imageUrl: "" },
  ];
}

function CardRail({ cards }: { cards: LandingCard[] }) {
  const railCards = [...cards, ...cards];

  return (
    <div className={styles.cardRail} aria-hidden="true">
      <div className={styles.cardTrack}>
        {railCards.map((card, index) => (
          <div
            className={`${styles.previewCard} ${card.sex === "male" ? styles.maleCard : styles.femaleCard}`}
            key={`${card.id}-${index}`}
          >
            <div
              className={`${styles.photoShape} ${card.imageUrl ? styles.hasPhoto : ""}`}
              style={card.imageUrl ? { backgroundImage: `url("${card.imageUrl}")` } : undefined}
            />
            <div className={styles.cardLines}>
              <span />
              <span />
            </div>
            <div className={styles.cardFoot}>
              <strong>{card.title}</strong>
              <em>{card.meta}</em>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function LandingPage() {
  const landingCards = await loadLandingCards();

  return (
    <main className={`${styles.page} landing-page-active`}>
      <LandingSeenMarker />
      <section className={styles.stage} aria-hidden="true">
        <CardRail cards={landingCards} />
        <div className={styles.pulseRing} />
        <div className={styles.introMark}>
          <Image className={styles.introIcon} src="/icon-192x192.png" alt="" width={192} height={192} priority />
        </div>
        <div className={styles.introText}>
          <strong>짐툴</strong>
          <span>진짜 연애가 하고 싶다면</span>
        </div>
      </section>

      <section className={styles.shell}>
        <div className={styles.hero}>
          <header className={styles.heroTop}>
            <div className={styles.brandRow}>
              <Image className={styles.brandIcon} src="/icon-96x96.png" alt="" width={96} height={96} priority />
              <span>짐툴</span>
            </div>
            <p className={styles.brandNote}>마음에 드는 사람에게 먼저, 짐툴</p>
          </header>

          <section className={styles.reviewSection} aria-label="이용자 후기">
            <LandingStories />
            <div className={styles.reviewActions}>
              <Link className={styles.primaryCta} href="/signup">가입하고 프로필 만들기</Link>
              <Link className={styles.reviewLogin} href="/login?tab=password&amp;next=%2Fonboarding%2Fdating">이미 가입했어요</Link>
            </div>
            <Link className={styles.browseLink} href="/community/dating/cards">먼저 둘러보기</Link>
          </section>

          <div className={styles.heroBody}>
            <div className={styles.copyBlock}>
              <div className={styles.heroDifference}>
                <p className={styles.heroKicker}>짐툴은 이렇게 달라요</p>
                <div className={styles.heroDifferenceList}>
                  {differences.map((item) => (
                    <article className={styles.heroDifferenceItem} key={item.no}>
                      <span>{item.no}</span>
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.description}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
              <section className={styles.startFlow} aria-labelledby="start-flow-title">
                <div className={styles.startFlowHeading}>
                  <strong id="start-flow-title">가입부터 매칭 준비까지 한 번에</strong>
                  <span>공통 정보는 한 번만 적어요</span>
                </div>
                <ol className={styles.startFlowSteps}>
                  <li><span>1</span><strong>가입</strong></li>
                  <li><span>2</span><strong>번호 인증</strong></li>
                  <li><span>3</span><strong>통합 프로필 작성</strong></li>
                </ol>
                <p>이용할 서비스를 선택해 등록해요. 1:1 프로필을 완성하면 추천 후보에게 바로 요청할 수 있어요.</p>
              </section>
            </div>

            <div className={styles.visualPanel} aria-label="오픈카드 미리보기">
              <div className={styles.visualPoster}>
                <Image
                  className={styles.heroPoster}
                  src="/landing/jimtool-store-hero.webp"
                  alt=""
                  width={1200}
                  height={2601}
                  priority
                />
              </div>
              <CardRail cards={landingCards} />
            </div>
          </div>

        </div>

      </section>
    </main>
  );
}
