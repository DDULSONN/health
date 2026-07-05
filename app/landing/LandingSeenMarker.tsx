"use client";

import { useEffect } from "react";

const LANDING_SEEN_COOKIE = "jimtool_landing_seen=1";
const HALF_YEAR_SECONDS = 60 * 60 * 24 * 180;

export default function LandingSeenMarker() {
  useEffect(() => {
    document.cookie = `${LANDING_SEEN_COOKIE}; Max-Age=${HALF_YEAR_SECONDS}; Path=/; SameSite=Lax`;
  }, []);

  return null;
}
