import type { Metadata } from "next";
import { Suspense } from "react";
import AdminUnlockClient from "./AdminUnlockClient";

export const metadata: Metadata = {
  title: "관리자 2차 확인",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminUnlockPage() {
  return (
    <Suspense fallback={null}>
      <AdminUnlockClient />
    </Suspense>
  );
}
