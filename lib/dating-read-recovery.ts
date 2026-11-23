type ReadResult<T> = PromiseSettledResult<{ response: Pick<Response, "ok" | "status">; body: T | null }>;

export function datingReadDenied(status: number): boolean {
  return status === 401 || status === 403;
}

export function datingAuthSessionMissing(error: { name?: string; code?: string; status?: number }): boolean {
  return error.name === "AuthSessionMissingError" || error.code === "session_not_found" ||
    error.code === "user_not_found" || error.status === 401;
}

export function resolveOneOnOneHomeReads<Status extends { loggedIn?: boolean; canWrite?: boolean; phoneVerified?: boolean }, Profile extends { items?: unknown }, Match extends { items?: unknown; error?: string }>(
  statusRead: ReadResult<Status>, profileRead: ReadResult<Profile>, matchRead: ReadResult<Match>,
) {
  const status = statusRead.status === "fulfilled" ? statusRead.value : null;
  const profile = profileRead.status === "fulfilled" ? profileRead.value : null;
  const match = matchRead.status === "fulfilled" ? matchRead.value : null;
  if ([status, profile, match].some(read => read && datingReadDenied(read.response.status)) || status?.body?.loggedIn === false) {
    throw new Error("1:1 매칭을 보려면 로그인 상태를 다시 확인해 주세요.");
  }
  if (!match?.response.ok || !match.body || !Array.isArray(match.body.items)) {
    throw new Error(match?.body?.error || "1:1 매칭 상태를 불러오지 못했어요. 다시 확인해 주세요.");
  }
  const statusBody = status?.body;
  const profileStatus = status?.response.ok && statusBody && (statusBody.loggedIn === true ||
    typeof statusBody.canWrite === "boolean" || typeof statusBody.phoneVerified === "boolean") ? statusBody : null;
  const profileCards = profile?.response.ok && profile.body && Array.isArray(profile.body.items) ? profile.body : null;
  return { profileStatus, profileCards, matches: match.body.items as NonNullable<Match["items"]> };
}
