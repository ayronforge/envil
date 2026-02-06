function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Lightweight syntax highlighter for TypeScript/JavaScript code snippets.
 * Produces HTML with the same tok-* classes used by the hero code block.
 */
export function highlightCode(code: string): string {
  const regex =
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\b(import|from|export|const|let|var|new)\b|([a-zA-Z_$][\w$]*)(?=\s*\()|([a-zA-Z_$][\w$]*)(?=\s*:)|(\.{3}|[{}(),:;=])/g;

  let result = "";
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(code)) !== null) {
    if (match.index > lastIndex) {
      result += escapeHtml(code.slice(lastIndex, match.index));
    }

    const [full, str, kw, fn, prop, punct] = match;

    if (str) result += `<span class="tok-str">${escapeHtml(str)}</span>`;
    else if (kw) result += `<span class="tok-kw">${kw}</span>`;
    else if (fn) result += `<span class="tok-fn">${escapeHtml(fn)}</span>`;
    else if (prop) result += `<span class="tok-prop">${escapeHtml(prop)}</span>`;
    else if (punct) result += `<span class="tok-punct">${escapeHtml(punct)}</span>`;
    else result += escapeHtml(full);

    lastIndex = match.index + full.length;
  }

  if (lastIndex < code.length) {
    result += escapeHtml(code.slice(lastIndex));
  }

  return result;
}
