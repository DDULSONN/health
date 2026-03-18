export default function Loading() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="mt-4 animate-pulse rounded-2xl border border-neutral-200 bg-white p-5">
        <div className="h-5 w-32 rounded bg-neutral-200" />
        <div className="mt-3 h-52 rounded-xl bg-neutral-100 md:h-56" />
        <div className="mt-3 flex flex-wrap gap-2">
          <div className="h-5 w-16 rounded-full bg-neutral-100" />
          <div className="h-5 w-20 rounded-full bg-neutral-100" />
          <div className="h-5 w-24 rounded-full bg-neutral-100" />
        </div>
        <div className="mt-4 h-20 rounded-xl bg-neutral-50" />
        <div className="mt-3 h-16 rounded-xl bg-neutral-50" />
      </div>
    </main>
  );
}
