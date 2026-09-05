(() => {
  "use strict";

  function graphRows(commits) {
    let lanes = [];
    return commits.map(commit => {
      let lane = lanes.indexOf(commit.id);
      const incoming = lane !== -1;
      if (lane === -1) { lane = lanes.length; lanes.push(commit.id); }
      const before = [...lanes];
      lanes.splice(lane, 1);
      for (let i = 0; i < commit.parents.length; i++) {
        const parent = commit.parents[i];
        if (!lanes.includes(parent)) lanes.splice(Math.min(lane + i, lanes.length), 0, parent);
      }
      const edges = before.flatMap((id, index) => id === commit.id ? [] : [{ from: index, to: lanes.indexOf(id), start: 0 }]);
      edges.push(...commit.parents.map(parent => ({ from: lane, to: lanes.indexOf(parent), start: 14 })));
      return { lane, incoming, edges, width: Math.max(before.length, lanes.length, 1) * 12 + 8 };
    });
  }

  function sourceControl({ api, openFile, showDiff, toast, onStatus = () => {} }) {
    const ids = ["git-output", "git-repository", "git-repo-name", "git-branch", "graph-branch", "git-history", "git-working", "staged-section", "staged-files", "changed-files", "staged-count", "changes-count", "commit-form", "commit-message", "commit-button", "stage-all"];
    const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
    let sequence = 0, busy = false, snapshot = null;

    async function mutate(action, body) {
      if (busy) return;
      busy = true;
      el["git-working"].classList.add("git-busy");
      try {
        const result = await api(`/api/git/${action}`, { method: "POST", body });
        if (action === "commit") {
          el["commit-message"].value = "";
          toast(result.output || "Committed staged changes");
        }
      } catch (error) { toast(error.message, true); }
      finally {
        busy = false;
        el["git-working"].classList.remove("git-busy");
        await refresh();
      }
    }

    async function showFileDiff(path, staged) {
      try {
        const result = await api(`/api/git/diff?path=${encodeURIComponent(path)}&staged=${staged}`);
        showDiff(`${staged ? "Staged" : "Working tree"} · ${path}`, result.diff);
      } catch (error) { toast(error.message, true); }
    }

    function fileRow(file, staged) {
      const row = document.createElement("div");
      row.className = "change-row";
      const name = document.createElement("button");
      name.className = "change-file";
      name.textContent = file.path.split("/").pop();
      name.title = `${file.path} — view diff`;
      name.addEventListener("click", () => showFileDiff(file.path, staged));
      const status = document.createElement("span");
      status.className = "change-status";
      status.textContent = staged ? file.status[0] : file.status[1];
      const open = document.createElement("button");
      open.className = "icon-button";
      open.textContent = "↗";
      open.title = "Open file";
      open.addEventListener("click", () => openFile(file.path));
      const stage = document.createElement("button");
      stage.className = "icon-button";
      stage.textContent = staged ? "−" : "+";
      stage.title = staged ? "Unstage changes" : "Stage changes";
      stage.addEventListener("click", () => mutate(staged ? "unstage" : "stage", { path: file.path }));
      row.append(name, status, open, stage);
      return row;
    }

    function renderHistory(commits) {
      const rows = graphRows(commits);
      el["git-history"].replaceChildren(...commits.map((commit, index) => {
        const row = document.createElement("button");
        row.className = "commit-row";
        row.title = `${commit.subject}\n${commit.author} · ${commit.age}\n${commit.id}`;
        const graph = rows[index], x = lane => 5 + lane * 12;
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", `0 0 ${graph.width} 28`);
        svg.setAttribute("width", graph.width);
        svg.classList.add("commit-graph");
        const colors = ["#7e9bd0", "#ba8da6", "#b6bc86", "#81b6aa"];
        svg.innerHTML = graph.edges.map(edge => `<path d="M${x(edge.from)} ${edge.start} C${x(edge.from)} 20 ${x(edge.to)} 20 ${x(edge.to)} 28" stroke="${colors[edge.from % 4]}"/>`).join("") +
          (graph.incoming ? `<path d="M${x(graph.lane)} 0V14" stroke="${colors[graph.lane % 4]}"/>` : "") +
          `<circle cx="${x(graph.lane)}" cy="14" r="3" fill="#181818" stroke="${colors[graph.lane % 4]}"/>`;
        const subject = document.createElement("span");
        subject.className = "commit-subject";
        subject.textContent = commit.subject;
        row.append(svg, subject);
        if (commit.refs) {
          const refs = document.createElement("span");
          refs.className = "commit-ref";
          refs.textContent = commit.refs.replace("HEAD -> ", "");
          row.append(refs);
        }
        row.addEventListener("click", async () => {
          try {
            const result = await api(`/api/git/diff?commit=${commit.id}`);
            el["git-history"].querySelector(".selected")?.classList.remove("selected");
            row.classList.add("selected");
            showDiff(`${commit.id.slice(0, 8)} · ${commit.subject}`, result.diff);
          } catch (error) { toast(error.message, true); }
        });
        return row;
      }));
      if (!commits.length) {
        const empty = document.createElement("div");
        empty.className = "side-padding muted";
        empty.textContent = "No commits yet.";
        el["git-history"].append(empty);
      }
    }

    async function refresh() {
      const request = ++sequence;
      try {
        const data = await api("/api/git/status");
        if (request !== sequence) return null;
        snapshot = data;
        el["git-working"].classList.toggle("hidden", !data.available);
        el["git-repository"].classList.toggle("hidden", !data.available);
        el["git-output"].textContent = data.available ? "" : data.output || "Not a Git repository.";
        el["git-repo-name"].textContent = data.name || "Repository";
        el["git-branch"].textContent = data.branch || "";
        el["graph-branch"].textContent = `⑂ ${data.branch || "—"}`;
        const staged = (data.files || []).filter(file => file.staged);
        const changes = (data.files || []).filter(file => file.changed);
        el["staged-files"].replaceChildren(...staged.map(file => fileRow(file, true)));
        el["changed-files"].replaceChildren(...changes.map(file => fileRow(file, false)));
        el["staged-section"].classList.toggle("hidden", !staged.length);
        el["staged-count"].textContent = staged.length;
        el["changes-count"].textContent = changes.length;
        el["commit-button"].disabled = !staged.length;
        el["stage-all"].disabled = !changes.length;
        renderHistory(data.history || []);
        onStatus(data);
        return data;
      } catch (error) {
        if (request === sequence) {
          el["git-output"].textContent = error.message;
          el["git-working"].classList.add("hidden");
        }
        return null;
      }
    }

    el["stage-all"].addEventListener("click", event => {
      event.preventDefault();
      if (confirm("Stage all changes in this repository?")) mutate("stage", { path: "." });
    });
    el["commit-form"].addEventListener("submit", event => {
      event.preventDefault();
      const message = el["commit-message"].value.trim();
      if (!message) return toast("Enter a commit message first.", true);
      if (!snapshot?.available) return;
      if (confirm("Commit the staged changes?")) mutate("commit", { message });
    });
    return { refresh };
  }
  window.IDELiteSourceControl = sourceControl;
  window.IDELiteSourceControl.graphRows = graphRows;
})();
