const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync('idelite/static/editor.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('idelite/static/source-control.js', 'utf8'), context);
const editor = context.window.IDELiteEditor;
const graphRows = context.window.IDELiteSourceControl.graphRows;

test('highlighting escapes untrusted file contents', () => {
  const result = editor.highlight('value = "<script>alert(1)</script>"', 'python');
  assert.ok(!result.includes('<script>'));
  assert.ok(result.includes('&lt;script&gt;'));
  assert.ok(result.includes('tok-string'));
});

test('Python uses muted comment, keyword, type and function tokens', () => {
  const result = editor.highlight('# comment\nclass Example:\n    def run(self):\n        return True', 'python');
  for (const type of ['comment', 'keyword', 'type', 'function', 'literal']) assert.ok(result.includes(`tok-${type}`));
  assert.ok(result.includes('indent-guide'));
});

test('plain text and large files do not use misleading fallback syntax', () => {
  assert.ok(!editor.highlight('return true;', 'plaintext').includes('tok-'));
  assert.ok(!editor.highlight('x'.repeat(300001), 'python').includes('tok-'));
});

test('outline has real source line numbers', () => {
  const symbols = editor.symbols('# header\nclass App:\n    async def run(self):\n        pass', 'python');
  assert.equal(symbols[0].name, 'App');
  assert.equal(symbols[1].line, 3);
  assert.equal(editor.languageFor('main.rs'), 'rust');
  assert.equal(editor.languageFor('data.json'), 'json');
});

test('minimap draws text without requiring an image dependency', () => {
  const draws = [];
  const canvas = { clientWidth: 100, clientHeight: 400, getContext: () => ({ scale() {}, fillRect(...args) { draws.push(args); } }) };
  editor.minimap(canvas, '# comment\nfunction run() {}');
  assert.equal(canvas.width, 100);
  assert.ok(draws.length > 0);
  assert.ok(draws.every(args => args.every(Number.isFinite)));
});

test('commit graph follows parent relationships, including merges', () => {
  const rows = graphRows([
    { id: 'merge', parents: ['left', 'right'] },
    { id: 'left', parents: ['base'] },
    { id: 'right', parents: ['base'] },
    { id: 'base', parents: [] },
  ]);
  assert.equal(rows[0].edges.filter(edge => edge.start === 14).length, 2);
  assert.ok(rows[2].lane > 0);
  assert.ok(rows[3].incoming);
  assert.ok(rows.flatMap(row => row.edges).every(edge => edge.to >= 0));
});
