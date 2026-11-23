/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');

// Synthetic checkout tests cover these exact additive branches. Continue to
// pin every byte of the prior checkout/disclosure contracts outside them.
const createOnly = [
  'import { createLovePassCheckout, LovePassCheckoutError } from "@/lib/dating-love-pass-checkout";\n',
  '  getLovePassSwipeStatus,\n',
  `      try {
        if (await getLovePassSwipeStatus(admin, user.id)) {
          return json(409, {
            ok: false,
            code: "SWIPE_ALREADY_INCLUDED_IN_LOVE_PASS",
            requestId,
            message: "이용 중인 연애 패스에 빠른매칭 혜택이 포함돼 있어요. 따로 결제하지 않아도 돼요.",
          });
        }
      } catch (error) {
        console.error("[toss-create] Love Pass swipe status check failed", error);
        return json(503, { ok: false, code: "SWIPE_BENEFIT_CHECK_FAILED", requestId, message: "이용 중인 혜택을 확인하지 못했어요. 잠시 후 다시 시도해 주세요." });
      }
`,
  `    if (body.productType === "dating_love_pass_30d") {
      try {
        return json(200, { ...await createLovePassCheckout(createAdminClient(), user, getBaseUrl(req), body.resumedFromOrderId), requestId });
      } catch (error) {
        if (error instanceof LovePassCheckoutError) return json(error.status, { ok: false, code: error.code, requestId, message: error.message });
        throw error;
      }
    }
`,
];

const confirmOnly = [
  'import { activateLovePassOrder, LovePassCheckoutError } from "@/lib/dating-love-pass-checkout";\n',
  '    | "dating_love_pass_30d"\n',
  `async function finalizeLovePassConfirmation(
  admin: ReturnType<typeof createAdminClient>,
  order: TossOrderRow,
  paymentKey: string,
  requestId: string,
  approvedPayment?: TossConfirmPaymentResponse,
) {
  try {
    await activateLovePassOrder(admin, order.toss_order_id, paymentKey, approvedPayment);
  } catch (error) {
    if (error instanceof LovePassCheckoutError) return json(error.status, { ok: false, code: error.code, requestId, message: error.message });
    throw error;
  }
  return json(200, {
    ok: true, requestId, orderId: order.toss_order_id, orderName: order.order_name,
    productType: order.product_type, amount: order.amount, method: approvedPayment?.method ?? null,
    alreadyConfirmed: !approvedPayment,
  });
}

`,
  `      if (order.product_type === "dating_love_pass_30d") {
        return await finalizeLovePassConfirmation(admin, order, paymentKey, requestId);
      }
`,
  `    if (order.product_type === "dating_love_pass_30d") {
      // Do not use the generic paid update. The grant and paid status for this
      // product must both commit or both roll back on duplicate/failed delivery.
      return await finalizeLovePassConfirmation(admin, order, paymentKey, requestId, payment);
    }

`,
];

function withoutLovePassPaymentAdditions(source, kind) {
  source = source.replace(/\r\n/g, '\n');
  for (const addition of kind === 'create' ? createOnly : confirmOnly) {
    assert.equal(source.split(addition).length, 2, 'Exact reviewed love-pass checkout addition: ' + kind);
    source = source.replace(addition, '');
  }
  return source;
}

function withoutLovePassMypageAdditions(source) {
  source = source.replace(/\r\n/g, '\n');
  const additions = [
    '  if (order.product_type === "dating_love_pass_30d") return "짐툴 연애 패스";\n',
    '  if (order.product_type === "dating_love_pass_30d") return "연애 패스 혜택 적용 완료";\n',
    `        amount?: number;
        alreadyActive?: boolean;
      };
      if (res.ok && body.ok && order.product_type === "dating_love_pass_30d" && body.alreadyActive) {
        window.location.href = "/dating/love-pass";
        return;
      }
      if (!res.ok || body.ok === false || !body.checkoutUrl) {
`,
    `                                      : order.product_type === "dating_love_pass_30d"
                                        ? "짐툴 연애 패스"
`,
  ];
  for (const [index, addition] of additions.entries()) {
    assert.equal(source.split(addition).length, 2, 'Exact reviewed love-pass MyPage addition: ' + (index + 1));
    const previous = index === 2 ? `        amount?: number;
      };
      if (!res.ok || body.ok === false || !body.checkoutUrl) {
` : '';
    source = source.replace(addition, previous);
  }
  return withoutSingleCandidateMypageChanges(source);
}

// Recommendation-only UI has its own browser coverage. Validate the exact edits
// before hashing every remaining MyPage byte, including payment/disclosure.
function withoutSingleCandidateMypageChanges(source) {
  const changes = [
    ['import OneOnOneCandidateReplaceButton from "@/components/dating/OneOnOneCandidateReplaceButton";\n', ''],
    ['import OneOnOneCandidateAvailabilityNotice, { firstWaitingSingleCandidateGroup } from "@/components/dating/OneOnOneCandidateAvailabilityNotice";\n', ''],
    ['import { eligibleForSingleCandidateRefresh, useOneOnOneCandidateReplace, type SingleCandidateRefreshFields } from "@/lib/use-one-on-one-candidate-replace";\n', ''],
    ['type MyOneOnOneAutoRecommendationGroup = SingleCandidateRefreshFields & {\n', 'type MyOneOnOneAutoRecommendationGroup = {\n'],
    ['  source_card_id: string;\n  source_card_status?: "submitted" | "reviewing" | "approved" | "rejected";\n', '  impression_ticket?: string | null;\n  source_card_id: string;\n  source_card_status?: "submitted" | "reviewing" | "approved" | "rejected";\n'],
    ['  const oneOnOneReplaceIdentityRef = useRef<string | null>(null);\n  const [oneOnOneReplaceViewerId, setOneOnOneReplaceViewerId] = useState<string | null>(null);\n', ''],
    ['      oneOnOneReplaceIdentityRef.current = next;\n      setOneOnOneReplaceViewerId(next);\n', ''],
    [`  const { replace: replaceOneOnOneCandidate, busy: singleRefreshBusy, notice: singleRefreshNotice } = useOneOnOneCandidateReplace({
    identity: oneOnOneReplaceIdentityRef, viewerId: oneOnOneReplaceViewerId, locks: oneOnOneRefreshLocksRef,
    needsReload: oneOnOneRefreshNeedsReloadRef, reload: () => reloadOneOnOneRecommendations(true, true),
    onReadFailure: setOneOnOneRefreshReadError,
  });

`, ''],
    ['    if (oneOnOneRefreshLocksRef.current.has(sourceCardId) || processingOneOnOneAutoKeys.includes(actionKey)) return;\n', '    if (processingOneOnOneAutoKeys.includes(actionKey)) return;\n'],
    ['    if (oneOnOneRefreshLocksRef.current.has(sourceCardId) || processingOneOnOneFavoriteKeys.includes(actionKey)) return;\n', '    if (processingOneOnOneFavoriteKeys.includes(actionKey)) return;\n'],
    ['blocked={!canRefreshAutoRecommendations || Boolean(oneOnOneRefreshReadError) || singleRefreshBusy?.sourceCardId === item.id}', 'blocked={!canRefreshAutoRecommendations || Boolean(oneOnOneRefreshReadError)}'],
    [`                        {singleRefreshNotice?.sourceCardId === item.id ? <p role="status" className="mt-2 rounded-lg bg-neutral-50 px-3 py-2 text-xs leading-5 text-neutral-700">{singleRefreshNotice.message}</p> : null}
`, ''],
    ['  const waitingSingleCandidateGroup = firstWaitingSingleCandidateGroup(myOneOnOneAutoRecommendations, singleRefreshNotice);\n', ''],
    [`                        {waitingSingleCandidateGroup === autoRecommendationGroup && pageSectionTab === "matching" &&
                          showMatchingGroup(matchingFilter, "one_on_one", myOneOnOneCards.length) && !isArchivedOneOnOneCard && !accountBanStatus?.is_banned &&
                          !singleRefreshBusy && !refreshingOneOnOneRecommendationIds.length && !oneOnOneRefreshReadError &&
                          !processingOneOnOneAutoKeys.length && !processingOneOnOneFavoriteKeys.length && !processingOneOnOneMatchIds.length &&
                          !processingOneOnOneContactExchangeIds.length && !processingOneOnOneNudgeIds.length ?
                          <OneOnOneCandidateAvailabilityNotice group={autoRecommendationGroup} viewerId={oneOnOneReplaceViewerId} identity={oneOnOneReplaceIdentityRef}
                            onRead={() => { void reloadOneOnOneRecommendations(true, true).catch(() => setOneOnOneRefreshReadError("추천 후보를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.")); }} /> : null}
`, ''],
    ['                            const replacing = singleRefreshBusy?.sourceCardId === item.id;\n', ''],
    ['disabled={processing || replacing}', 'disabled={processing}'],
    ['disabled={processing || replacing || processingOneOnOneFavoriteKeys.includes(actionKey)}', 'disabled={processing || processingOneOnOneFavoriteKeys.includes(actionKey)}'],
    ['disabled={processing || replacing || refreshingAutoRecommendations || processingOneOnOneFavoriteKeys.includes(actionKey)}', 'disabled={processing || refreshingAutoRecommendations || processingOneOnOneFavoriteKeys.includes(actionKey)}'],
    [`                                  {!isArchivedOneOnOneCard && oneOnOneReplaceViewerId && autoRecommendationGroup && eligibleForSingleCandidateRefresh(autoRecommendationGroup, card.id) ?
                                    <OneOnOneCandidateReplaceButton busy={replacing && singleRefreshBusy?.candidateId === card.id}
                                      disabled={Boolean(singleRefreshBusy) || refreshingAutoRecommendations || Boolean(oneOnOneRefreshReadError) || processingOneOnOneAutoKeys.length > 0 || processingOneOnOneFavoriteKeys.length > 0}
                                      onClick={() => { void replaceOneOnOneCandidate(autoRecommendationGroup, card.id); }} /> : null}
`, ''],
  ];
  for (const [index, [next, previous]] of changes.entries()) {
    assert.equal(source.split(next).length, 2, 'Exact reviewed single candidate MyPage edit: ' + (index + 1));
    source = source.replace(next, previous);
  }
  return source;
}

function withoutSingleCandidateHomeChanges(source) {
  source = source.replace(/\r\n/g, '\n');
  const changes = [
    ['import { useOneOnOneCandidateReplace } from "@/lib/use-one-on-one-candidate-replace";\n', ''],
    ['  const oneOnOneReplaceIdentityRef = useRef<string | null>(null);\n', ''],
    ['        oneOnOneReplaceIdentityRef.current = state.status === "authenticated" ? state.userId : null;\n', ''],
    ['        oneOnOneReplaceIdentityRef.current = null;\n', ''],
    [`  const reloadOneOnOneRecommendationsOnly = useCallback(async () => {
    if (!viewerLoggedIn || !draftUserId || oneOnOneReplaceIdentityRef.current !== draftUserId) throw new Error("로그인 상태를 다시 확인해 주세요.");
    let updated = false;
    await oneOnOneRecommendationsRequest.run({
      replace: true,
      start: () => { setOneOnOneRecommendationsLoading(true); setOneOnOneRecommendationsError(""); },
      load: async (signal) => {
        const { response, body } = await fetchClientJson<unknown>(
          "/api/dating/1on1/recommendations/my", { cache: "no-store", signal }, 15000,
        );
        if (response.status === 401 || response.status === 403) throw new Error("one_on_one_auth_required");
        if (!response.ok || !isOneOnOneRecommendationPayload(body)) throw new Error("후보 조회 응답을 확인하지 못했어요.");
        return (body as { items: OneOnOneHomeState["recommendations"] }).items;
      },
      commit: (items) => {
        if (oneOnOneReplaceIdentityRef.current !== draftUserId) return;
        setOneOnOneRecommendations(items);
        oneOnOneRefreshNeedsReloadRef.current = false;
        updated = true;
      },
      fail: (error) => {
        if (oneOnOneReplaceIdentityRef.current !== draftUserId) return;
        setOneOnOneRecommendations([]);
        setOneOnOneRecommendationsError("추천 후보를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.");
        if (error instanceof Error && error.message === "one_on_one_auth_required") {
          oneOnOneHomeRequest.cancel();
          setOneOnOneHome(null);
          setOneOnOneHomeViewerId(null);
          setOneOnOneHomeLoading(false);
          setOneOnOneHomeError("로그인 상태와 이용 권한을 다시 확인해 주세요.");
        }
      },
      finish: () => setOneOnOneRecommendationsLoading(false),
    });
    if (!updated) throw new Error("새 후보 명단을 불러오지 못했어요.");
  }, [viewerLoggedIn, draftUserId, oneOnOneHomeRequest, oneOnOneRecommendationsRequest]);

`, ''],
    [`  const { replace: replaceOneOnOneCandidate, busy: singleRefreshBusy, notice: singleRefreshNotice } = useOneOnOneCandidateReplace({
    identity: oneOnOneReplaceIdentityRef, viewerId: draftUserId, locks: oneOnOneRefreshLocksRef,
    needsReload: oneOnOneRefreshNeedsReloadRef, reload: reloadOneOnOneRecommendationsOnly,
    onReadFailure: setOneOnOneRecommendationsError,
  });

`, ''],
    ['      if (oneOnOneRefreshLocksRef.current.has(sourceCardId) || processingOneOnOneAutoKeys.includes(actionKey)) return;\n', '      if (processingOneOnOneAutoKeys.includes(actionKey)) return;\n'],
    ['          onRetryRecommendations={() => { void reloadOneOnOneRecommendationsOnly().catch(() => {}); }}\n', ''],
    [`          onReplaceCandidate={replaceOneOnOneCandidate}
          singleRefreshBusy={singleRefreshBusy}
          singleRefreshNotice={singleRefreshNotice}
          singleRefreshViewerId={draftUserId}
          singleRefreshIdentity={oneOnOneReplaceIdentityRef}
`, ''],
  ];
  for (const [index, [next, previous]] of changes.entries()) {
    assert.equal(source.split(next).length, 2, 'Exact reviewed single candidate Home edit: ' + (index + 1));
    source = source.replace(next, previous);
  }
  return source;
}

function withoutSingleCandidatePanelChanges(source) {
  source = source.replace(/\r\n/g, '\n');
  const changes = [
    ['import OneOnOneCandidateReplaceButton from "@/components/dating/OneOnOneCandidateReplaceButton";\n', ''],
    ['import OneOnOneCandidateAvailabilityNotice, { firstWaitingSingleCandidateGroup } from "@/components/dating/OneOnOneCandidateAvailabilityNotice";\n', ''],
    ['import { eligibleForSingleCandidateRefresh, type SingleCandidateRefreshFields, type SingleCandidateRefreshNotice } from "@/lib/use-one-on-one-candidate-replace";\n', ''],
    ['type OneOnOneRecommendationGroup = SingleCandidateRefreshFields & {\n', 'type OneOnOneRecommendationGroup = {\n'],
    ['  expansion_enabled?: boolean;\n  source_card_status?: string;\n', '  impression_ticket?: string | null;\n  expansion_enabled?: boolean;\n  source_card_id?: string;\n  source_card_status?: string;\n'],
    ['  onReplaceCandidate,\n  singleRefreshBusy,\n  singleRefreshNotice,\n  singleRefreshViewerId,\n  singleRefreshIdentity,\n', ''],
    ['  onRetryRecommendations,\n', ''],
    ['  onRetryRecommendations?: () => void;\n', ''],
    ['data-recommendation-retry onClick={onRetryRecommendations ?? onReload}', 'data-recommendation-retry onClick={onReload}'],
    [`  onReplaceCandidate?: (group: SingleCandidateRefreshFields, candidateId: string) => Promise<void>;
  singleRefreshBusy?: { sourceCardId: string; candidateId: string } | null;
  singleRefreshNotice?: SingleCandidateRefreshNotice | null;
  singleRefreshViewerId?: string | null;
  singleRefreshIdentity?: import("react").RefObject<string | null>;
`, ''],
    ['                     const replacing = singleRefreshBusy?.sourceCardId === sourceCardId;\n', ''],
    ['disabled={!canSelect || replacing || processingAutoKeys.includes(actionKey) || favoriteBusyKeys.includes(actionKey)}', 'disabled={!canSelect || processingAutoKeys.includes(actionKey) || favoriteBusyKeys.includes(actionKey)}'],
    ['disabled={!canSelect || refreshing || replacing || processingAutoKeys.includes(actionKey) || favoriteBusyKeys.includes(actionKey)}', 'disabled={!canSelect || refreshing || processingAutoKeys.includes(actionKey) || favoriteBusyKeys.includes(actionKey)}'],
    ['disabled={!canSelect || refreshing || replacing || processingAutoKeys.length > 0}', 'disabled={!canSelect || refreshing || processingAutoKeys.length > 0}'],
    [`                            {!additional && onReplaceCandidate && eligibleForSingleCandidateRefresh(group, candidateId) ?
                              <OneOnOneCandidateReplaceButton busy={replacing && singleRefreshBusy?.candidateId === candidateId}
                                disabled={Boolean(singleRefreshBusy) || refreshing || processingAutoKeys.length > 0 || favoriteBusyKeys.length > 0 || Boolean(error)}
                                onClick={() => { void onReplaceCandidate(group, candidateId); }} /> : null}
`, ''],
    ['blocked={!canRefresh || replacing || favoriteBusyKeys.length > 0}', 'blocked={!canRefresh || favoriteBusyKeys.length > 0}'],
    [`                        {singleRefreshNotice?.sourceCardId === sourceCardId ? <p role="status" className="mt-2 rounded-lg bg-neutral-50 px-3 py-2 text-xs leading-5 text-neutral-700">{singleRefreshNotice.message}</p> : null}
`, ''],
    ['  const waitingSingleCandidateGroup = firstWaitingSingleCandidateGroup(displayedGroups, singleRefreshNotice);\n', ''],
    [`                        {group === waitingSingleCandidateGroup && viewerLoggedIn && !sessionError && !singleRefreshBusy && !refreshingRecommendationIds.length &&
                          !processingAutoKeys.length && !processingMatchIds.length && !processingContactIds.length &&
                          !processingNudgeIds.length && !favoriteBusyKeys.length ?
                          <OneOnOneCandidateAvailabilityNotice group={group} viewerId={singleRefreshViewerId} identity={singleRefreshIdentity} onRead={onRetryRecommendations} /> : null}
`, ''],
  ];
  for (const [index, [next, previous]] of changes.entries()) {
    assert.equal(source.split(next).length, 2, 'Exact reviewed single candidate Home panel edit: ' + (index + 1));
    source = source.replace(next, previous);
  }
  return source;
}

module.exports = { withoutLovePassPaymentAdditions, withoutLovePassMypageAdditions, withoutSingleCandidateHomeChanges, withoutSingleCandidatePanelChanges };
