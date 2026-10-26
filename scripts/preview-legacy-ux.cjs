const path = require('node:path');
const { start: base } = require('./preview-site-button-tone.cjs');
const start = (options = {}) => base({ ...options, entry: path.join(__dirname, 'fixtures/legacy-ux-browser.tsx'), adapter: path.join(__dirname, 'fixtures/legacy-ux-adapters.tsx') });
module.exports = { start };
if (require.main === module) start({ port: Number(process.argv[2] || 3181) }).then(value => console.log(JSON.stringify({ origin: value.origin, output: value.output })));
