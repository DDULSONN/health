"use client";

import ErrorRecovery from "@/components/ErrorRecovery";
export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  // Root layout/styles may have failed; keep this shell self-contained.
  return <html lang="ko"><body style={{ margin: 0, background: "#fafafa" }}><ErrorRecovery {...props} /></body></html>;
}
