import { CONTACT_PRICE_UPDATE_NOTICE } from "@/lib/contact-price-update-notice";

// Only the notice expires after 48 hours. The new standard price does not expire.
// Fixed release window, shared by all visitors. Never restart this timer per visit.
export const SITE_ANNOUNCEMENT = {
  id: CONTACT_PRICE_UPDATE_NOTICE.id,
  startsAt: "2026-10-23T00:00:00+09:00",
  endsAt: "2026-10-25T00:00:00+09:00",
  title: CONTACT_PRICE_UPDATE_NOTICE.title,
  message: CONTACT_PRICE_UPDATE_NOTICE.paragraphs.join(" "),
} as const;

export function isSiteAnnouncementActive(nowMs = Date.now()) {
  return nowMs >= Date.parse(SITE_ANNOUNCEMENT.startsAt) && nowMs < Date.parse(SITE_ANNOUNCEMENT.endsAt);
}
