/* eslint-disable @typescript-eslint/no-require-imports */
const publicOrigins = new Set(['https://helchang.com', 'https://api.helchang.com']);

function getOrigin(raw) {
  const url = new URL(raw);
  const local = url.protocol === 'http:' && url.hostname === '127.0.0.1' && Boolean(url.port);
  if ((!local && !publicOrigins.has(url.origin)) || url.username || url.password || url.pathname !== '/' ||
      url.search || url.hash) throw new Error('Choose an explicit GymTools origin or a 127.0.0.1 fixture port.');
  return url.origin;
}

async function run(base, fetchImpl = fetch) {
  const origin = getOrigin(base);
  const checks = [
    ['landing', '/landing', async (r) => r.status === 200 &&
      r.headers.get('content-type')?.includes('text/html') && (await r.text()).includes('짐툴')],
    ['matching entry', '/community/dating/cards?tab=one_on_one', async (r) => r.status === 200 &&
      r.headers.get('content-type')?.includes('text/html')],
    ['admin rejects guest', '/api/admin/operations', async (r) => [401, 403].includes(r.status) &&
      !r.headers.get('cache-control')?.includes('public') &&
      r.headers.get('content-type')?.includes('application/json') && !('counts' in await r.json())],
  ];
  return Promise.all(checks.map(async ([name, path, verify]) => {
    try {
      const r = await fetchImpl(new URL(path, origin), {
        method: 'GET', credentials: 'omit', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(8_000),
      });
      return { name, status: r.status, ok: Boolean(await verify(r)) };
    } catch {
      return { name, status: null, ok: false };
    }
  }));
}

module.exports = { getOrigin, run };
if (require.main === module) {
  run(process.argv[2]).then((checks) => {
    console.log(JSON.stringify(checks));
    if (checks.some((check) => !check.ok)) process.exitCode = 1;
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
