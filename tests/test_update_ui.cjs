const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

// Exercise the update controller without adding a browser dependency to the app.
const app = fs.readFileSync('idelite/static/app.js', 'utf8');
const controller = app.slice(app.indexOf('  async function checkForUpdate()'), app.indexOf('  function showSettings()'));

function fixture() {
  const nodes = {};
  const elements = new Proxy(nodes, { get(target, key) {
    return target[key] ||= { disabled: false, textContent: '', classList: {
      toggle() {}, add() {}, remove() {},
    } };
  } });
  const calls = [];
  const context = vm.createContext({
    state: { update: { available: true, asset_available: true }, files: new Map() },
    elements, document: { body: { classList: { toggle() {} } } },
    window: {}, confirm: () => true, toast: message => calls.push(['toast', message]),
    api: async (url, options) => {
      calls.push(['api', url, options]);
      return { status: 'started', version: '0.2.0' };
    },
  });
  vm.runInContext(controller, context);
  return { context, elements, calls };
}

test('unsaved files block download and shutdown', async () => {
  const { context, calls } = fixture();
  context.state.files.set('main.py', { content: 'changed', savedContent: 'old' });
  await context.runUpdate();
  assert.equal(calls.filter(call => call[0] === 'api').length, 0);
  assert.match(calls[0][1], /unsaved/);
});

test('cancelling confirmation leaves the app untouched', async () => {
  const { context, calls } = fixture();
  context.confirm = () => false;
  await context.runUpdate();
  assert.equal(calls.length, 0);
});

test('successful install locks editing and closes native window once', async () => {
  const { context, elements, calls } = fixture();
  let closes = 0;
  context.window.pywebview = { api: { quit_for_update: async () => { closes++; } } };
  await context.runUpdate();
  await context.runUpdate();
  assert.equal(calls.filter(call => call[0] === 'api').length, 1);
  assert.equal(closes, 1);
  assert.equal(elements['code-input'].readOnly, true);
  assert.equal(context.state.updateBusy, true);
});

test('failed preparation unlocks editing and never closes the window', async () => {
  const { context, elements } = fixture();
  context.api = async () => { throw new Error('Checksum mismatch'); };
  context.window.pywebview = { api: { quit_for_update: () => assert.fail('must not close') } };
  await context.runUpdate();
  assert.equal(context.state.updateBusy, false);
  assert.equal(elements['code-input'].readOnly, false);
  assert.equal(elements['update-button'].disabled, false);
  assert.match(elements['update-status'].textContent, /Checksum/);
});

test('browser mode gives explicit manual shutdown instructions', async () => {
  const { context, elements } = fixture();
  await context.runUpdate();
  assert.match(elements['update-status'].textContent, /headless server/);
});

test('failed update checks discard stale availability', async () => {
  const { context, elements } = fixture();
  context.api = async () => { throw new Error('Offline'); };
  await context.checkForUpdate();
  assert.equal(context.state.update, null);
  assert.equal(elements['update-button'].disabled, false);
  assert.equal(elements['update-status'].textContent, 'Offline');
});

test('check renders available version and install action', async () => {
  const { context, elements } = fixture();
  context.api = async () => ({ supported: true, available: true, asset_available: true,
    current_version: '0.1.0', latest_version: '0.2.0' });
  await context.checkForUpdate();
  assert.equal(elements['update-button'].textContent, 'Install update');
  assert.match(elements['update-status'].textContent, /0.2.0/);
});
