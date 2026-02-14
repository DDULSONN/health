import Link from "next/link";
import MyLiftGrowthChart from "@/components/MyLiftGrowthChart";

export default function MyRecordsPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-neutral-900">내 3대 기록</h1>
        <Link href="/mypage" className="text-sm text-emerald-700 hover:underline">
          마이페이지로
        </Link>
      </div>
      <MyLiftGrowthChart />
    </main>
  );
}

