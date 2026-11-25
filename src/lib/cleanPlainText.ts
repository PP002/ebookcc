/**
 * cleanPlainText.ts
 *
 * Utility to reliably strip HTML tags, rich text formatting, markdown, and entities
 * so that broadcast subtitles, voice synthesizers, and director prompts receive
 * pure, legible plain text prose.
 */

export function toPlainText(input: string | null | undefined): string {
  if (!input) return "";
  let text = String(input);

  // 1. Remove style, script, and explicit navigation TOC blocks
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<nav\b[^>]*(?:epub:type|role|id|class)=["'][^"']*(?:toc|contents)[^"']*["'][^>]*>[\s\S]*?<\/nav>/gi, "");

  // 2. Convert block boundaries, table rows/cells, list items, and line breaks to newlines
  text = text.replace(
    /<\/p>|<\/div>|<\/h[1-6]>|<\/li>|<\/tr>|<\/td>|<\/th>|<\/table>|<\/dt>|<\/dd>|<\/ul>|<\/ol>|<\/dl>|<\/section>|<\/article>|<\/blockquote>|<\/header>|<\/footer>|<br\s*\/?>/gi,
    "\n"
  );

  // 3. Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, " ");

  // 4. Decode HTML entities
  const entities: Record<string, string> = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'",
    "&#39;": "'",
    "&ldquo;": '"',
    "&rdquo;": '"',
    "&lsquo;": "'",
    "&rsquo;": "'",
    "&mdash;": "—",
    "&ndash;": "–",
    "&hellip;": "...",
    "&middot;": "·",
    "&bull;": "•",
  };

  text = text.replace(/&[a-zA-Z0-9#]+;/g, (match) => {
    if (entities[match]) return entities[match];
    if (match.startsWith("&#x") || match.startsWith("&#X")) {
      const hex = match.slice(3, -1);
      const code = parseInt(hex, 16);
      return !isNaN(code) ? String.fromCharCode(code) : match;
    }
    if (match.startsWith("&#")) {
      const dec = match.slice(2, -1);
      const code = parseInt(dec, 10);
      return !isNaN(code) ? String.fromCharCode(code) : match;
    }
    return match;
  });

  // 5. Clean Markdown formatting characters
  text = text.replace(/^#+\s+/gm, "");
  text = text.replace(/\*\*(.*?)\*\*/g, "$1");
  text = text.replace(/\*(.*?)\*/g, "$1");
  text = text.replace(/__(.*?)__/g, "$1");
  text = text.replace(/_(.*?)_/g, "$1");
  text = text.replace(/`([^`]+)`/g, "$1");

  // 6. Normalize whitespace
  text = text.replace(/\r\n/g, "\n");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n\s*\n+/g, "\n\n");

  return text.trim();
}
