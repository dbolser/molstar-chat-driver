import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PromptHistory } from '../src/history';

test('prev walks back from newest to oldest, then stops', () => {
  const h = new PromptHistory();
  h.add('one');
  h.add('two');
  assert.equal(h.prev(''), 'two');
  assert.equal(h.prev('two'), 'one');
  assert.equal(h.prev('one'), null); // already at the oldest — leave the box alone
});

test('next walks forward and restores the in-progress draft', () => {
  const h = new PromptHistory();
  h.add('one');
  h.add('two');
  h.prev('half-typed'); // -> 'two', stashes the draft
  h.prev('two'); // -> 'one'
  assert.equal(h.next(), 'two');
  assert.equal(h.next(), 'half-typed'); // back to what was being typed
  assert.equal(h.next(), null); // already on the draft
});

test('prev returns null when there is nothing to recall', () => {
  const h = new PromptHistory();
  assert.equal(h.prev('typing'), null);
});

test('adding a prompt after navigating resets the cursor to newest', () => {
  const h = new PromptHistory();
  h.add('one');
  h.add('two');
  h.prev(''); // 'two'
  h.prev('two'); // 'one'
  h.add('three'); // new submission — cursor parks at the draft again
  assert.equal(h.prev(''), 'three');
});
