/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const reviewed = require('./profile-state-reviewed-additions.json');
// Only undo the exact reviewed label/notice fragments for legacy hash checks.
// All existing action handlers, permission predicates and contact rendering stay pinned.
function withoutProfileStateNotice(source, file) {
  source = source.replace(/\r\n?/g, '\n');
  for (const { before, after } of reviewed[file]) {
    assert.equal(source.split(after).length, 2, 'Exact reviewed profile-state presentation: ' + file);
    source = source.replace(after, before);
  }
  return source;
}
module.exports = { withoutProfileStateNotice };
