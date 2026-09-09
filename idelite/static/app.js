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
    "update-status", "update-button", "update-badge", "setting-minimap", "setting-syntax-check", "active-line", "minimap",
    "minimap-canvas", "minimap-viewport", "outline-list", "run-output", "problems-output", "diff-output", "find-widget",
    "find-input", "find-count", "menu-popup", "info-modal", "info-title", "info-content", "sidebar-resizer"
  ].map(id => [id, document.getElementById(id)]));

  const state = {
    workspace: bootstrap.workspace,
    workspaceName: bootstrap.name,
    tree: [],
    files: new Map(),
    expandedFolders: new Set(),
    activePath: null,
    selectedPath: null,
    settings: { fontSize: 14, tabSize: 4, wordWrap: false, minimap: true },
    navigation: [],
    navigationIndex: -1,
    panelTab: "terminal",
    notifications: [],
    findIndex: -1,
    update: null,
    updateBusy: false,
    updateChecking: false,
    diagnostics: [],
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
        const expanded = state.expandedFolders.has(node.path);
        children.className = `tree-children${expanded ? "" : " collapsed"}`;
        children.append(...renderNodes(node.children || [], depth + 1));
        chevron.classList.toggle("closed", !expanded);
        wrapper.append(children);
        row.addEventListener("click", () => {
          if (state.expandedFolders.has(node.path)) state.expandedFolders.delete(node.path);
          else state.expandedFolders.add(node.path);
          selectTreePath(node.path);
          renderTree();
          scheduleSessionSave();
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

  let sessionTimer = null;
  let syntaxCheckTimer = null;

  function sessionPayload() {
    return {
      openFiles: [...state.files.keys()],
      activeFile: state.activePath,
      expandedFolders: [...state.expandedFolders],
    };
  }

  async function persistSession(keepalive = false) {
    const payload = sessionPayload();
    if (keepalive) {
      try {
        await fetch("/api/session", {
          method: "PUT",
          keepalive: true,
          headers: { "X-IDELite-Token": bootstrap.token, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch { /* Closing must not block the native window. */ }
      return;
    }
    try { await api("/api/session", { method: "PUT", body: payload }); }
    catch (error) { toast(`Could not restore this session: ${error.message}`, true); }
  }

  function scheduleSessionSave() {
    clearTimeout(sessionTimer);
    sessionTimer = setTimeout(() => persistSession(), 350);
  }

  async function restoreSession(session) {
    state.expandedFolders = new Set(session?.expandedFolders || []);
    renderTree();
    for (const path of session?.openFiles || []) await openFile(path, null, false);
    if (session?.activeFile && state.files.has(session.activeFile)) activateFile(session.activeFile, false);
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

  async function openFile(path, line = null, record = true) {
    try {
      let file = state.files.get(path);
      if (!file) {
        const data = await api(`/api/file?path=${encodeURIComponent(path)}`);
        file = { path, content: data.content, savedContent: data.content, scrollTop: 0, scrollLeft: 0, selectionStart: 0, selectionEnd: 0 };
        state.files.set(path, file);
      }
      activateFile(path, record);
      if (line) goToLine(line);
    } catch (error) {
      toast(error.message, true);
    }
  }

  function activateFile(path, record = true) {
    if (state.activePath && state.files.has(state.activePath)) {
      const previous = state.files.get(state.activePath);
      previous.scrollTop = elements["code-input"].scrollTop;
      previous.scrollLeft = elements["code-input"].scrollLeft;
      previous.selectionStart = elements["code-input"].selectionStart;
      previous.selectionEnd = elements["code-input"].selectionEnd;
    }
    const file = state.files.get(path);
    if (!file) return;
    if (record && state.activePath !== path) {
      state.navigation.splice(state.navigationIndex + 1);
      state.navigation.push(path);
      state.navigationIndex = state.navigation.length - 1;
    }
    state.activePath = path;
    selectTreePath(path);
    elements["welcome"].classList.add("hidden");
    elements.editor.classList.remove("hidden");
    elements["code-input"].value = file.content;
    elements["code-input"].setSelectionRange(file.selectionStart || 0, file.selectionEnd || 0);
    elements["code-input"].scrollTop = file.scrollTop;
    elements["code-input"].scrollLeft = file.scrollLeft;
    renderTabs();
    updateEditor();
    updateBreadcrumbs();
    scheduleSessionSave();
    elements["code-input"].focus();
  }

  function renderTabs() {
    elements.tabs.replaceChildren();
    for (const [path, file] of state.files) {
      const tab = document.createElement("button");
      tab.className = `tab${path === state.activePath ? " active" : ""}`;
      tab.dataset.path = path;
      tab.title = path;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(path === state.activePath));
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
    scheduleSessionSave();
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
    const content = file.content;
    try {
      setStatus(`Saving ${file.path}…`);
      await api("/api/file", { method: "PUT", body: { path: file.path, content } });
      file.savedContent = content;
      renderTabs();
      updateGit();
      setStatus("Saved", 1500);
      return true;
    } catch (error) {
      toast(error.message, true);
      setStatus("Save failed", 2000);
    }
  }

  function updateEditor() {
    const text = elements["code-input"].value;
    if (state.activePath) state.files.get(state.activePath).content = text;
    const lineCount = Math.max(1, text.split("\n").length);
    if (elements["line-numbers"].childElementCount !== lineCount) {
      elements["line-numbers"].innerHTML = Array.from({ length: lineCount }, (_, index) => `<span class="line-number">${index + 1}</span>`).join("");
    }
    for (const problem of state.diagnostics) elements["line-numbers"].children[problem.line - 1]?.classList.add("problem");
    elements.highlight.innerHTML = highlightCode(text, languageFor(state.activePath));
    drawMinimap();
    renderOutline();
    syncEditorScroll();
    updateCursor();
    renderTabs();
  }

  function highlightCode(code, language) {
    return window.IDELiteEditor.highlight(code, language, state.settings.tabSize);
  }

  function escapeHtml(value) {
    return window.IDELiteEditor.escapeHtml(value);
  }

  function languageFor(path) {
    return window.IDELiteEditor.languageFor(path);
  }

  function languageLabel(path) {
    const names = { python: "Python", javascript: "JavaScript", html: "HTML/XML", css: "CSS", rust: "Rust", cpp: "C/C++", csharp: "C#", java: "Java", kotlin: "Kotlin", go: "Go", php: "PHP", ruby: "Ruby", sql: "SQL", yaml: "YAML/TOML", markdown: "Markdown", shell: "Shell", powershell: "PowerShell", json: "JSON", plaintext: "Plain Text" };
    return names[languageFor(path)];
  }

  function updateBreadcrumbs() {
    if (!state.activePath) return;
    elements.breadcrumbs.textContent = `${state.workspaceName} › ${state.activePath.split("/").join(" › ")}`;
    elements["language-status"].textContent = languageLabel(state.activePath);
  }

  function syncEditorScroll() {
    if (elements["code-input"].clientWidth) elements.highlight.style.width = `${elements["code-input"].clientWidth}px`;
    elements.highlight.scrollTop = elements["code-input"].scrollTop;
    elements.highlight.scrollLeft = elements["code-input"].scrollLeft;
    elements["line-numbers"].scrollTop = elements["code-input"].scrollTop;
    updateCursor();
    updateMinimapViewport();
  }

  function updateCursor() {
    const input = elements["code-input"];
    const before = input.value.slice(0, input.selectionStart).split("\n");
    elements["cursor-position"].textContent = `Ln ${before.length}, Col ${before.at(-1).length + 1}`;
    elements["line-numbers"].querySelector(".current")?.classList.remove("current");
    elements["line-numbers"].children[before.length - 1]?.classList.add("current");
    const height = parseFloat(getComputedStyle(input).lineHeight);
    elements["active-line"].style.top = `${5 + (before.length - 1) * height - input.scrollTop}px`;
    elements["active-line"].classList.toggle("hidden", state.settings.wordWrap);
  }

  function drawMinimap() {
    window.IDELiteEditor.minimap(elements["minimap-canvas"], elements["code-input"].value);
    updateMinimapViewport();
  }

  function updateMinimapViewport() {
    const input = elements["code-input"], map = elements.minimap;
    const lines = input.value.split("\n").length;
    const step = Math.min(2.1, map.clientHeight / lines);
    const lineHeight = parseFloat(getComputedStyle(input).lineHeight);
    elements["minimap-viewport"].style.top = `${5 + input.scrollTop / lineHeight * step}px`;
    elements["minimap-viewport"].style.height = `${Math.min(map.clientHeight, input.clientHeight / lineHeight * step)}px`;
    map.setAttribute("aria-valuemax", lines);
    map.setAttribute("aria-valuenow", Math.min(lines, Math.floor(input.scrollTop / lineHeight) + 1));
  }

  function renderOutline() {
    const symbols = window.IDELiteEditor.symbols(elements["code-input"].value, languageFor(state.activePath));
    elements["outline-list"].replaceChildren(...symbols.map(symbol => {
      const button = document.createElement("button");
      button.className = "outline-item";
      button.textContent = `${symbol.kind === "class" ? "◇" : "ƒ"}  ${symbol.name}`;
      button.title = `Line ${symbol.line}`;
      button.addEventListener("click", () => goToLine(symbol.line));
      return button;
    }));
    if (!symbols.length) elements["outline-list"].textContent = "No symbols found.";
  }

  function insertAtCursor(text) {
    const input = elements["code-input"];
    const start = input.selectionStart;
    input.focus();
    if (!document.execCommand("insertText", false, text)) {
      input.setRangeText(text, start, input.selectionEnd, "end");
      input.dispatchEvent(new Event("input"));
    }
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
    return sourceControl.refresh();
  }

  function togglePanel(force) {
    const open = typeof force === "boolean" ? force : !elements.panel.classList.contains("open");
    elements.panel.classList.toggle("open", open);
    if (open && state.panelTab === "terminal") elements["terminal-input"].focus();
    drawMinimap();
  }

  function selectPanel(name) {
    state.panelTab = name;
    const ids = { terminal: "terminal-output", output: "run-output", problems: "problems-output", diff: "diff-output" };
    for (const [key, id] of Object.entries(ids)) elements[id].classList.toggle("hidden", key !== name);
    elements["terminal-form"].classList.toggle("hidden", name !== "terminal");
    document.querySelectorAll("[data-panel]").forEach(button => button.classList.toggle("active", button.dataset.panel === name));
    togglePanel(true);
  }

  function showDiff(title, text) {
    selectPanel("diff");
    elements["diff-output"].replaceChildren();
    const heading = document.createElement("span");
    heading.className = "diff-header";
    heading.textContent = `${title}\n\n`;
    elements["diff-output"].append(heading);
    for (const line of text.split("\n")) {
      const span = document.createElement("span");
      span.className = line.startsWith("+") ? "diff-add" : line.startsWith("-") ? "diff-remove" : line.startsWith("@@") ? "diff-header" : "";
      span.textContent = `${line}\n`;
      elements["diff-output"].append(span);
    }
  }

  async function checkActive(save = true) {
    if (!state.activePath || (save && !await saveActive())) return;
    try {
      const data = await api("/api/diagnostics", { method: "POST", body: { path: state.activePath } });
      state.diagnostics = data.diagnostics || [];
      elements["problems-output"].textContent = state.diagnostics.length
        ? state.diagnostics.map(problem => `${state.activePath}:${problem.line}:${problem.column}  ${problem.message}`).join("\n")
        : data.message;
      document.querySelectorAll(".line-number.problem").forEach(line => line.classList.remove("problem"));
      for (const problem of state.diagnostics) elements["line-numbers"].children[problem.line - 1]?.classList.add("problem");
      selectPanel("problems");
      setStatus(data.message, 2500);
    } catch (error) { toast(error.message, true); }
  }

  async function runActive() {
    if (!state.activePath) return toast("Open a runnable file first", true);
    const path = state.activePath;
    if (!await saveActive()) return;
    selectPanel("output");
    elements["run-output"].textContent = `▶ Running ${path}\n`;
    try {
      const data = await api("/api/run", { method: "POST", body: { path } });
      elements["run-output"].textContent += `${data.output}\nProcess exited with code ${data.code}\n`;
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
      await persistSession();
      const data = await api("/api/workspace", { method: "POST", body: { path } });
      state.workspace = data.workspace;
      state.workspaceName = data.name;
      state.files.clear();
      state.navigation = [];
      state.navigationIndex = -1;
      state.selectedPath = null;
      state.expandedFolders = new Set();
      elements["terminal-prompt"].textContent = ".";
      updateWorkspaceLabels();
      showWelcome();
      renderTabs();
      await Promise.all([refreshTree(), updateGit()]);
      await restoreSession(data.session);
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
    document.body.classList.remove("sidebar-hidden");
    document.querySelectorAll(".side-view").forEach(view => view.classList.toggle("active", view.id === `view-${name}`));
    document.querySelectorAll(".activity[data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === name));
    if (name === "search") setTimeout(() => elements["search-input"].focus(), 0);
    if (name === "source") updateGit();
  }

  function scheduleSyntaxChecks() {
    clearInterval(syntaxCheckTimer);
    const seconds = state.settings.syntaxCheckInterval;
    if (seconds) syntaxCheckTimer = setInterval(() => checkActive(false), seconds * 1000);
  }

  function applySettings(settings) {
    state.settings = { ...state.settings, ...settings };
    document.documentElement.style.setProperty("--font-size", `${state.settings.fontSize}px`);
    document.documentElement.style.setProperty("--editor-line", `${Math.round(state.settings.fontSize * 1.43)}px`);
    document.documentElement.style.setProperty("--tab-size", state.settings.tabSize);
    document.body.classList.toggle("no-minimap", !state.settings.minimap);
    elements["code-input"].style.tabSize = state.settings.tabSize;
    elements.highlight.style.tabSize = state.settings.tabSize;
    document.body.classList.toggle("word-wrap", Boolean(state.settings.wordWrap));
    elements["indent-status"].textContent = `Spaces: ${state.settings.tabSize}`;
    scheduleSyntaxChecks();
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
        elements["update-status"].textContent = `Version ${update.latest_version} is available, but its installer is missing.`;
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
    if (!confirm("Install the update and restart IDELite?")) return;
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
    elements["setting-minimap"].checked = state.settings.minimap;
    elements["setting-syntax-check"].value = state.settings.syntaxCheckInterval;
    elements["settings-modal"].classList.remove("hidden");
    checkForUpdate();
  }

  async function saveSettings() {
    const settings = {
      fontSize: Number(elements["setting-font-size"].value),
      tabSize: Number(elements["setting-tab-size"].value),
      wordWrap: elements["setting-word-wrap"].checked,
      minimap: elements["setting-minimap"].checked,
      syntaxCheckInterval: Number(elements["setting-syntax-check"].value),
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
    state.notifications.unshift(message);
    state.notifications.length = Math.min(state.notifications.length, 30);
    const item = document.createElement("div");
    item.className = `toast${error ? " error" : ""}`;
    item.textContent = message;
    elements["toast-region"].append(item);
    setTimeout(() => item.remove(), 3500);
  }

  function navigateFiles(direction) {
    const next = state.navigationIndex + direction;
    if (next < 0 || next >= state.navigation.length) return;
    state.navigationIndex = next;
    const path = state.navigation[next];
    if (state.files.has(path)) activateFile(path, false);
    else openFile(path);
  }

  function showFind() {
    if (!state.activePath) return;
    elements["find-widget"].classList.remove("hidden");
    elements["find-input"].focus();
    elements["find-input"].select();
  }

  function findMatch(direction = 1) {
    const input = elements["code-input"], query = elements["find-input"].value.toLowerCase();
    if (!query) { elements["find-count"].textContent = ""; return; }
    const text = input.value.toLowerCase(), matches = [];
    for (let index = text.indexOf(query); index !== -1; index = text.indexOf(query, index + Math.max(1, query.length))) matches.push(index);
    if (!matches.length) { elements["find-count"].textContent = "No results"; return; }
    const position = direction > 0 ? input.selectionEnd : input.selectionStart - 1;
    let index = direction > 0 ? matches.findIndex(offset => offset >= position) : matches.findLastIndex(offset => offset <= position);
    if (index === -1) index = direction > 0 ? 0 : matches.length - 1;
    goToLine(text.slice(0, matches[index]).split("\n").length);
    input.setSelectionRange(matches[index], matches[index] + query.length);
    elements["find-count"].textContent = `${index + 1} of ${matches.length}`;
  }

  function showInfo(title, content) {
    elements["info-title"].textContent = title;
    elements["info-content"].textContent = content;
    elements["info-modal"].classList.remove("hidden");
  }

  async function editAction(action) {
    if (!state.activePath) return;
    const input = elements["code-input"];
    input.focus();
    if (action === "paste") {
      try { insertAtCursor(await navigator.clipboard.readText()); }
      catch { toast("Clipboard access unavailable. Use Ctrl+V in the editor.", true); }
    } else if (action === "selectAll") input.select();
    else document.execCommand(action);
    updateCursor();
  }

  async function saveAll() {
    for (const file of state.files.values()) {
      if (file.content === file.savedContent) continue;
      const content = file.content;
      try {
        await api("/api/file", { method: "PUT", body: { path: file.path, content } });
        file.savedContent = content;
      } catch (error) { toast(error.message, true); return; }
    }
    renderTabs();
    updateGit();
  }

  async function toggleMinimap() {
    applySettings({ minimap: !state.settings.minimap });
    try { await api("/api/settings", { method: "PUT", body: { minimap: state.settings.minimap } }); }
    catch (error) { toast(error.message, true); }
  }

  async function windowAction(action) {
    if (action === "close" && [...state.files.values()].some(file => file.content !== file.savedContent) && !confirm("Close IDELite and discard unsaved changes?")) return;
    const method = window.pywebview?.api?.[action];
    if (method) await method();
  }

  const menus = {
    File: [["New File", "new-file", ""], ["Open Folder…", "open-workspace", ""], ["Save", "save", "Ctrl+S"], ["Save All", "save-all", ""], ["Close Editor", "close-file", "Ctrl+W"]],
    Edit: [["Undo", "undo", "Ctrl+Z"], ["Redo", "redo", "Ctrl+Y"], ["Cut", "cut", "Ctrl+X"], ["Copy", "copy", "Ctrl+C"], ["Paste", "paste", "Ctrl+V"], ["Find", "find", "Ctrl+F"]],
    Selection: [["Select All", "select-all", "Ctrl+A"], ["Duplicate Line", "duplicate-line", ""]],
    View: [["Explorer", "view-explorer", ""], ["Source Control", "view-source", ""], ["Toggle Sidebar", "toggle-sidebar", "Ctrl+B"], ["Toggle Minimap", "toggle-minimap", ""], ["Settings", "settings", ""]],
    Go: [["Go to File…", "quick-open", "Ctrl+P"], ["Go to Line…", "goto-line", "Ctrl+G"], ["Back", "back", "Alt+Left"], ["Forward", "forward", "Alt+Right"]],
    Run: [["Run Active File", "run", "F5"], ["Check active file", "check", "F8"]],
    Terminal: [["Open Terminal", "git-terminal", "Ctrl+`"], ["Toggle Panel", "toggle-panel", ""], ["Clear Panel", "clear-terminal", ""]],
    Help: [["Keyboard Shortcuts", "shortcuts", ""], ["About IDELite", "about", ""]],
  };

  function showMenu(button) {
    const popup = elements["menu-popup"], rect = button.getBoundingClientRect();
    popup.replaceChildren(...menus[button.dataset.menu].map(([label, command, shortcut]) => {
      const item = document.createElement("button");
      item.setAttribute("role", "menuitem");
      item.dataset.command = command;
      item.textContent = label;
      const keys = document.createElement("small");
      keys.textContent = shortcut;
      item.append(keys);
      return item;
    }));
    popup.style.left = `${Math.min(rect.left, window.innerWidth - 260)}px`;
    popup.style.top = `${rect.bottom + 1}px`;
    popup.classList.remove("hidden");
    popup.querySelector("button")?.focus();
  }

  const sourceControl = window.IDELiteSourceControl({ api, openFile, showDiff, toast, onStatus: data => {
    elements["branch-status"].textContent = `⑂ ${data.branch || "—"}`;
    const count = (data.files || []).length;
    elements["git-badge"].textContent = count;
    elements["git-badge"].classList.toggle("hidden", !count);
  } });

  const commands = {
    save: saveActive,
    "save-all": saveAll,
    "close-file": () => state.activePath && closeFile(state.activePath),
    welcome: showWelcome,
    back: () => navigateFiles(-1),
    forward: () => navigateFiles(1),
    "toggle-sidebar": () => document.body.classList.toggle("sidebar-hidden"),
    "toggle-minimap": toggleMinimap,
    "view-explorer": () => setView("explorer"),
    "view-source": () => setView("source"),
    "git-terminal": () => selectPanel("terminal"),
    "window-minimize": () => windowAction("minimize"),
    "window-maximize": () => windowAction("toggle_maximize"),
    "window-close": () => windowAction("close"),
    "goto-line": () => { const line = Number(prompt("Go to line", "1")); if (Number.isInteger(line) && line > 0 && state.activePath) goToLine(line); },
    find: showFind,
    "find-next": () => findMatch(1),
    "find-prev": () => findMatch(-1),
    "find-close": () => elements["find-widget"].classList.add("hidden"),
    undo: () => editAction("undo"), redo: () => editAction("redo"), cut: () => editAction("cut"), copy: () => editAction("copy"), paste: () => editAction("paste"),
    "select-all": () => editAction("selectAll"),
    "duplicate-line": () => { if (!state.activePath) return; const input = elements["code-input"], start = input.value.lastIndexOf("\n", input.selectionStart - 1) + 1; let end = input.value.indexOf("\n", input.selectionStart); if (end < 0) end = input.value.length; const line = input.value.slice(start, end); input.setSelectionRange(end, end); insertAtCursor(`\n${line}`); },
    shortcuts: () => showInfo("Keyboard Shortcuts", "Ctrl+P   Go to file\nCtrl+S   Save\nCtrl+W   Close tab\nCtrl+F   Find in file\nCtrl+G   Go to line\nCtrl+B   Toggle sidebar\nCtrl+`   Terminal\nF5       Run active file\nAlt+←/→  Navigate editors"),
    about: () => showInfo("IDELite", "A lightweight local code editor.\nPython · Flask · SQLite · Vanilla JS\n\nSystem webview, no bundled Chromium.\nApache License 2.0\n\nGit actions operate on your local repository.\nTerminal commands run with your user rights."),
    notifications: () => showInfo("Notifications", state.notifications.join("\n\n") || "No notifications."),
    "close-info": () => elements["info-modal"].classList.add("hidden"),
    "new-file": () => createItem("file"),
    "new-folder": () => createItem("directory"),
    refresh: refreshTree,
    collapse: () => { state.expandedFolders.clear(); renderTree(); scheduleSessionSave(); },
    "quick-open": showQuickOpen,
    "open-workspace": openWorkspace,
    "toggle-panel": () => togglePanel(),
    "clear-terminal": () => { elements[{ terminal: "terminal-output", output: "run-output", problems: "problems-output", diff: "diff-output" }[state.panelTab]].textContent = ""; },
    run: runActive,
    check: checkActive,
    settings: showSettings,
    "close-settings": () => elements["settings-modal"].classList.add("hidden"),
    "save-settings": saveSettings,
    update: runUpdate,
    "git-refresh": updateGit,
  };

  document.addEventListener("click", event => {
    if (state.updateBusy) return;
    const commandElement = event.target.closest("[data-command]");
    if (commandElement) {
      elements["menu-popup"].classList.add("hidden");
      commands[commandElement.dataset.command]?.();
    }
    const menuButton = event.target.closest("[data-menu]");
    if (menuButton) showMenu(menuButton);
    else if (!event.target.closest("#menu-popup")) elements["menu-popup"].classList.add("hidden");
    const panelButton = event.target.closest("[data-panel]");
    if (panelButton) selectPanel(panelButton.dataset.panel);
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
    const items = [...elements["quick-results"].children];
    let index = items.findIndex(item => item.classList.contains("active"));
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      index = Math.max(0, Math.min(items.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
      items.forEach((item, position) => item.classList.toggle("active", index === position));
      items[index]?.scrollIntoView({ block: "nearest" });
    }
    if (event.key === "Enter") items[index]?.click();
  });
  document.querySelectorAll(".modal-backdrop").forEach(backdrop => backdrop.addEventListener("mousedown", event => {
    if (event.target === backdrop) backdrop.classList.add("hidden");
  }));

  document.addEventListener("keydown", event => {
    if (state.updateBusy) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && !event.shiftKey && event.key.toLowerCase() === "f") { event.preventDefault(); showFind(); }
    if (modifier && event.key.toLowerCase() === "g") { event.preventDefault(); commands["goto-line"](); }
    if (event.altKey && event.key === "ArrowLeft") { event.preventDefault(); navigateFiles(-1); }
    if (event.altKey && event.key === "ArrowRight") { event.preventDefault(); navigateFiles(1); }
    if (modifier && event.key.toLowerCase() === "s") { event.preventDefault(); saveActive(); }
    if (modifier && event.key.toLowerCase() === "p") { event.preventDefault(); showQuickOpen(); }
    if (modifier && event.key.toLowerCase() === "b") { event.preventDefault(); document.body.classList.toggle("sidebar-hidden"); }
    if (modifier && event.key === "`") { event.preventDefault(); togglePanel(); }
    if (modifier && event.key.toLowerCase() === "w") { event.preventDefault(); if (state.activePath) closeFile(state.activePath); }
    if (modifier && event.shiftKey && event.key.toLowerCase() === "f") { event.preventDefault(); setView("search"); }
    if (modifier && event.shiftKey && event.key.toLowerCase() === "e") { event.preventDefault(); setView("explorer"); }
    if (event.key === "F5") { event.preventDefault(); runActive(); }
    if (event.key === "F8") { event.preventDefault(); checkActive(); }
    if (event.key === "Escape") document.querySelectorAll(".modal-backdrop, #menu-popup, #find-widget").forEach(item => item.classList.add("hidden"));
  });

  elements["find-input"].addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); findMatch(event.shiftKey ? -1 : 1); }
  });
  elements["find-input"].addEventListener("input", () => {
    elements["code-input"].setSelectionRange(0, 0);
    const input = elements["find-input"];
    findMatch();
    input.focus();
  });
  const mapScroll = event => {
    if (state.updateBusy) return;
    const input = elements["code-input"], bounds = elements.minimap.getBoundingClientRect();
    const step = Math.min(2.1, bounds.height / input.value.split("\n").length);
    input.scrollTop = Math.max(0, (event.clientY - bounds.top - 5) / step * parseFloat(getComputedStyle(input).lineHeight) - input.clientHeight / 2);
    syncEditorScroll();
  };
  elements.minimap.addEventListener("pointerdown", event => { elements.minimap.setPointerCapture(event.pointerId); mapScroll(event); });
  elements.minimap.addEventListener("pointermove", event => { if (elements.minimap.hasPointerCapture(event.pointerId)) mapScroll(event); });
  elements.minimap.addEventListener("keydown", event => {
    if (["ArrowDown", "ArrowUp", "PageDown", "PageUp"].includes(event.key)) {
      event.preventDefault();
      elements["code-input"].scrollTop += (event.key.endsWith("Down") ? 1 : -1) * (event.key.startsWith("Page") ? elements.editor.clientHeight : 40);
      syncEditorScroll();
    }
  });
  const resizer = elements["sidebar-resizer"];
  const resizeSidebar = width => document.documentElement.style.setProperty("--sidebar-width", `${Math.max(180, Math.min(550, window.innerWidth / 2, width))}px`);
  resizer.addEventListener("pointerdown", event => { resizer.setPointerCapture(event.pointerId); event.preventDefault(); });
  resizer.addEventListener("pointermove", event => { if (resizer.hasPointerCapture(event.pointerId)) resizeSidebar(event.clientX - 48); });
  resizer.addEventListener("keydown", event => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); resizeSidebar(document.getElementById("sidebar").clientWidth + (event.key === "ArrowLeft" ? -10 : 10)); }
  });
  new ResizeObserver(() => { drawMinimap(); syncEditorScroll(); }).observe(elements.editor);
  window.addEventListener("pywebviewready", () => document.getElementById("window-controls").classList.remove("hidden"));
  document.querySelector(".titlebar").addEventListener("dblclick", event => {
    if (!event.target.closest("button")) windowAction("toggle_maximize");
  });
  elements["menu-popup"].addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const items = [...elements["menu-popup"].children];
      const index = items.indexOf(document.activeElement);
      items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }
  });

  window.addEventListener("pagehide", () => {
    clearTimeout(sessionTimer);
    persistSession(true);
  });

  async function initialize() {
    updateWorkspaceLabels();
    try {
      const [appState] = await Promise.all([api("/api/state"), refreshTree(), updateGit()]);
      applySettings(appState.settings);
      await restoreSession(appState.session);
      const initialFile = new URLSearchParams(window.location.search).get("file");
      if (initialFile) await openFile(initialFile);
      checkForUpdate();
      setStatus("Ready");
    } catch (error) {
      toast(error.message, true);
    }
  }

  initialize();
})();
