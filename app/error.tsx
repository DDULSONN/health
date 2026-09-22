"use client";

import ErrorRecovery from "@/components/ErrorRecovery";
export default function ErrorPage(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorRecovery {...props} />;
}
