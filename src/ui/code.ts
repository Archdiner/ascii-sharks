const KW = new Set(["import", "from", "as", "def", "return", "for", "in", "if", "else", "elif", "with", "while", "lambda", "None", "True", "False", "and", "or", "not", "class", "yield"]);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Tiny Python highlighter: comments, strings, numbers, keywords, calls. */
export function highlight(src: string): string {
  const re = /(#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?(?:e-?\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)(\s*\()?|([^#"'A-Za-z0-9_]+)/gm;
  return src
    .split("\n")
    .map((line, i) => {
      let out = "";
      for (const m of line.matchAll(re)) {
        if (m[1]) out += `<span class="c">${esc(m[1])}</span>`;
        else if (m[2]) out += `<span class="s">${esc(m[2])}</span>`;
        else if (m[3]) out += `<span class="n">${m[3]}</span>`;
        else if (m[4]) {
          if (KW.has(m[4])) out += `<span class="k">${m[4]}</span>`;
          else if (m[5]) out += `<span class="f">${m[4]}</span>`;
          else out += esc(m[4]);
          if (m[5]) out += esc(m[5]);
        } else if (m[6]) out += esc(m[6]);
      }
      return `<span class="ln"><span class="gut">${i + 1}</span>${out || " "}</span>`;
    })
    .join("");
}
