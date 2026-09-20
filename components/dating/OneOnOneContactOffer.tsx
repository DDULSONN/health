"use client";

import type { ReactNode } from "react";
import PaymentCardNotice from "@/components/PaymentCardNotice";
import OneOnOneContactNudge, { ReceivedContactNudge } from "@/components/dating/OneOnOneContactNudge";
import type { OneOnOneContactNudgePresetKey, OneOnOneContactNudgeSummary } from "@/lib/dating-1on1-contact-nudge";
import { ONE_ON_ONE_CONTACT_PRICE_KRW } from "@/lib/dating-contact-price";

type Props = {
  matchId: string;
  name?: string | null;
  included: boolean;
  processing: boolean;
  nudge?: OneOnOneContactNudgeSummary | null;
  nudgeProcessing: boolean;
  onExchange: (matchId: string) => void;
  onNudge: (matchId: string, preset: OneOnOneContactNudgePresetKey) => void;
  help?: ReactNode;
};

export default function OneOnOneContactOffer({ matchId, name, included, processing, nudge, nudgeProcessing, onExchange, onNudge, help }: Props) {
  return (
    <div className="min-w-0">
      <p className="break-words text-sm font-semibold text-neutral-900">
        {name?.trim() ? `${name.trim()}님과 서로 수락했어요` : "서로 수락했어요"}
      </p>
      <p className="mt-1 text-xs leading-5 text-neutral-600">
        {included ? "기존 플러스 혜택으로 추가 결제 없이 연락처를 교환할 수 있어요." : "결제 완료 후 서로의 연락처가 공개돼요."}
      </p>
      {!included && <PaymentCardNotice className="mt-2" />}
      {nudge?.available && nudge.received_from_other ? (
        <div className="mt-3 rounded-xl border border-neutral-200 bg-white p-3">
          <ReceivedContactNudge item={nudge.received_from_other} />
        </div>
      ) : null}
      <button type="button" disabled={processing} onClick={() => onExchange(matchId)}
        className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50">
        {processing ? (included ? "교환 중..." : "결제 준비 중...") : included ? "무료로 번호교환" : `연락처 교환 · ${ONE_ON_ONE_CONTACT_PRICE_KRW.toLocaleString("ko-KR")}원`}
      </button>
      {!included ? (
        <details className="mt-2 text-[11px] leading-5 text-neutral-500">
          <summary className="cursor-pointer py-1">연락처 교환 안내</summary>
          <p className="mt-1">한 분이 결제를 완료하면 두 분 모두 연락처를 확인할 수 있어요. 각각 결제할 필요는 없어요.</p>
          {help}
        </details>
      ) : null}
      <OneOnOneContactNudge matchId={matchId} nudge={nudge} hideReceived processing={nudgeProcessing} onSend={onNudge} />
    </div>
  );
}
