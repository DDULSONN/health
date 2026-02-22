"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";

const ADSENSE_CLIENT = "ca-pub-5642406584497133";

function isAllowedAdRoute(pathname: string): boolean {
  const exact = new Set<string>([
    "/community",
    "/community/bodycheck",
    "/hall-of-fame",
    "/protein",
    "/1rm",
    "/lifts",
    "/snacks",
  ]);
  if (exact.has(pathname)) return true;

  // Allow ad script only for content-detail pages.
  if (/^\/community\/[0-9a-f-]{8,}$/i.test(pathname)) return true;

  return false;
}

export default function AdSenseBootstrap() {
  const pathname = usePathname() ?? "/";
  if (!isAllowedAdRoute(pathname)) return null;

  return (
    <Script
      async
      id="adsense-bootstrap"
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
      strategy="afterInteractive"
      crossOrigin="anonymous"
    />
  );
}

