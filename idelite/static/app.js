(() => {
  "use strict";

  const bootstrap = window.IDELITE_BOOTSTRAP;
  const elements = Object.fromEntries([
    "title-workspace", "workspace-name", "file-tree", "tabs", "breadcrumbs", "welcome", "editor",
    "line-numbers", "highlight", "code-input", "panel", "terminal-output", "terminal-form",
    "terminal-input", "terminal-prompt", "status-message", "cursor-position", "indent-status",
    "language-status", "quick-open", "quick-input", "quick-results", "settings-modal", "search-form",
    "search-input", "search-summary", "search-results", "git-output", "git-badge", "branch-status",
    "setting-font-size", "setting-tab-size", "setting-word-wrap", "toast-region", "update-section",
    "update-status", "update-button", "update-badge"
  ].map(id => [id, document.getElementById(id)]));

  const state = {
    workspace: bootstrap.workspace,
    workspaceName: bootstrap.name,
    tree: [],
    files: new Map(),
    activePath: null,
    selectedPath: null,
    settings: { fontSize: 14, tabSize: 4, wordWrap: false },
    update: null,
    updateBusy: false,
    updateChecking: false,
    terminalHistory: [],
    terminalHistoryIndex: 0,
  };

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("X-IDELite-Token", bootstrap.token);
    if (options.body && typeof options.body !== "string") {
      headers.set("Content-Type", "application/json");
      options.body = JSON.stringify(options.body);
    }
    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => ({ error: response.statusText }));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  function iconFor(path, type) {
    if (type === "directory") return { text: "◆", className: "folder" };
    const extension = path.split(".").pop().toLowerCase();
    const icons = {
      py: ["Py", "python"], js: ["JS", "javascript"], mjs: ["JS", "javascript"],
      html: ["<>", "html"], htm: ["<>", "html"], css: ["#", "css"],
      json: ["{}", "javascript"], md: ["M↓", ""], sh: [">_", ""],
    };
    const [text, className] = icons[extension] || ["·", ""];
    return { text, className };
  }

  function renderTree() {
    elements["file-tree"].replaceChildren(...renderNodes(state.tree, 0));
  }

  function renderNodes(nodes, depth) {
    const result = [];
    for (const node of nodes) {
      const wrapper = document.createElement("div");
      const row = document.createElement("div");
      row.className = `tree-row${node.path === state.selectedPath ? " selected" : ""}`;
      row.style.paddingLeft = `${5 + depth * 13}px`;
      row.dataset.path = node.path;
      row.title = node.path;

      const chevron = document.createElement("span");
      chevron.className = "tree-chevron";
      chevron.textContent = node.type === "directory" ? "⌄" : "";
      const icon = document.createElement("span");
      const iconData = iconFor(node.path, node.type);
      icon.className = `tree-icon ${iconData.className}`;
      icon.textContent = iconData.text;
      const label = document.createElement("span");
      label.className = "tree-label";
      label.textContent = node.name;
      row.append(chevron, icon, label);
      wrapper.append(row);

      if (node.type === "directory") {
        const children = document.createElement("div");
        children.className = "tree-children";
        children.append(...renderNodes(node.children || [], depth + 1));
        wrapper.append(children);
        row.addEventListener("click", () => {
          const closed = children.classList.toggle("collapsed");
          chevron.classList.toggle("closed", closed);
          selectTreePath(node.path);
        });
      } else {
        row.addEventListener("click", () => {
          selectTreePath(node.path);
          openFile(node.path);
        });
      }
      result.push(wrapper);
    }
    return result;
  }

  function selectTreePath(path) {
    state.selectedPath = path;
    document.querySelectorAll(".tree-row.selected").forEach(row => row.classList.remove("selected"));
    document.querySelector(`.tree-row[data-path="${CSS.escape(path)}"]`)?.classList.add("selected");
  }

  async function refreshTree() {
    try {
      const data = await api("/api/tree");
      state.tree = data.items;
      renderTree();
      updateQuickResults(elements["quick-input"].value);
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function openFile(path, line = null) {
    try {
      let file = state.files.get(path);
      if (!file) {
        const data = await api(`/api/file?path=${encodeURIComponent(path)}`);
        file = { path, content: data.content, savedContent: data.content, scrollTop: 0, scrollLeft: 0 };
        state.files.set(path, file);
      }
      activateFile(path);
      if (line) goToLine(line);
    } catch (error) {
      toast(error.message, true);
    }
  }

  function activateFile(path) {
    if (state.activePath && state.files.has(state.activePath)) {
      const previous = state.files.get(state.activePath);
      previous.scrollTop = elements["code-input"].scrollTop;
      previous.scrollLeft = elements["code-input"].scrollLeft;
    }
    const file = state.files.get(path);
    if (!file) return;
    state.activePath = path;
    elements["welcome"].classList.add("hidden");
    elements.editor.classList.remove("hidden");
    elements["code-input"].value = file.content;
    elements["code-input"].scrollTop = file.scrollTop;
    elements["code-input"].scrollLeft = file.scrollLeft;
    renderTabs();
    updateEditor();
    updateBreadcrumbs();
    elements["code-input"].focus();
  }

  function renderTabs() {
    elements.tabs.replaceChildren();
    for (const [path, file] of state.files) {
      const tab = document.createElement("button");
      tab.className = `tab${path === state.activePath ? " active" : ""}`;
      tab.dataset.path = path;
      tab.title = path;
      const icon = document.createElement("span");
      const iconData = iconFor(path, "file");
      icon.className = `tree-icon ${iconData.className}`;
      icon.textContent = iconData.text;
      const name = document.createElement("span");
      name.className = "tab-name";
      name.textContent = path.split("/").pop();
      const action = document.createElement("span");
      const dirty = file.content !== file.savedContent;
      action.className = dirty ? "tab-dirty" : "tab-close";
      action.textContent = dirty ? "" : "×";
      action.title = "Close";
      action.addEventListener("click", event => {
        event.stopPropagation();
        closeFile(path);
      });
      tab.append(icon, name, action);
      tab.addEventListener("click", () => activateFile(path));
      elements.tabs.append(tab);
    }
  }

  function closeFile(path) {
    const file = state.files.get(path);
    if (!file) return;
    if (file.content !== file.savedContent && !confirm(`Close ${path} without saving?`)) return;
    const paths = [...state.files.keys()];
    const index = paths.indexOf(path);
    state.files.delete(path);
    if (state.activePath === path) {
      const next = paths[index + 1] || paths[index - 1];
      state.activePath = null;
      if (next && state.files.has(next)) activateFile(next);
      else showWelcome();
    }
    renderTabs();
  }

  function showWelcome() {
    state.activePath = null;
    elements.editor.classList.add("hidden");
    elements.welcome.classList.remove("hidden");
    elements.breadcrumbs.textContent = "IDELite › Welcome";
    elements["language-status"].textContent = "Plain Text";
  }

  async function saveActive() {
    if (!state.activePath) return;
    const file = state.files.get(state.activePath);
    try {
      setStatus(`Saving ${state.activePath}…`);
      await api("/api/file", { method: "PUT", body: { path: state.activePath, content: file.content } });
      file.savedContent = file.content;
      renderTabs();
      setStatus("Saved", 1500);
    } catch (error) {
      toast(error.message, true);
      setStatus("Save failed", 2000);
    }
  }

  function updateEditor() {
    const text = elements["code-input"].value;
    if (state.activePath) state.files.get(state.activePath).content = text;
    const lineCount = Math.max(1, text.split("\n").length);
    elements["line-numbers"].textContent = Array.from({ length: lineCount }, (_, index) => index + 1).join("\n");
    elements.highlight.innerHTML = highlightCode(text, languageFor(state.activePath));
    syncEditorScroll();
    updateCursor();
    renderTabs();
  }

  function highlightCode(code, language) {
    const definitions = {
      python: {
        comment: "#[^\\n]*", string: "(?:\\\"\\\"\\\"[\\s\\S]*?\\\"\\\"\\\"|'(?:\\\\.|[^'\\\\])*'|\"(?:\\\\.|[^\"\\\\])*\")",
        keyword: "\\b(?:and|as|assert|async|await|break|case|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|match|nonlocal|not|or|pass|raise|return|try|while|with|yield)\\b",
        literal: "\\b(?:True|False|None|self)\\b"
      },
      javascript: {
        comment: "(?:\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*)", string: "(?:`(?:\\\\.|[^`\\\\])*`|'(?:\\\\.|[^'\\\\])*'|\"(?:\\\\.|[^\"\\\\])*\")",
        keyword: "\\b(?:async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|super|switch|throw|try|typeof|var|while|yield)\\b",
        literal: "\\b(?:true|false|null|undefined|this)\\b"
      },
      css: {
        comment: "\\/\\*[\\s\\S]*?\\*\\/", string: "(?:'(?:\\\\.|[^'\\\\])*'|\"(?:\\\\.|[^\"\\\\])*\")",
        keyword: "(?:--[\\w-]+|#[a-fA-F0-9]{3,8})", literal: "\\b(?:inherit|initial|unset|auto|none|transparent|important)\\b"
      },
      html: {
        comment: "<!--[\\s\\S]*?-->", string: "(?:'(?:\\\\.|[^'\\\\])*'|\"(?:\\\\.|[^\"\\\\])*\")",
        keyword: "<\\/?[A-Za-z][^>]*>", literal: "&[A-Za-z]+;"
      }
    };
    const definition = definitions[language] || definitions.javascript;
    const number = "\\b(?:0x[\\da-fA-F]+|\\d+(?:\\.\\d+)?)\\b";
    const regex = new RegExp(`(${definition.comment})|(${definition.string})|(${definition.keyword})|(${number})|(${definition.literal})`, "gm");
    let result = "";
    let position = 0;
    for (const match of code.matchAll(regex)) {
      result += escapeHtml(code.slice(position, match.index));
      const type = match[1] ? "comment" : match[2] ? "string" : match[3] ? (language === "html" ? "tag" : "keyword") : match[4] ? "number" : "literal";
      result += `<span class="tok-${type}">${escapeHtml(match[0])}</span>`;
      position = match.index + match[0].length;
    }
    result += escapeHtml(code.slice(position));
    return result + (code.endsWith("\n") ? " " : "");
  }

  function escapeHtml(value) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }

  function languageFor(path) {
    const extension = (path || "").split(".").pop().toLowerCase();
    const languages = { py: "python", js: "javascript", mjs: "javascript", ts: "javascript", json: "javascript", html: "html", htm: "html", css: "css" };
    return languages[extension] || "plaintext";
  }

  function languageLabel(path) {
    const names = { python: "Python", javascript: "JavaScript", html: "HTML", css: "CSS", plaintext: "Plain Text" };
    return names[languageFor(path)];
  }

  function updateBreadcrumbs() {
    if (!state.activePath) return;
    elements.breadcrumbs.textContent = `${state.workspaceName} › ${state.activePath.split("/").join(" › ")}`;
    elements["language-status"].textContent = languageLabel(state.activePath);
  }

  function syncEditorScroll() {
    elements.highlight.scrollTop = elements["code-input"].scrollTop;
    elements.highlight.scrollLeft = elements["code-input"].scrollLeft;
    elements["line-numbers"].scrollTop = elements["code-input"].scrollTop;
  }

  function updateCursor() {
    const input = elements["code-input"];
    const before = input.value.slice(0, input.selectionStart).split("\n");
    elements["cursor-position"].textContent = `Ln ${before.length}, Col ${before.at(-1).length + 1}`;
  }

  function insertAtCursor(text) {
    const input = elements["code-input"];
    const start = input.selectionStart;
    input.setRangeText(text, start, input.selectionEnd, "end");
    input.dispatchEvent(new Event("input"));
  }

  async function createItem(kind) {
    const baseNode = findNode(state.tree, state.selectedPath);
    let base = "";
    if (baseNode?.type === "directory") base = `${baseNode.path}/`;
    else if (baseNode?.path.includes("/")) base = `${baseNode.path.slice(0, baseNode.path.lastIndexOf("/"))}/`;
    const path = prompt(`New ${kind === "directory" ? "folder" : "file"} path`, base);
    if (!path) return;
    try {
      await api("/api/file", { method: "POST", body: { path, type: kind } });
      await refreshTree();
      if (kind === "file") openFile(path);
    } catch (error) {
      toast(error.message, true);
    }
  }

  function findNode(nodes, path) {
    if (!path) return null;
    for (const node of nodes) {
      if (node.path === path) return node;
      const child = findNode(node.children || [], path);
      if (child) return child;
    }
    return null;
  }

  function flattenFiles(nodes, result = []) {
    for (const node of nodes) {
      if (node.type === "file") result.push(node.path);
      else flattenFiles(node.children || [], result);
    }
    return result;
  }

  function showQuickOpen() {
    elements["quick-open"].classList.remove("hidden");
    elements["quick-input"].value = "";
    updateQuickResults("");
    elements["quick-input"].focus();
  }

  function updateQuickResults(query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const files = flattenFiles(state.tree).filter(path => words.every(word => path.toLowerCase().includes(word))).slice(0, 80);
    elements["quick-results"].replaceChildren(...files.map((path, index) => {
      const item = document.createElement("div");
      item.className = `quick-item${index === 0 ? " active" : ""}`;
      const name = document.createElement("span");
      name.textContent = path.split("/").pop();
      const parent = document.createElement("small");
      parent.textContent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : state.workspaceName;
      item.append(name, parent);
      item.addEventListener("click", () => {
        elements["quick-open"].classList.add("hidden");
        openFile(path);
      });
      return item;
    }));
  }

  async function searchWorkspace(event) {
    event?.preventDefault();
    const query = elements["search-input"].value.trim();
    if (!query) return;
    elements["search-summary"].textContent = "Searching…";
    try {
      const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
      elements["search-summary"].textContent = `${data.results.length} result${data.results.length === 1 ? "" : "s"}`;
      elements["search-results"].replaceChildren(...data.results.map(result => {
        const item = document.createElement("div");
        item.className = "search-result";
        const path = document.createElement("div");
        path.className = "search-path";
        path.textContent = `${result.path}:${result.line}`;
        const preview = document.createElement("div");
        preview.className = "search-preview";
        preview.textContent = result.preview;
        item.append(path, preview);
        item.addEventListener("click", () => openFile(result.path, result.line));
        return item;
      }));
    } catch (error) {
      elements["search-summary"].textContent = error.message;
    }
  }

  function goToLine(line) {
    const input = elements["code-input"];
    const lines = input.value.split("\n");
    const position = lines.slice(0, Math.max(0, line - 1)).reduce((sum, value) => sum + value.length + 1, 0);
    input.focus();
    input.setSelectionRange(position, position);
    const lineHeight = parseFloat(getComputedStyle(input).lineHeight);
    input.scrollTop = Math.max(0, (line - 4) * lineHeight);
    syncEditorScroll();
    updateCursor();
  }

  async function updateGit() {
    try {
      const data = await api("/api/git/status");
      elements["git-output"].textContent = data.output || (data.available ? "Working tree clean" : "This folder is not a Git repository.");
      const lines = data.available ? data.output.split("\n") : [];
      const branch = lines[0]?.replace(/^##\s*/, "") || "—";
      const changes = lines.slice(1).filter(Boolean).length;
      elements["branch-status"].textContent = `⑂ ${branch}`;
      elements["git-badge"].textContent = changes;
      elements["git-badge"].classList.toggle("hidden", changes === 0);
    } catch (error) {
      elements["git-output"].textContent = error.message;
    }
  }

  function togglePanel(force) {
    const open = typeof force === "boolean" ? force : !elements.panel.classList.contains("open");
    elements.panel.classList.toggle("open", open);
    if (open) elements["terminal-input"].focus();
  }

  async function runActive() {
    if (!state.activePath) return toast("Open a runnable file first", true);
    await saveActive();
    togglePanel(true);
    appendTerminal(`\n▶ Running ${state.activePath}\n`, "terminal-dim");
    try {
      const data = await api("/api/run", { method: "POST", body: { path: state.activePath } });
      appendTerminal(data.output || `Process exited with code ${data.code}\n`);
      setStatus(`Process exited with code ${data.code}`, 2500);
    } catch (error) {
      appendTerminal(`${error.message}\n`);
    }
  }

  async function runTerminal(event) {
    event.preventDefault();
    const command = elements["terminal-input"].value.trim();
    if (!command) return;
    state.terminalHistory.push(command);
    state.terminalHistoryIndex = state.terminalHistory.length;
    appendTerminal(`\n${elements["terminal-prompt"].textContent} $ ${command}\n`);
    elements["terminal-input"].value = "";
    try {
      const data = await api("/api/terminal", { method: "POST", body: { command } });
      appendTerminal(data.output);
      elements["terminal-prompt"].textContent = data.cwd;
      setStatus(`Command exited with code ${data.code}`, 1800);
    } catch (error) {
      appendTerminal(`${error.message}\n`);
    }
  }

  function appendTerminal(text, className = "") {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    elements["terminal-output"].append(span);
    elements["terminal-output"].scrollTop = elements["terminal-output"].scrollHeight;
  }

  async function openWorkspace() {
    const path = prompt("Absolute folder path", state.workspace);
    if (!path || path === state.workspace) return;
    if ([...state.files.values()].some(file => file.content !== file.savedContent) && !confirm("Close files with unsaved changes?")) return;
    try {
      const data = await api("/api/workspace", { method: "POST", body: { path } });
      state.workspace = data.workspace;
      state.workspaceName = data.name;
      state.files.clear();
      state.selectedPath = null;
      elements["terminal-prompt"].textContent = ".";
      updateWorkspaceLabels();
      showWelcome();
      renderTabs();
      await Promise.all([refreshTree(), updateGit()]);
    } catch (error) {
      toast(error.message, true);
    }
  }

  function updateWorkspaceLabels() {
    elements["title-workspace"].textContent = state.workspaceName;
    elements["workspace-name"].textContent = state.workspaceName.toUpperCase();
    document.title = `${state.workspaceName} — IDELite`;
  }

  function setView(name) {
    document.querySelectorAll(".side-view").forEach(view => view.classList.toggle("active", view.id === `view-${name}`));
    document.querySelectorAll(".activity[data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === name));
    if (name === "search") setTimeout(() => elements["search-input"].focus(), 0);
    if (name === "source") updateGit();
  }

  function applySettings(settings) {
    state.settings = { ...state.settings, ...settings };
    document.documentElement.style.setProperty("--font-size", `${state.settings.fontSize}px`);
    document.documentElement.style.setProperty("--editor-line", `${Math.round(state.settings.fontSize * 1.5)}px`);
    elements["code-input"].style.tabSize = state.settings.tabSize;
    elements.highlight.style.tabSize = state.settings.tabSize;
    document.body.classList.toggle("word-wrap", Boolean(state.settings.wordWrap));
    elements["indent-status"].textContent = `Spaces: ${state.settings.tabSize}`;
    if (state.activePath) updateEditor();
  }

  async function checkForUpdate() {
    if (state.updateBusy || state.updateChecking) return;
    state.updateChecking = true;
    state.update = null;
    elements["update-button"].disabled = true;
    elements["update-status"].textContent = "Checking for updates…";
    try {
      const update = await api("/api/update");
      state.update = update;
      elements["update-section"].classList.toggle("hidden", !update.supported);
      const available = update.supported && update.available && update.asset_available;
      elements["update-badge"].classList.toggle("hidden", !available);
      if (!update.supported) return;
      if (!update.available) {
        elements["update-status"].textContent = `IDELite ${update.current_version} is up to date.`;
        elements["update-button"].textContent = "Check again";
      } else if (!update.asset_available) {
        elements["update-status"].textContent = `Version ${update.latest_version} is available, but its Debian package is missing.`;
        elements["update-button"].textContent = "Check again";
      } else {
        elements["update-status"].textContent = `Version ${update.latest_version} is available (installed: ${update.current_version}).`;
        elements["update-button"].textContent = "Install update";
      }
    } catch (error) {
      elements["update-badge"].classList.add("hidden");
      elements["update-section"].classList.remove("hidden");
      elements["update-status"].textContent = error.message;
      elements["update-button"].textContent = "Try again";
    } finally {
      state.updateChecking = false;
      elements["update-button"].disabled = false;
    }
  }

  function setUpdateBusy(busy) {
    state.updateBusy = busy;
    document.body.classList.toggle("updating", busy);
    elements["code-input"].readOnly = busy;
    elements["terminal-input"].disabled = busy;
    elements["update-button"].disabled = busy;
  }

  async function runUpdate() {
    if (state.updateBusy || state.updateChecking) return;
    if (!state.update?.available || !state.update?.asset_available) {
      await checkForUpdate();
      return;
    }
    if ([...state.files.values()].some(file => file.content !== file.savedContent)) {
      toast("Save or close all unsaved files before updating.", true);
      return;
    }
    if (!confirm("Install the update and restart IDELite? Administrator approval will be requested.")) return;
    setUpdateBusy(true);
    elements["update-status"].textContent = "Downloading and verifying the update…";
    try {
      const result = await api("/api/update", { method: "POST" });
      elements["update-status"].textContent = `IDELite ${result.version} verified. Close IDELite (or stop the headless server) within two minutes to install.`;
      elements["update-button"].textContent = "Waiting for restart";
    } catch (error) {
      elements["update-status"].textContent = error.message;
      elements["update-button"].textContent = "Try again";
      setUpdateBusy(false);
      return;
    }
    if (window.pywebview?.api?.quit_for_update) {
      try {
        await window.pywebview.api.quit_for_update();
      } catch {
        toast("Please close IDELite manually to complete the update.", true);
      }
    }
  }

  function showSettings() {
    elements["setting-font-size"].value = state.settings.fontSize;
    elements["setting-tab-size"].value = state.settings.tabSize;
    elements["setting-word-wrap"].checked = state.settings.wordWrap;
    elements["settings-modal"].classList.remove("hidden");
    checkForUpdate();
  }

  async function saveSettings() {
    const settings = {
      fontSize: Number(elements["setting-font-size"].value),
      tabSize: Number(elements["setting-tab-size"].value),
      wordWrap: elements["setting-word-wrap"].checked,
    };
    try {
      const data = await api("/api/settings", { method: "PUT", body: settings });
      applySettings(data.settings);
      elements["settings-modal"].classList.add("hidden");
      toast("Settings saved");
    } catch (error) {
      toast(error.message, true);
    }
  }

  function setStatus(message, resetAfter = 0) {
    elements["status-message"].textContent = message;
    if (resetAfter) setTimeout(() => { elements["status-message"].textContent = "Ready"; }, resetAfter);
  }

  function toast(message, error = false) {
    const item = document.createElement("div");
    item.className = `toast${error ? " error" : ""}`;
    item.textContent = message;
    elements["toast-region"].append(item);
    setTimeout(() => item.remove(), 3500);
  }

  const commands = {
    "new-file": () => createItem("file"),
    "new-folder": () => createItem("directory"),
    refresh: refreshTree,
    collapse: () => document.querySelectorAll(".tree-children").forEach(item => item.classList.add("collapsed")),
    "quick-open": showQuickOpen,
    "open-workspace": openWorkspace,
    "toggle-panel": () => togglePanel(),
    "clear-terminal": () => { elements["terminal-output"].textContent = ""; },
    run: runActive,
    settings: showSettings,
    "close-settings": () => elements["settings-modal"].classList.add("hidden"),
    "save-settings": saveSettings,
    update: runUpdate,
    "git-refresh": updateGit,
  };

  document.addEventListener("click", event => {
    if (state.updateBusy) return;
    const commandElement = event.target.closest("[data-command]");
    if (commandElement) commands[commandElement.dataset.command]?.();
    const viewElement = event.target.closest("[data-view]");
    if (viewElement) setView(viewElement.dataset.view);
  });

  elements["code-input"].addEventListener("input", updateEditor);
  elements["code-input"].addEventListener("scroll", syncEditorScroll);
  elements["code-input"].addEventListener("click", updateCursor);
  elements["code-input"].addEventListener("keyup", updateCursor);
  elements["code-input"].addEventListener("keydown", event => {
    if (state.updateBusy) return;
    if (event.key === "Tab") {
      event.preventDefault();
      insertAtCursor(" ".repeat(state.settings.tabSize));
    } else if (event.key === "Enter") {
      const before = event.currentTarget.value.slice(0, event.currentTarget.selectionStart);
      const indent = before.split("\n").at(-1).match(/^\s*/)[0];
      if (indent) {
        event.preventDefault();
        insertAtCursor(`\n${indent}`);
      }
    }
  });

  elements["search-form"].addEventListener("submit", searchWorkspace);
  elements["terminal-form"].addEventListener("submit", runTerminal);
  elements["terminal-input"].addEventListener("keydown", event => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    state.terminalHistoryIndex += event.key === "ArrowUp" ? -1 : 1;
    state.terminalHistoryIndex = Math.max(0, Math.min(state.terminalHistory.length, state.terminalHistoryIndex));
    elements["terminal-input"].value = state.terminalHistory[state.terminalHistoryIndex] || "";
  });
  elements["quick-input"].addEventListener("input", event => updateQuickResults(event.target.value));
  elements["quick-input"].addEventListener("keydown", event => {
    if (event.key === "Enter") elements["quick-results"].querySelector(".quick-item")?.click();
  });
  document.querySelectorAll(".modal-backdrop").forEach(backdrop => backdrop.addEventListener("mousedown", event => {
    if (event.target === backdrop) backdrop.classList.add("hidden");
  }));

  document.addEventListener("keydown", event => {
    if (state.updateBusy) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === "s") { event.preventDefault(); saveActive(); }
    if (modifier && event.key.toLowerCase() === "p") { event.preventDefault(); showQuickOpen(); }
    if (modifier && event.key.toLowerCase() === "b") { event.preventDefault(); document.body.classList.toggle("sidebar-hidden"); }
    if (modifier && event.key === "`") { event.preventDefault(); togglePanel(); }
    if (modifier && event.key.toLowerCase() === "w") { event.preventDefault(); if (state.activePath) closeFile(state.activePath); }
    if (modifier && event.shiftKey && event.key.toLowerCase() === "f") { event.preventDefault(); setView("search"); }
    if (modifier && event.shiftKey && event.key.toLowerCase() === "e") { event.preventDefault(); setView("explorer"); }
    if (event.key === "F5") { event.preventDefault(); runActive(); }
    if (event.key === "Escape") document.querySelectorAll(".modal-backdrop").forEach(item => item.classList.add("hidden"));
  });

  async function initialize() {
    updateWorkspaceLabels();
    try {
      const [appState] = await Promise.all([api("/api/state"), refreshTree(), updateGit()]);
      applySettings(appState.settings);
      checkForUpdate();
      setStatus("Ready");
    } catch (error) {
      toast(error.message, true);
    }
  }

  initialize();
})();
