(() => {
  "use strict";
  const escapeHtml = text => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const keywords = {
    python: "and as assert async await break case class continue def del elif else except finally for from global if import in is lambda match nonlocal not or pass raise return try while with yield",
    javascript: "async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch throw try typeof var while yield interface type public private readonly implements enum",
    rust: "as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while",
    cpp: "alignas auto bool break case catch char class const constexpr continue default delete do double else enum explicit export extern false float for friend if inline int long mutable namespace new noexcept nullptr operator private protected public register return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while",
    csharp: "abstract as async await base bool break byte case catch char class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while",
    java: "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient true false null try void volatile while",
    kotlin: "as break class continue do else false for fun if in interface is null object package return super this throw true try typealias val var when while",
    go: "break default func interface select case defer go map struct chan else goto package switch const fallthrough if range type continue for import return var",
    php: "abstract and array as break callable case catch class clone const continue declare default die do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile eval exit extends final finally for foreach function global if implements include instanceof insteadof interface isset list namespace new or print private protected public require return static switch throw trait try unset use var while xor yield",
    ruby: "BEGIN END alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield",
    sql: "select from where insert update delete create alter drop table join inner left right on as and or not null primary key foreign group by order having limit union distinct into values set",
    css: "important inherit initial unset auto none transparent",
    shell: "if then else elif fi for while do done case esac function in export local return exit",
    powershell: "begin break catch class continue data define do dynamicparam else elseif end exit filter finally for foreach from function if in param process return switch throw trap try until using var while workflow",
    yaml: "true false null yes no on off",
  };
  const languageFor = path => ({ py: "python", pyw: "python", js: "javascript", cjs: "javascript", mjs: "javascript", ts: "javascript", tsx: "javascript", jsx: "javascript", rs: "rust", c: "cpp", h: "cpp", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", cs: "csharp", java: "java", kt: "kotlin", kts: "kotlin", go: "go", php: "php", rb: "ruby", sql: "sql", json: "json", yaml: "yaml", yml: "yaml", toml: "yaml", xml: "html", html: "html", htm: "html", md: "markdown", markdown: "markdown", css: "css", sh: "shell", bash: "shell", zsh: "shell", ps1: "powershell", psm1: "powershell" })[(path || "").split(".").pop().toLowerCase()] || (/(^|\/)Dockerfile$/i.test(path || "") ? "shell" : /(^|\/)Makefile$/i.test(path || "") ? "shell" : "plaintext");

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
