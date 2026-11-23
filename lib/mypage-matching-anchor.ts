// Older notifications and emails link to an anchor without a selected tab.
// Unknown anchors must not change the user's selected tab.
export function getMypageMatchingAnchorFilter(hash: string): "all" | "received" | "applied" | "one_on_one" | null {
  switch (hash) {
    case "#paid-card-received":
    case "#open-card-received": return "received";
    case "#paid-card-applied":
    case "#open-card-applied": return "applied";
    case "#one-on-one-status": return "one_on_one";
    case "#dating-connections": return "all";
    default: return null;
  }
}

export function getMypageOpenCardAnchor(hash: string) {
  if (hash === "#open-card-received") return { id: "open-card-received", filter: "received" } as const;
  if (hash === "#my-open-card-status") return { id: "my-open-card-status", filter: "all" } as const;
  return null;
}
