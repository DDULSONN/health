/* eslint-disable @typescript-eslint/no-require-imports */
// Preloaded only in regression-test child processes. Never preload this for Next build.
const deny = () => { throw new Error('Critical tests forbid network access. Use an isolated mock.'); };
globalThis.fetch = deny;
for (const name of ['node:http', 'node:https']) {
  const transport = require(name);
  transport.request = deny;
  transport.get = deny;
}
require('node:net').Socket.prototype.connect = deny;
require('node:tls').connect = deny;
require('node:dgram').createSocket = deny;
