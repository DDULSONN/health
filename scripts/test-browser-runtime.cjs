/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('node:path');
function loadPlaywright() {
  try { return require('playwright'); }
  catch (error) {
    if (!process.env.CODEX_NODE_PACKAGES) throw error;
    return require(path.join(process.env.CODEX_NODE_PACKAGES, 'playwright'));
  }
}
const { chromium, webkit } = loadPlaywright();
const browserType = process.env.TEST_BROWSER === 'webkit' ? webkit : chromium;
module.exports = {
  // Existing fixtures use this name; engine can be switched by CI.
  chromium: { launch: options => browserType.launch({
    ...options,
    channel: process.env.TEST_BROWSER === 'webkit' ? undefined : process.env.TEST_BROWSER_CHANNEL || undefined,
  }) },
};
