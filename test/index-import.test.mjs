import assert from 'node:assert/strict';
import test from 'node:test';

test('index module can be imported outside a browser for syntax validation', async () => {
  const module = await import('../index.js');

  assert.equal(typeof module.onClean, 'function');
});
