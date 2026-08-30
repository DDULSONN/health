import { NO_INDEX_METADATA } from "@/lib/seo";

export const metadata = NO_INDEX_METADATA;

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
