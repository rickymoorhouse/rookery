// Small local models often write YAML front matter that doesn't parse: an
// unquoted title with a colon in it, a description starting with a quote mark,
// tags as a comma-separated string. The runner tidies the post's front matter
// whenever Rook writes the post, so the build checks the content, not the YAML.

const STRINGS = ['title', 'description', 'social'];

// A YAML double-quoted string. JSON's escapes are valid YAML.
const quote = (value) => JSON.stringify(value);

function quoted(value) {
  return (/^".*"$/.test(value) && !/(^|[^\\])"(?!$)/.test(value.slice(1))) || /^'([^']|'')*'$/.test(value);
}

export function quoteFrontMatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (!match) return source;
  const lines = match[1].split(/\r?\n/).map((line) => {
    const field = line.match(/^([A-Za-z]+):[ \t]*(.*?)\s*$/);
    if (!field) return line;
    const [, key, value] = field;
    if (STRINGS.includes(key)) {
      // Leave empty values, block scalars (| or >) and values that are already quoted.
      if (!value || /^[|>][-+]?$/.test(value) || quoted(value)) return line;
      return `${key}: ${quote(value)}`;
    }
    if (key === 'tags' && value && !value.startsWith('[')) {
      const tags = value.split(',').map((t) => t.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      return `tags: [${tags.map(quote).join(', ')}]`;
    }
    return line;
  });
  return `---\n${lines.join('\n')}\n---${match[2]}${source.slice(match[0].length)}`;
}
