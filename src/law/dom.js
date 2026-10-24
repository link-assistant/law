/**
 * Minimal isomorphic DOM helpers on top of htmlparser2 (pure JavaScript, so the
 * same code runs in Node.js, Bun, Deno and browsers).
 */
import { parseDocument } from 'htmlparser2';
import { cleanLine } from './text.js';

/**
 * Parse HTML or XML markup.
 * @param {string} markup
 * @param {{ xml?: boolean }} [options]
 */
export function parseMarkup(markup, { xml = false } = {}) {
  return parseDocument(markup, {
    xmlMode: xml,
    decodeEntities: true,
    lowerCaseTags: !xml,
    lowerCaseAttributeNames: !xml,
    recognizeSelfClosing: true,
  });
}

export const isElement = (node) =>
  node?.type === 'tag' || node?.type === 'script' || node?.type === 'style';

/** Local element name without namespace prefix, lower-cased for HTML. */
export function nameOf(node) {
  const name = node?.name ?? '';
  const local = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
  return local;
}

export function attr(node, name) {
  return node?.attribs?.[name];
}

export function children(node) {
  return (node?.children ?? []).filter(isElement);
}

export function child(node, name) {
  return children(node).find((item) => nameOf(item) === name);
}

/** Depth-first, document-order walk over elements. */
export function* walk(node) {
  for (const item of node?.children ?? []) {
    if (isElement(item)) {
      yield item;
      yield* walk(item);
    }
  }
}

function parseCompound(text) {
  const tag = text.match(/^[a-z][\w:-]*/iu)?.[0]?.toLowerCase();
  const id = text.match(/#([\w:-]+)/u)?.[1];
  const classes = [...text.matchAll(/\.([\w-]+)/gu)].map((match) => match[1]);
  return { tag, id, classes };
}

function matchesCompound(node, { tag, id, classes }) {
  if (tag && nameOf(node).toLowerCase() !== tag) {
    return false;
  }
  if (id && attr(node, 'id') !== id) {
    return false;
  }
  if (classes.length) {
    const own = new Set((attr(node, 'class') ?? '').split(/\s+/u));
    return classes.every((name) => own.has(name));
  }
  return true;
}

function matchesChain(node, chain) {
  if (!matchesCompound(node, chain[chain.length - 1])) {
    return false;
  }
  let index = chain.length - 2;
  let current = node.parent;
  while (index >= 0 && current) {
    if (isElement(current) && matchesCompound(current, chain[index])) {
      index -= 1;
    }
    current = current.parent;
  }
  return index < 0;
}

/**
 * Select the outermost elements matching a small CSS subset:
 * `tag`, `#id`, `.class`, compounds and descendant combinators, comma lists.
 */
export function selectAll(root, selector) {
  const chains = String(selector)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(/\s+/u).map(parseCompound));
  const found = [];
  const visit = (node) => {
    for (const item of node?.children ?? []) {
      if (!isElement(item)) {
        continue;
      }
      if (chains.some((chain) => matchesChain(item, chain))) {
        found.push(item);
        continue;
      }
      visit(item);
    }
  };
  visit(root);
  return found;
}

// HTML tag names (case-sensitive, so XML elements such as eCFR <HEAD> stay).
const skipped = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'button',
  'select',
  'option',
  'input',
  'textarea',
  'form',
  'nav',
  'svg',
  'iframe',
  'head',
]);
const blockNames = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'caption',
  'center',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'html',
  'li',
  'main',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);

const isBlock = (node) => blockNames.has(nameOf(node).toLowerCase());

/** Raw text of a node, keeping `<br>` as line breaks. */
export function rawText(node) {
  if (!node) {
    return '';
  }
  if (node.type === 'text') {
    return node.data;
  }
  if (!isElement(node) || skipped.has(nameOf(node))) {
    return '';
  }
  if (nameOf(node).toLowerCase() === 'br') {
    return '\n';
  }
  return (node.children ?? []).map(rawText).join('');
}

/** Text of a node with whitespace collapsed to one line. */
export function lineText(node) {
  return cleanLine(rawText(node).replace(/\n/gu, ' '));
}

function hasBlockChild(node) {
  return children(node).some(
    (item) =>
      !skipped.has(nameOf(item)) && (isBlock(item) || hasBlockChild(item))
  );
}

const label = /^(?:\(?[\p{L}\p{N}]{1,6}[.)]|[-–—•·])$/u;

function rowText(row) {
  const cells = children(row)
    .flatMap((item) =>
      ['tbody', 'thead'].includes(nameOf(item)) ? children(item) : [item]
    )
    .map(lineText)
    .filter(Boolean);
  if (cells.length > 1 && label.test(cells[0])) {
    return [`${cells[0]} ${cells.slice(1).join(' ')}`];
  }
  return cells.length ? [cells.join(' | ')] : [];
}

function blockEntry(node, text) {
  return {
    tag: nameOf(node).toLowerCase(),
    id: attr(node, 'id') ?? null,
    className: attr(node, 'class') ?? '',
    text,
  };
}

/**
 * Flatten content into ordered text blocks (paragraphs, headings, list
 * items, table rows). This is the common input for rule-driven converters.
 */
export function blocks(root) {
  const out = [];
  const visit = (node) => {
    for (const item of node.children ?? []) {
      if (item.type === 'text') {
        const text = cleanLine(item.data);
        if (text) {
          out.push({ ...blockEntry(node, text), inlineOf: node });
        }
        continue;
      }
      if (!isElement(item) || skipped.has(nameOf(item))) {
        continue;
      }
      const name = nameOf(item).toLowerCase();
      if (name === 'tr') {
        for (const text of rowText(item)) {
          out.push(blockEntry(item, text));
        }
        continue;
      }
      if (!isBlock(item) || hasBlockChild(item)) {
        if (isBlock(item) || hasBlockChild(item)) {
          visit(item);
        } else {
          pushInline(item, node, out);
        }
        continue;
      }
      const text = lineText(item);
      if (text) {
        out.push(blockEntry(item, text));
      }
    }
  };
  visit(root);
  return mergeInline(out);
}

function pushInline(item, parent, out) {
  const text = lineText(item);
  if (text) {
    out.push({ ...blockEntry(item, text), inlineOf: parent });
  }
}

/** Join consecutive inline fragments that share one parent block. */
function mergeInline(entries) {
  const merged = [];
  for (const entry of entries) {
    const previous = merged[merged.length - 1];
    if (entry.inlineOf && previous?.inlineOf === entry.inlineOf) {
      previous.text = cleanLine(`${previous.text} ${entry.text}`);
      continue;
    }
    merged.push(entry);
  }
  return merged.map(({ inlineOf, ...entry }) =>
    inlineOf ? { ...entry, ...parentInfo(inlineOf) } : entry
  );
}

function parentInfo(node) {
  return {
    tag: nameOf(node).toLowerCase(),
    id: attr(node, 'id') ?? null,
    className: attr(node, 'class') ?? '',
  };
}
