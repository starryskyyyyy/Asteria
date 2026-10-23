import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown } from '../src/renderer/markdown.js';

test('markdown parser consumes an empty streaming list marker', () => {
  const blocks = parseMarkdown('- ');
  assert.deepEqual(blocks, [{ type: 'list', ordered: false, items: [''], start: 0 }]);
});

test('markdown parser handles longer fenced code delimiters without stalling', () => {
  assert.deepEqual(parseMarkdown('````\ncode\n````'), [{ type: 'code', language: '', text: 'code', start: 0 }]);
});

test('inline or malformed fence lines safely fall back to plain text', () => {
  assert.deepEqual(parseMarkdown('```js ```\nnot inside a recognized fence'), [
    { type: 'paragraph', text: '```js ```\nnot inside a recognized fence', start: 0 },
  ]);
});

test('streaming partial blocks always finish within a line-bounded number of parser steps', () => {
  for (const input of ['- ', '1. ', '```', '````', '```js ```', '#', '-\n- ']) {
    const lines = input.split('\n');
    const blocks = parseMarkdown(input);
    assert.ok(blocks.length > 0, JSON.stringify(input));
    assert.ok(blocks.length <= lines.length, JSON.stringify(input));
  }
});
