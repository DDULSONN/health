export type DatingProfileBootstrap = {
  profile: {
    profile?: {
      nickname?: string | null;
      phone_verified?: boolean;
      swipe_profile_visible?: boolean;
    };
    account?: Record<string, unknown>;
    isAdmin?: boolean;
  };
  openCards: {
    items?: Array<Record<string, unknown>>;
    first_queue_boost_used?: boolean;
  };
  oneOnOne: {
    loggedIn?: boolean;
    isAdmin?: boolean;
    phoneVerified?: boolean;
    writeStatus?: string;
    canWrite?: boolean;
    activeRequestStatus?: string | null;
    totalApplications?: number;
    reason?: string | null;
  };
  openWrite: {
    enabled?: boolean;
  };
  audience?: {
    status: "admin" | "resolved" | "missing" | "conflict" | "unavailable";
    viewerSex: "male" | "female" | null;
    targetSex: "male" | "female" | null;
    source: "open_card" | "one_on_one" | "metadata" | null;
    canSwitchSex: boolean;
    requiresSexSelection: boolean;
  };
};

let inFlight: Promise<DatingProfileBootstrap> | null = null;

export async function loadDatingProfileBootstrap(options?: { force?: boolean }) {
  if (!options?.force && inFlight) return inFlight;

  const request = fetch("/api/dating/profile-bootstrap", {
    cache: "no-store",
    credentials: "same-origin",
  }).then(async (response) => {
    const body = (await response.json().catch(() => ({}))) as DatingProfileBootstrap & { error?: string };
    if (!response.ok) {
      const error = new Error(body.error ?? "프로필 상태를 불러오지 못했습니다.") as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return body;
  }).finally(() => {
    if (inFlight === request) inFlight = null;
  });

  inFlight = request;
  return request;
}

export function clearDatingProfileBootstrapCache() {
  inFlight = null;
}
