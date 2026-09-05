(() => {
  "use strict";
  const escapeHtml = text => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const keywords = {
    python: "and as assert async await break case class continue def del elif else except finally for from global if import in is lambda match nonlocal not or pass raise return try while with yield",
    javascript: "async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch throw try typeof var while yield interface type public private readonly implements enum",
    rust: "as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while",
    css: "important inherit initial unset auto none transparent",
    shell: "if then else elif fi for while do done case esac function in export local return exit",
  };
  const languageFor = path => ({ py: "python", js: "javascript", mjs: "javascript", ts: "javascript", tsx: "javascript", jsx: "javascript", rs: "rust", json: "json", html: "html", htm: "html", css: "css", sh: "shell", bash: "shell" })[(path || "").split(".").pop().toLowerCase()] || "plaintext";

  function highlight(code, language, tabSize = 4) {
    if (language === "plaintext" || code.length > 300000) return escapeHtml(code) + "\n";
    const comment = language === "python" || language === "shell" ? "#[^\\n]*" : language === "html" ? "<!--[\\s\\S]*?-->" : "(?:/\\*[\\s\\S]*?\\*/|//[^\\n]*)";
    const string = '(?:"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|`(?:\\\\.|[^`\\\\])*`)';
    const keyword = keywords[language] ? `\\b(?:${keywords[language].split(" ").join("|")})\\b` : "(?!)";
    const types = ["comment", "string", "keyword", "literal", "number", "function", "type", "tag"];
    const patterns = [comment, string, keyword, "\\b(?:True|False|None|true|false|null|undefined)\\b", "\\b(?:0x[0-9a-fA-F]+|\\d+(?:\\.\\d+)?)\\b", "\\b[A-Za-z_$][\\w$]*(?=\\s*\\()", "\\b[A-Z][A-Za-z0-9_]*\\b", language === "html" ? "</?[\\w-]+|/?>" : "(?!)"];
    const regex = new RegExp(patterns.map(pattern => `(${pattern})`).join("|"), "gm");
    let html = "", position = 0;
    for (const match of code.matchAll(regex)) {
      html += escapeHtml(code.slice(position, match.index));
      const type = types[match.slice(1).findIndex(value => value !== undefined)];
      html += `<span class="tok-${type}">${escapeHtml(match[0])}</span>`;
      position = match.index + match[0].length;
    }
    html += escapeHtml(code.slice(position));
    const guide = " ".repeat(tabSize);
    return html.split("\n").map(line => line.replace(/^ +/, spaces => {
      const count = Math.floor(spaces.length / tabSize);
      return `<span class="indent-guide">${guide}</span>`.repeat(count) + " ".repeat(spaces.length % tabSize);
    })).join("\n") + "\n";
  }

  function symbols(text, language) {
    const result = [];
    const pattern = language === "python" ? /^\s*(?:async\s+)?(def|class)\s+(\w+)/ : /^\s*(?:(?:export|pub|async|default)\s+)*(function|class|fn|struct|enum|interface)\s+(\w+)/;
    text.split("\n").forEach((line, index) => {
      const match = line.match(pattern);
      if (match) result.push({ kind: match[1], name: match[2], line: index + 1 });
    });
    return result;
  }

  function minimap(canvas, text) {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const context = canvas.getContext("2d");
    context.scale(ratio, ratio);
    const lines = text.split("\n"), step = Math.min(2.1, height / lines.length);
    const stride = Math.max(1, Math.floor(lines.length / height));
    for (let line = 0; line < lines.length; line += stride) {
      const content = lines[line].slice(0, 130).replaceAll("\t", "    ");
      context.fillStyle = /^\s*(#|\/\/)/.test(content) ? "#627991" : /['"]/.test(content) ? "#9a786c" : "#8a8a8d";
      for (const match of content.matchAll(/\S+/g)) {
        context.fillRect(5 + match.index * .8, line * step + 5, Math.min(match[0].length * .8, width - 6), Math.min(1.3, step * stride));
      }
    }
  }
  window.IDELiteEditor = { escapeHtml, languageFor, highlight, symbols, minimap };
})();
