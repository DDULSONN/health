export function reportListOptions(req: Request) {
  const params = new URL(req.url).searchParams;
  const status = params.get("status") ?? "all";
  const boundedInt = (value: string | null, fallback: number, min: number, max: number) => {
    if (value === null) return fallback;
    const number = Number(value);
    return Number.isSafeInteger(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };
  return {
    status,
    limit: boundedInt(params.get("limit"), 500, 1, 500),
    offset: boundedInt(params.get("offset"), 0, 0, 100000),
  };
}
