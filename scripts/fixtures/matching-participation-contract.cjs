/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
// Undo only the reviewed optional read and success-only UI flags. Keep every
// original request, payment, quota and error path pinned to its prior baseline.
// The real handlers and optional read are exercised by participation/action tests.
function withoutParticipationMetadata(source) {
  source = source.replace(/\r\n?/g, '\n');
  for (const [after, before] of [
    ['; has_sent_request?: boolean | null; error?: string', '; error?: string'],
    ['"/api/dating/1on1/my?participation=1"', '"/api/dating/1on1/my"'],
    ['          hasSentRequest: typeof myCardsBody.has_sent_request === "boolean" ? myCardsBody.has_sent_request : null,\n', ''],
    ['          setOneOnOneHome((prev) => prev ? { ...prev, hasSentRequest: true } : prev);\n', ''],
    ['        setOneOnOneHome((prev) => prev ? { ...prev, hasSentRequest: true } : prev);\n', ''],
  ]) {
    assert.equal(source.split(after).length, 2, 'Exact reviewed participation metadata: ' + after);
    source = source.replace(after, before);
  }
  return source;
}
module.exports = { withoutParticipationMetadata };
