import test from 'node:test';
import assert from 'node:assert/strict';
import { lastFinishedTurn, suggestionAction, type TurnMessage } from '../src/utils/nextPrompt.js';

// When a suggestion is asked for, and what Tab and Enter do with it.
const u = (id: string, text: string): TurnMessage => ({ id, sender: 'user', text });
const a = (id: string, text: string, over: Partial<TurnMessage> = {}): TurnMessage => ({ id, sender: 'assistant', text, ...over });

test('a suggestion is asked for only when an answer has finished, and is tied to that answer', () => {
  const chat = [u('u1', 'Explain osmosis'), a('a1', 'Osmosis is the movement of water.')];
  const t = lastFinishedTurn(chat, false)!; assert.deepEqual([t.user, t.assistant], ['Explain osmosis', 'Osmosis is the movement of water.']);
  assert.equal(lastFinishedTurn(chat, true), null, 'not while it is being written');
  assert.equal(lastFinishedTurn([u('u1', 'Hi')], false), null, 'no answer yet'); assert.equal(lastFinishedTurn([], false), null);
  assert.equal(lastFinishedTurn([...chat, u('u2', 'And?')], false), null, 'the last message is the user\'s');
  assert.equal(lastFinishedTurn([u('u1', 'x'), a('a1', 'working', { isBusy: true })], false), null); assert.equal(lastFinishedTurn([u('u1', 'x'), a('a1', 'thinking', { isThinking: true })], false), null); assert.equal(lastFinishedTurn([u('u1', 'x'), a('a1', '   ')], false), null);
  const next = lastFinishedTurn([...chat, u('u2', 'More'), a('a2', 'More about osmosis.')], false)!;
  assert.equal(next.user, 'More'); assert.notEqual(next.key, t.key, 'a new answer is a new key, so an old suggestion is never shown for it');
  assert.notEqual(lastFinishedTurn([u('u1', 'x'), a('a1', 'short')], false)!.key, lastFinishedTurn([u('u1', 'x'), a('a1', 'short and then longer')], false)!.key, 'a streamed answer that grew counts as a new one');
});

test('Tab fills the suggestion and Enter sends it, only while the box is empty; typing, Shift and no suggestion leave things alone', () => {
  const s = 'Give me three practice questions';
  assert.equal(suggestionAction('Tab', false, '', s), 'fill'); assert.equal(suggestionAction('Enter', false, '', s), 'send'); assert.equal(suggestionAction('Enter', false, '   ', s), 'send', 'spaces only is still empty');
  assert.equal(suggestionAction('Tab', false, 'my own', s), null); assert.equal(suggestionAction('Enter', false, 'my own', s), null);
  assert.equal(suggestionAction('Enter', true, '', s), null, 'Shift+Enter is a new line'); assert.equal(suggestionAction('Tab', false, '', null), null); assert.equal(suggestionAction('a', false, '', s), null);
});
