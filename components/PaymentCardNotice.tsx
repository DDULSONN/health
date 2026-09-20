import { PAYMENT_CARD_NOTICE } from "@/lib/payment-card-notice";

export default function PaymentCardNotice({ className = "", prominent = false }: { className?: string; prominent?: boolean }) {
  return (
    <p className={`rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 leading-5 text-amber-900 ${prominent ? "text-sm font-medium" : "text-xs"} ${className}`}>
      {PAYMENT_CARD_NOTICE}
    </p>
  );
}
