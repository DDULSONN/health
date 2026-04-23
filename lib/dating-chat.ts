import { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

export type DatingChatSourceKind = "open" | "paid" | "swipe";

export type DatingChatResolvedConnection = {
  sourceKind: DatingChatSourceKind;
  sourceId: string;
  currentUserId: string;
  peerUserId: string;
  peerNickname: string;
  title: string;
  createdAt: string;
};

export function isMissingDatingChatRelation(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("relation") ||
    message.includes("could not find the table")
  );
}

async function getNicknameMap(admin: AdminClient, userIds: string[]) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  const nicknameMap = new Map<string, string>();
  if (uniqueIds.length === 0) return nicknameMap;

  const profilesRes = await admin.from("profiles").select("user_id,nickname").in("user_id", uniqueIds);
  if (profilesRes.error) throw profilesRes.error;

  for (const row of profilesRes.data ?? []) {
    nicknameMap.set(String(row.user_id), String(row.nickname ?? "익명").trim() || "익명");
  }

  return nicknameMap;
}

export async function resolveDatingChatConnection(
  admin: AdminClient,
  userId: string,
  sourceKind: DatingChatSourceKind,
  sourceId: string
): Promise<DatingChatResolvedConnection | null> {
  if (sourceKind === "open") {
    const appRes = await admin
      .from("dating_card_applications")
      .select("id,card_id,applicant_user_id,status,created_at")
      .eq("id", sourceId)
      .eq("status", "accepted")
      .maybeSingle();

    if (appRes.error) throw appRes.error;
    if (!appRes.data) return null;

    const cardRes = await admin
      .from("dating_cards")
      .select("id,owner_user_id")
      .eq("id", appRes.data.card_id)
      .maybeSingle();

    if (cardRes.error) throw cardRes.error;
    if (!cardRes.data) return null;
    if (userId !== appRes.data.applicant_user_id && userId !== cardRes.data.owner_user_id) return null;

    const peerUserId =
      userId === appRes.data.applicant_user_id ? cardRes.data.owner_user_id : appRes.data.applicant_user_id;
    const nicknameMap = await getNicknameMap(admin, [peerUserId]);

    return {
      sourceKind,
      sourceId,
      currentUserId: userId,
      peerUserId,
      peerNickname: nicknameMap.get(peerUserId) ?? "익명",
      title: "오픈카드 연결",
      createdAt: appRes.data.created_at,
    };
  }

  if (sourceKind === "paid") {
    const appRes = await admin
      .from("dating_paid_card_applications")
      .select("id,paid_card_id,applicant_user_id,status,created_at")
      .eq("id", sourceId)
      .eq("status", "accepted")
      .maybeSingle();

    if (appRes.error) throw appRes.error;
    if (!appRes.data) return null;

    const cardRes = await admin
      .from("dating_paid_cards")
      .select("id,user_id")
      .eq("id", appRes.data.paid_card_id)
      .maybeSingle();

    if (cardRes.error) throw cardRes.error;
    if (!cardRes.data) return null;
    if (userId !== appRes.data.applicant_user_id && userId !== cardRes.data.user_id) return null;

    const peerUserId =
      userId === appRes.data.applicant_user_id ? cardRes.data.user_id : appRes.data.applicant_user_id;
    const nicknameMap = await getNicknameMap(admin, [peerUserId]);

    return {
      sourceKind,
      sourceId,
      currentUserId: userId,
      peerUserId,
      peerNickname: nicknameMap.get(peerUserId) ?? "익명",
      title: "유료카드 연결",
      createdAt: appRes.data.created_at,
    };
  }

  const matchRes = await admin
    .from("dating_card_swipe_matches")
    .select("id,user_a_id,user_b_id,created_at")
    .eq("id", sourceId)
    .maybeSingle();

  if (matchRes.error) throw matchRes.error;
  if (!matchRes.data) return null;
  if (userId !== matchRes.data.user_a_id && userId !== matchRes.data.user_b_id) return null;

  const peerUserId = userId === matchRes.data.user_a_id ? matchRes.data.user_b_id : matchRes.data.user_a_id;
  const nicknameMap = await getNicknameMap(admin, [peerUserId]);

  return {
    sourceKind,
    sourceId,
    currentUserId: userId,
    peerUserId,
    peerNickname: nicknameMap.get(peerUserId) ?? "익명",
    title: "빠른매칭 연결",
    createdAt: matchRes.data.created_at,
  };
}

export async function listDatingChatConnections(
  admin: AdminClient,
  userId: string
): Promise<DatingChatResolvedConnection[]> {
  const [openMineRes, openOwnerCardsRes, paidMineRes, paidOwnerCardsRes, swipeRes] = await Promise.all([
    admin
      .from("dating_card_applications")
      .select("id,card_id,applicant_user_id,status,created_at")
      .eq("applicant_user_id", userId)
      .eq("status", "accepted")
      .order("created_at", { ascending: false })
      .limit(500),
    admin.from("dating_cards").select("id,owner_user_id").eq("owner_user_id", userId).limit(500),
    admin
      .from("dating_paid_card_applications")
      .select("id,paid_card_id,applicant_user_id,status,created_at")
      .eq("applicant_user_id", userId)
      .eq("status", "accepted")
      .order("created_at", { ascending: false })
      .limit(500),
    admin.from("dating_paid_cards").select("id,user_id").eq("user_id", userId).limit(500),
    admin
      .from("dating_card_swipe_matches")
      .select("id,user_a_id,user_b_id,created_at")
      .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  if (openMineRes.error) throw openMineRes.error;
  if (openOwnerCardsRes.error) throw openOwnerCardsRes.error;
  if (paidMineRes.error) throw paidMineRes.error;
  if (paidOwnerCardsRes.error) throw paidOwnerCardsRes.error;
  if (swipeRes.error) throw swipeRes.error;

  const openOwnerCardIds = (openOwnerCardsRes.data ?? []).map((row) => row.id);
  const paidOwnerCardIds = (paidOwnerCardsRes.data ?? []).map((row) => row.id);

  const [openOwnerAppsRes, paidOwnerAppsRes] = await Promise.all([
    openOwnerCardIds.length > 0
      ? admin
          .from("dating_card_applications")
          .select("id,card_id,applicant_user_id,status,created_at")
          .in("card_id", openOwnerCardIds)
          .eq("status", "accepted")
          .order("created_at", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [], error: null }),
    paidOwnerCardIds.length > 0
      ? admin
          .from("dating_paid_card_applications")
          .select("id,paid_card_id,applicant_user_id,status,created_at")
          .in("paid_card_id", paidOwnerCardIds)
          .eq("status", "accepted")
          .order("created_at", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (openOwnerAppsRes.error) throw openOwnerAppsRes.error;
  if (paidOwnerAppsRes.error) throw paidOwnerAppsRes.error;

  const openCardIds = [...new Set([...(openMineRes.data ?? []).map((row) => row.card_id), ...openOwnerCardIds])];
  const openCardRowsRes =
    openCardIds.length > 0
      ? await admin.from("dating_cards").select("id,owner_user_id").in("id", openCardIds)
      : { data: [], error: null };

  if (openCardRowsRes.error) throw openCardRowsRes.error;
  const openCardMap = new Map((openCardRowsRes.data ?? []).map((row) => [row.id, row.owner_user_id]));

  const paidCardIds = [...new Set([...(paidMineRes.data ?? []).map((row) => row.paid_card_id), ...paidOwnerCardIds])];
  const paidCardRowsRes =
    paidCardIds.length > 0
      ? await admin.from("dating_paid_cards").select("id,user_id").in("id", paidCardIds)
      : { data: [], error: null };

  if (paidCardRowsRes.error) throw paidCardRowsRes.error;
  const paidCardMap = new Map((paidCardRowsRes.data ?? []).map((row) => [row.id, row.user_id]));

  const peerIds = new Set<string>();
  const items: DatingChatResolvedConnection[] = [];

  for (const row of [...(openMineRes.data ?? []), ...(openOwnerAppsRes.data ?? [])]) {
    const ownerUserId = openCardMap.get(row.card_id);
    if (!ownerUserId) continue;
    const peerUserId = row.applicant_user_id === userId ? ownerUserId : row.applicant_user_id;
    peerIds.add(peerUserId);
    items.push({
      sourceKind: "open",
      sourceId: row.id,
      currentUserId: userId,
      peerUserId,
      peerNickname: "",
      title: "오픈카드 연결",
      createdAt: row.created_at,
    });
  }

  for (const row of [...(paidMineRes.data ?? []), ...(paidOwnerAppsRes.data ?? [])]) {
    const ownerUserId = paidCardMap.get(row.paid_card_id);
    if (!ownerUserId) continue;
    const peerUserId = row.applicant_user_id === userId ? ownerUserId : row.applicant_user_id;
    peerIds.add(peerUserId);
    items.push({
      sourceKind: "paid",
      sourceId: row.id,
      currentUserId: userId,
      peerUserId,
      peerNickname: "",
      title: "유료카드 연결",
      createdAt: row.created_at,
    });
  }

  for (const row of swipeRes.data ?? []) {
    const peerUserId = row.user_a_id === userId ? row.user_b_id : row.user_a_id;
    peerIds.add(peerUserId);
    items.push({
      sourceKind: "swipe",
      sourceId: row.id,
      currentUserId: userId,
      peerUserId,
      peerNickname: "",
      title: "빠른매칭 연결",
      createdAt: row.created_at,
    });
  }

  const nicknameMap = await getNicknameMap(admin, [...peerIds]);
  const deduped = new Map<string, DatingChatResolvedConnection>();

  for (const item of items) {
    const key = `${item.sourceKind}:${item.sourceId}`;
    deduped.set(key, {
      ...item,
      peerNickname: nicknameMap.get(item.peerUserId) ?? "익명",
    });
  }

  return [...deduped.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
