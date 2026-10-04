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
