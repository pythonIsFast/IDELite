/* Run only from tests/ui_preview.py against its disposable workspace. */
(async () => {
  const results = [];
  const wait = async (predicate, message) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out: ${message}`);
  };
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    results.push(message);
  };
  const click = selector => {
    const button = document.querySelector(selector);
    if (!button) throw new Error(`Missing ${selector}`);
    button.click();
  };
  const $ = id => document.getElementById(id);
  const headers = { 'X-IDELite-Token': window.IDELITE_BOOTSTRAP.token };
  window.confirm = () => true;
  try {
    await wait(() => document.querySelector('.tab.active') && document.querySelector('.commit-row'), 'initial file and history');
    check($('code-input').value.includes('def run'), 'Initial file loaded');
    check($('cursor-position').textContent === 'Ln 1, Col 1', 'Initial caret is at first line');
    check($('minimap-canvas').width > 0, 'Minimap rendered');
    click('#changed-files .change-file');
    await wait(() => $('diff-output').textContent.includes('+'), 'working diff');
    check(document.querySelector('[data-panel="diff"]').classList.contains('active'), 'Diff panel selected');
    click('#changed-files .change-row button[title="Stage changes"]');
    await wait(() => $('staged-files').childElementCount > 0, 'stage file');
    check($('commit-button').disabled === false, 'Commit enabled for staged files');
    $('commit-message').value = 'UI test commit';
    $('commit-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await wait(() => $('git-history').textContent.includes('UI test commit'), 'new commit in graph');
    check($('staged-section').classList.contains('hidden'), 'Commit cleared staging');
    click('.commit-row');
    await wait(() => $('diff-output').textContent.includes('UI test commit'), 'commit diff');
    check($('diff-output').textContent.includes('UI test commit'), 'History opens commit diff');
    click('[data-view="explorer"]');
    window.prompt = () => 'new-file.py';
    click('.section-actions [data-command="new-file"]');
    await wait(() => document.querySelector('.tab.active')?.dataset.path === 'new-file.py', 'new file tab');
    const input = $('code-input');
    input.value = "print('browser test')\n";
    input.dispatchEvent(new Event('input', { bubbles: true }));
    check(!!document.querySelector('.tab.active .tab-dirty'), 'Editing marks tab dirty');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
    await wait(() => !document.querySelector('.tab.active .tab-dirty'), 'file saved');
    const saved = await fetch('/api/file?path=new-file.py', { headers }).then(response => response.json());
    check(saved.content === input.value, 'Ctrl+S persists file contents');
    click('[data-menu="Edit"]');
    click('#menu-popup [data-command="find"]');
    $('find-input').value = 'browser';
    $('find-input').dispatchEvent(new Event('input', { bubbles: true }));
    check($('find-count').textContent === '1 of 1', 'Find in file selects a match');
    click('[data-command="find-close"]');
    click('[data-command="quick-open"]');
    $('quick-input').value = 'app.py';
    $('quick-input').dispatchEvent(new Event('input', { bubbles: true }));
    $('quick-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(() => document.querySelector('.tab.active')?.dataset.path === 'app.py', 'quick open');
    click('[data-view="outline"]');
    check($('outline-list').textContent.includes('run'), 'Outline reflects active file');
    click('[data-command="toggle-minimap"]');
    check(document.body.classList.contains('no-minimap'), 'Minimap toggle works');
    click('[data-command="toggle-minimap"]');
    click('[data-command="run"]');
    await wait(() => $('run-output').textContent.includes('Process exited with code 0'), 'run output');
    check($('run-output').textContent.includes('after'), 'Run executes the active Python file');
    click('[data-panel="terminal"]');
    $('terminal-input').value = 'pwd';
    $('terminal-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await wait(() => $('terminal-output').textContent.includes('workspace'), 'terminal output');
    check(!$('terminal-form').classList.contains('hidden'), 'Terminal panel remains interactive');
    click('[data-view="source"]');
    if ($('panel').classList.contains('open')) click('.panel [data-command="toggle-panel"]');
  } catch (error) {
    results.push(`FAIL: ${error.stack}`);
  }
  await fetch('/_test/results', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(results) });
})();
