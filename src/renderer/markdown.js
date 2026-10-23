/** Parse the supported Markdown block subset into data; rendering stays in React text nodes. */
export function parseMarkdown(input) {
  const lines = String(input ?? '').split('\n');
  const blocks = [];
  let index = 0;
  let steps = 0;

  while (index < lines.length) {
    if (++steps > lines.length + 1) throw new Error('Markdown parser failed to advance.');
    const start = index;
    const line = lines[index];
    if (!line.trim()) { index++; continue; }

    const fence = matchFence(line);
    if (fence) {
      index++;
      const code = [];
      const close = new RegExp('^\\s{0,3}`{' + fence.length + ',}\\s*$');
      while (index < lines.length && !close.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push({ type: 'code', language: fence.info, text: code.join('\n'), start });
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2], start });
      index++;
      continue;
    }

    const marker = matchListMarker(line);
    if (marker) {
      const items = [];
      while (index < lines.length) {
        const item = matchListMarker(lines[index]);
        if (!item || item.ordered !== marker.ordered) break;
        items.push(item.text);
        index++;
      }
      blocks.push({ type: 'list', ordered: marker.ordered, items, start });
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !matchFence(lines[index]) && !/^\s{0,3}#{1,6}\s+/.test(lines[index]) && !matchListMarker(lines[index])) {
      paragraph.push(lines[index++]);
    }
    if (index === start) {
      // Unknown or malformed block syntax is safe plain text and always consumes input.
      blocks.push({ type: 'paragraph', text: lines[index], start: index });
      index++;
    } else blocks.push({ type: 'paragraph', text: paragraph.join('\n'), start });
  }
  return blocks;
}

function matchFence(line) {
  const match = line.match(/^\s{0,3}(`{3,})([^`]*)$/);
  return match ? { length: match[1].length, info: match[2].trim() } : null;
}

function matchListMarker(line) {
  const unordered = line.match(/^\s{0,3}([-+*])(?:\s+(.*)|$)/);
  if (unordered) return { ordered: false, text: unordered[2] || '' };
  const ordered = line.match(/^\s{0,3}(\d+[.)])(?:\s+(.*)|$)/);
  if (ordered) return { ordered: true, text: ordered[2] || '' };
  return null;
}
