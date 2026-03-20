function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="animate-pulse">
        <div className="flex items-center justify-between gap-3">
          <div className="h-4 w-32 rounded bg-neutral-200" />
          <div className="h-5 w-20 rounded-full bg-neutral-100" />
        </div>
        <div className="mt-3 h-36 rounded-xl bg-neutral-100 md:h-44" />
        <div className="mt-3 flex gap-2">
          <div className="h-8 w-16 rounded-full bg-neutral-100" />
          <div className="h-8 w-20 rounded-full bg-neutral-100" />
          <div className="h-8 w-16 rounded-full bg-neutral-100" />
        </div>
        <div className="mt-3 h-9 w-full rounded-xl bg-neutral-100" />
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="h-9 w-24 rounded-full bg-neutral-200" />
        <div className="h-9 w-28 rounded-full bg-neutral-100" />
        <div className="h-9 w-28 rounded-full bg-neutral-100" />
      </div>

      <div className="mb-6 animate-pulse">
        <div className="h-7 w-32 rounded bg-neutral-200" />
        <div className="mt-2 h-4 w-72 rounded bg-neutral-100" />
        <div className="mt-1 h-4 w-52 rounded bg-neutral-100" />
      </div>

      <div className="mb-4 rounded-2xl border border-pink-200 bg-pink-50/70 p-4">
        <div className="animate-pulse">
          <div className="h-4 w-48 rounded bg-pink-100" />
          <div className="mt-2 h-3 w-64 rounded bg-pink-100/80" />
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        <div className="h-10 w-24 rounded-full bg-neutral-200" />
        <div className="h-10 w-24 rounded-full bg-neutral-100" />
      </div>

      <section className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
        <div className="animate-pulse">
          <div className="h-5 w-24 rounded bg-amber-100" />
          <div className="mt-2 h-3 w-64 rounded bg-amber-100/80" />
          <div className="mt-4 h-56 rounded-2xl bg-white/80" />
        </div>
      </section>

      <div className="space-y-3">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </main>
  );
}
