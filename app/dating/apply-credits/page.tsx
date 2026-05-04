"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import DatingAdultNotice from "@/components/DatingAdultNotice";
import PaidPolicyNotice from "@/components/PaidPolicyNotice";
import { createClient } from "@/lib/supabase/client";

type ApplyCreditsStatusResponse = {
  ok?: boolean;
  loggedIn?: boolean;
  baseRemaining?: number;
  creditsRemaining?: number;
};

const OPEN_KAKAO_URL = "https://open.kakao.com/o/s2gvTdhi";
const PACK_SIZE = 3;
const PACK_AMOUNT = 5000;

const TEXT = {
  openCards: "\uC624\uD508\uCE74\uB4DC",
  applyCredits: "\uC9C0\uC6D0\uAD8C \uAD6C\uB9E4",
  moreView: "\uC774\uC0C1\uD615 \uB354\uBCF4\uAE30",
  title: "\uC624\uD508\uCE74\uB4DC \uC9C0\uC6D0\uAD8C \uAD6C\uB9E4",
  intro1:
    "\uC9C0\uC6D0\uAD8C\uC774 \uC788\uC73C\uBA74 \uAE30\uBCF8 \uD558\uB8E8 2\uC7A5 \uC678\uC5D0 \uCD94\uAC00\uB85C \uC624\uD508\uCE74\uB4DC \uC9C0\uC6D0\uC774 \uAC00\uB2A5\uD574\uC694.",
  intro2:
    "\uD604\uC7AC\uB294 \uCE74\uCE74\uC624\uD398\uC774 \uAC04\uD3B8\uACB0\uC81C\uB85C\uB9CC \uACB0\uC81C \uAC00\uB2A5\uD574\uC694. \uADF8 \uBC16\uC758 \uACB0\uC81C \uBB38\uC758\uB294 \uC624\uD508\uCE74\uD1A1\uC73C\uB85C \uBD80\uD0C1\uB4DC\uB824\uC694.",
  packInfo: `1\uC138\uD2B8 ${PACK_SIZE}\uC7A5 / ${PACK_AMOUNT.toLocaleString("ko-KR")}\uC6D0`,
  currentStatus: "\uD604\uC7AC \uBCF4\uC720 \uD604\uD669",
  todayBase: "\uC624\uB298 \uAE30\uBCF8 \uC9C0\uC6D0 \uAC00\uB2A5 \uC218",
  extraCredits: "\uCD94\uAC00 \uC9C0\uC6D0\uAD8C",
  purchaseGuide: "\uAD6C\uB9E4 \uC548\uB0B4",
  productName: "\uC0C1\uD488\uBA85: \uC624\uD508\uCE74\uB4DC \uC9C0\uC6D0\uAD8C",
  composition: "\uAD6C\uC131: 3\uC7A5",
  amount: "\uAE08\uC561: 5,000\uC6D0",
  reflected: "\uACB0\uC81C \uC644\uB8CC \uD6C4 \uBC14\uB85C \uC794\uC5EC \uC9C0\uC6D0\uAD8C\uC5D0 \uBC18\uC601\uB429\uB2C8\uB2E4.",
  preparing: "\uACB0\uC81C\uCC3D \uC900\uBE44 \uC911...",
  checkout: "\uCE74\uCE74\uC624\uD398\uC774\uB85C \uACB0\uC81C",
  kakaoInquiry: "\uC624\uD508\uCE74\uD1A1 \uBB38\uC758",
  loginRequired: "\uB85C\uADF8\uC778 \uD6C4 \uACB0\uC81C\uD560 \uC218 \uC788\uC5B4\uC694.",
  createFail: "\uACB0\uC81C \uC694\uCCAD\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
  checkoutFail: "\uACB0\uC81C\uCC3D\uC744 \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.",
  networkFail: "\uACB0\uC81C \uC694\uCCAD \uCC98\uB9AC \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.",
} as const;

export default function ApplyCreditsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [loggedIn, setLoggedIn] = useState(false);
  const [baseRemaining, setBaseRemaining] = useState(0);
  const [creditsRemaining, setCreditsRemaining] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token ?? null;

      setLoggedIn(Boolean(accessToken));

      const res = await fetch("/api/dating/apply-credits/status", {
        cache: "no-store",
        headers: accessToken
          ? {
              Authorization: `Bearer ${accessToken}`,
            }
          : undefined,
      });
      if (!res.ok) return;
      const body = (await res.json()) as ApplyCreditsStatusResponse;
      setLoggedIn(body.loggedIn === true || Boolean(accessToken));
      setBaseRemaining(Math.max(0, Number(body.baseRemaining ?? 0)));
      setCreditsRemaining(Math.max(0, Number(body.creditsRemaining ?? 0)));
    } catch {
      // ignore
    }
  }, [supabase]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleCheckout = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token ?? null;

      if (!accessToken) {
        alert(TEXT.loginRequired);
        return;
      }

      const res = await fetch("/api/payments/toss/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ productType: "apply_credits" }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        checkoutUrl?: string;
      };

      if (!res.ok) {
        alert(body.message ?? TEXT.createFail);
        return;
      }

      if (!body.checkoutUrl) {
        alert(body.message ?? TEXT.checkoutFail);
        return;
      }

      window.location.href = body.checkoutUrl;
    } catch {
      alert(TEXT.networkFail);
    } finally {
      setSubmitting(false);
    }
  }, [submitting, supabase]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-4 flex items-center gap-2">
        <Link
          href="/community/dating/cards"
          className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          {TEXT.openCards}
        </Link>
        <span className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700">
          {TEXT.applyCredits}
        </span>
        <Link
          href="/dating/more-view"
          className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          {TEXT.moreView}
        </Link>
      </div>

      <section className="rounded-[28px] border border-emerald-200 bg-emerald-50 p-5">
        <h1 className="text-xl font-black tracking-tight text-emerald-950">{TEXT.title}</h1>
        <p className="mt-2 text-sm font-semibold text-emerald-900">{TEXT.intro1}</p>
        <p className="mt-2 text-sm text-emerald-800">{TEXT.intro2}</p>
        <p className="mt-1 text-xs text-emerald-700">{TEXT.packInfo}</p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-emerald-200 bg-white/85 p-4">
            <p className="text-sm font-semibold text-emerald-900">{TEXT.currentStatus}</p>
            <ul className="mt-2 space-y-1 text-xs leading-5 text-emerald-800">
              <li>
                {TEXT.todayBase}: {baseRemaining}\uC7A5
              </li>
              <li>
                {TEXT.extraCredits}: {creditsRemaining}\uC7A5
              </li>
            </ul>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-white/85 p-4">
            <p className="text-sm font-semibold text-emerald-900">{TEXT.purchaseGuide}</p>
            <ul className="mt-2 space-y-1 text-xs leading-5 text-emerald-800">
              <li>{TEXT.productName}</li>
              <li>{TEXT.composition}</li>
              <li>{TEXT.amount}</li>
              <li>{TEXT.reflected}</li>
            </ul>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleCheckout()}
            disabled={!loggedIn || submitting}
            className="inline-flex min-h-[42px] items-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? TEXT.preparing : TEXT.checkout}
          </button>
          <a
            href={OPEN_KAKAO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[42px] items-center rounded-xl border border-emerald-300 bg-white px-4 text-sm font-semibold text-emerald-800 hover:bg-emerald-50"
          >
            {TEXT.kakaoInquiry}
          </a>
          {!loggedIn ? <span className="inline-flex items-center text-xs text-neutral-500">{TEXT.loginRequired}</span> : null}
        </div>
      </section>

      <DatingAdultNotice />
      <PaidPolicyNotice />
    </main>
  );
}
