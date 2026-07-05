import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { buildSignedImageUrl, extractStorageObjectPathFromBuckets } from "@/lib/images";
import { createAdminClient } from "@/lib/supabase/server";
import LandingSeenMarker from "./LandingSeenMarker";
import styles from "./LandingPage.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "짐툴 소개팅",
  description: "오픈카드와 1:1 매칭으로 내 방식에 맞게 자연스럽게 시작하는 소개팅.",
};

const reviewProofs = [
  { src: "/landing/reviews/review-01.jpg", width: 935, height: 178 },
  { src: "/landing/reviews/review-02.jpg", width: 751, height: 397 },
  { src: "/landing/reviews/review-03.jpg", width: 2956, height: 1092 },
  { src: "/landing/reviews/review-04.jpg", width: 3136, height: 1240 },
  { src: "/landing/reviews/review-05.jpg", width: 735, height: 291 },
  { src: "/landing/reviews/review-06.jpg", width: 1080, height: 263 },
  { src: "/landing/reviews/review-07.jpg", width: 961, height: 496 },
  { src: "/landing/reviews/review-08.jpg", width: 946, height: 370 },
  { src: "/landing/reviews/review-09.jpg", width: 812, height: 585 },
  { src: "/landing/reviews/review-10.jpg", width: 888, height: 370 },
];

const differences = [
  {
    no: "01",
    title: "프로필보다 분위기",
    description: "사진과 소개를 보고, 어떤 사람인지 먼저 느껴봅니다.",
  },
  {
    no: "02",
    title: "서로 마음이 있을 때",
    description: "한쪽만 앞서가지 않게, 서로 관심이 생긴 뒤 이어집니다.",
  },
  {
    no: "03",
    title: "천천히 보는 속도",
    description: "바로 넘기기보다 보고, 생각하고, 마음이 가면 시작합니다.",
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
            <p className={styles.brandNote}>운동하는 사람 많은 소개팅</p>
          </header>

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
              <div className={styles.ctaRow}>
                <Link className={styles.primaryCta} href="/community/dating/cards">
                  오픈카드 보기
                </Link>
                <Link className={styles.secondaryCta} href="/dating/1on1">
                  1:1 매칭 시작
                </Link>
              </div>
            </div>

            <div className={styles.visualPanel} aria-label="오픈카드 미리보기">
              <div className={styles.visualPoster}>
                <Image
                  className={styles.heroPoster}
                  src="/landing/jimtool-store-hero.png"
                  alt=""
                  width={945}
                  height={2048}
                  priority
                />
              </div>
              <CardRail cards={landingCards} />
            </div>
          </div>

          <section className={styles.reviewSection} aria-label="이용자 후기">
            <div className={styles.reviewHeader}>
              <strong>실제 리뷰</strong>
            </div>
            <div className={styles.reviewRail}>
              <div className={styles.reviewTrack}>
                <span className={styles.reviewSpacer} aria-hidden="true" />
                {[...reviewProofs, ...reviewProofs].map((review, index) => (
                  <article className={styles.reviewCard} key={`${review.src}-${index}`}>
                    <Image
                      className={styles.reviewImage}
                      src={review.src}
                      alt={`짐툴 실제 리뷰 스크린샷 ${(index % reviewProofs.length) + 1}`}
                      width={review.width}
                      height={review.height}
                      sizes="(max-width: 820px) 74vw, 320px"
                    />
                  </article>
                ))}
              </div>
            </div>
            <p className={styles.reviewNote}>
              리뷰 속 유기견은 인스타그램 크리에이터 일반사람이 쓰는 표현으로, 헬스는 열심히 하지만 아직 연애는 못 하고 있는 사람을 뜻하는 농담이에요.
            </p>
          </section>
        </div>

      </section>
    </main>
  );
}
