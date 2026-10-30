// Existing, already-published landing screenshots. Never substitute original/private photos.
export const LANDING_REVIEWS = [
  { src: "/landing/reviews/review-01.webp", width: 935, height: 178 },
  { src: "/landing/reviews/review-02.webp", width: 751, height: 397 },
  { src: "/landing/reviews/review-03.webp", width: 1440, height: 532 },
  { src: "/landing/reviews/review-04.webp", width: 1440, height: 569 },
  { src: "/landing/reviews/review-05.webp", width: 735, height: 291 },
  { src: "/landing/reviews/review-06.webp", width: 1080, height: 263 },
  { src: "/landing/reviews/review-07.webp", width: 961, height: 496 },
  { src: "/landing/reviews/review-08.webp", width: 946, height: 370 },
  { src: "/landing/reviews/review-09.webp", width: 812, height: 585 },
  { src: "/landing/reviews/review-10.webp", width: 888, height: 370 },
] as const;

// Small set: about 80 KiB total, reused for thumbnails and the enlarged view.
export const SIGNUP_REVIEWS = [LANDING_REVIEWS[5], LANDING_REVIEWS[1], LANDING_REVIEWS[7]];

// Verbatim excerpts checked against the already-published screenshots above.
// Keep the source attached; do not invent identities, ratings or success statistics.
export const FEATURED_LANDING_REVIEWS = [
  { review: LANDING_REVIEWS[7], quote: "마음에 맞는 사람을 만나게 됐습니다!!" },
  { review: LANDING_REVIEWS[3], quote: "첨엔 조금 걱정했는데 좋은사람같아요!" },
  { review: LANDING_REVIEWS[4], quote: "지방 살아도 이게 되네요 ㅠㅠ 지인들한테도 추천했어요 !!" },
] as const;
