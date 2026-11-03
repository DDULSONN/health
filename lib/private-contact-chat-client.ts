export type PrivateChatMessage = { id: string; mine: boolean; content: string; created_at: string };

export function privateChatMessageId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Chat-only transport. Never retry a mutation; bound fetch AND body decoding,
// including webviews that ignore AbortController.
export async function requestPrivateChat(matchId: string, init: RequestInit, timeoutMs = 10000) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    cancel = () => { reject(Error("대화 요청이 취소됐어요.")); controller.abort(); };
    timer = setTimeout(() => { reject(Error("응답이 늦어지고 있어요. 다시 확인해 주세요.")); controller.abort(); }, timeoutMs);
  });
  if (init.signal?.aborted) cancel();
  else init.signal?.addEventListener("abort", cancel, { once: true });
  try {
    if (init.signal?.aborted) return await interrupted;
    return await Promise.race([
      (async () => {
        const url = "/api/dating/1on1/private-chat" + (init.method === "POST" ? "" : `?matchId=${encodeURIComponent(matchId)}`);
        const response = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
        const body = await response.json().catch(() => null);
        if (!response.ok) return { response, items: null, error: typeof body?.error === "string" && /[가-힣]/.test(body.error) ? body.error : "대화를 확인하지 못했어요. 다시 확인해 주세요." };
        if (!Array.isArray(body?.items) || body.items.length > 100 || body.items.some((item: Partial<PrivateChatMessage> | null) =>
          !item || typeof item.id !== "string" || typeof item.mine !== "boolean" || typeof item.content !== "string" || typeof item.created_at !== "string")) {
          throw Error("대화 내용을 확인하지 못했어요. 다시 확인해 주세요.");
        }
        return { response, items: body.items as PrivateChatMessage[], error: "" };
      })(), interrupted,
    ]);
  } catch (error) {
    throw error instanceof Error && /[가-힣]/.test(error.message) ? error : Error("연결을 확인한 뒤 다시 시도해 주세요.");
  } finally { clearTimeout(timer); init.signal?.removeEventListener("abort", cancel); }
}
