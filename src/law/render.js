/**
 * HTML rendering of unified law documents. Pure string functions, shared by
 * the static site build and the in-browser viewer. Every unit id is an
 * element id, so `<page>#<unit id>` links straight to a provision.
 */

const entities = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, (char) => entities[char]);
}

export function unitLabel(item) {
  return [item.num, item.heading].filter(Boolean).join(' ');
}

/** One unit as a flat block; nesting is shown with a level class. */
export function renderUnit(item, { href = '' } = {}) {
  const id = escapeHtml(item.id);
  const depth = Math.min(item.level + 2, 6);
  const label = unitLabel(item);
  const head = label
    ? `<h${depth}><a class="anchor" href="${href}#${id}">${escapeHtml(label)}</a></h${depth}>`
    : '';
  const text = (item.text ?? '')
    .split('\n')
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
  return `<section class="unit kind-${escapeHtml(item.kind)} level-${item.level}" id="${id}">${head}${text}</section>`;
}

export function renderUnits(units, options) {
  return units.map((item) => renderUnit(item, options)).join('\n');
}

const unitSize = (item) =>
  (item.text?.length ?? 0) + (item.heading?.length ?? 0) + 120;

/**
 * Split units into shards of roughly `maxBytes`, cutting before a top-level
 * unit when possible (hard cut at twice the size).
 */
export function shardUnits(units, maxBytes = 1_500_000) {
  const shards = [];
  let current = [];
  let size = 0;
  for (const item of units) {
    const boundary = item.level <= 1 || size > 2 * maxBytes;
    if (current.length && size >= maxBytes && boundary) {
      shards.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += unitSize(item);
  }
  if (current.length) {
    shards.push(current);
  }
  return shards;
}

/** Table of contents: structural units and leaves with a heading. */
export function renderContents(units, hrefOf) {
  const items = units
    .filter((item) => item.kind !== 'front' && unitLabel(item))
    .map(
      (item) =>
        `<li class="level-${item.level}"><a href="${hrefOf(item.id)}#${escapeHtml(item.id)}">${escapeHtml(unitLabel(item))}</a></li>`
    );
  return items.length ? `<ol class="contents">${items.join('')}</ol>` : '';
}

function legalNote(legal) {
  if (!legal) {
    return '';
  }
  const basis = legal.basisUrl
    ? `<a href="${escapeHtml(legal.basisUrl)}">${escapeHtml(legal.basis)}</a>`
    : escapeHtml(legal.basis);
  const attribution = legal.attribution
    ? ` ${escapeHtml(legal.attribution)}`
    : '';
  return `<p class="legal"><strong>${escapeHtml(legal.status)}</strong>: ${basis}.${attribution}</p>`;
}

/** Header with provenance: original link, hash, retrieval time, licence. */
export function renderHeader(document, { root = '', json = '' } = {}) {
  const facts = [
    [
      'Original',
      `<a href="${escapeHtml(document.sourceUrl)}">${escapeHtml(document.sourceUrl)}</a>`,
    ],
    ['Downloaded from', escapeHtml(document.downloadUrl)],
    ['Version', escapeHtml(document.version ?? '—')],
    ['Retrieved', escapeHtml(document.retrievedAt ?? '—')],
    ['SHA-256 of source', `<code>${escapeHtml(document.sha256 ?? '—')}</code>`],
    ['Units', String(document.units.length)],
  ];
  if (json) {
    facts.push([
      'Data',
      `<a href="${escapeHtml(json)}">unified JSON (gzip)</a>`,
    ]);
  }
  const rows = facts
    .map(([name, value]) => `<dt>${name}</dt><dd>${value}</dd>`)
    .join('');
  return `<header class="document"><p><a href="${root}index.html">All laws</a> · ${escapeHtml(document.jurisdiction)} · ${escapeHtml(document.language)}</p><h1>${escapeHtml(document.title)}</h1><dl class="facts">${rows}</dl>${legalNote(document.legal)}</header>`;
}

export function pageShell({
  title,
  body,
  root = '',
  lang = 'en',
  script = '',
}) {
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="${root}assets/law.css">
</head>
<body>
${body}
${script}
</body>
</html>
`;
}

// Redirect `index.html#unit` to the shard holding that unit.
const anchorScript = `<script>
(function () {
  var id = decodeURIComponent(location.hash.slice(1));
  if (!id || document.getElementById(id)) return;
  fetch('anchors.json').then(function (r) { return r.json(); }).then(function (map) {
    if (map[id]) location.replace(map[id] + '.html#' + encodeURIComponent(id));
  });
})();
</script>`;

function shardNav(index, count) {
  const links = [];
  if (index > 0) {
    links.push(`<a rel="prev" href="${index}.html">Previous part</a>`);
  }
  links.push('<a href="index.html">Contents</a>');
  if (index < count - 1) {
    links.push(`<a rel="next" href="${index + 2}.html">Next part</a>`);
  }
  return `<nav class="parts">Part ${index + 1} of ${count}: ${links.join(' · ')}</nav>`;
}

/**
 * Static pages for one document, relative to its directory
 * (`laws/<key>/`). Small documents get a single `index.html`; large ones a
 * contents page plus `1.html`, `2.html`… and `anchors.json`.
 * @returns {{ path: string, content: string }[]}
 */
export function renderDocumentPages(document, options = {}) {
  const { root = '', json = '', shardBytes } = options;
  const shards = shardUnits(document.units, shardBytes);
  const header = renderHeader(document, { root, json });
  const shell = (body, script = '') =>
    pageShell({
      title: document.title,
      body,
      root,
      lang: document.language,
      script,
    });
  if (shards.length === 1) {
    const body = `${header}<main>${renderUnits(document.units)}</main>`;
    return [{ path: 'index.html', content: shell(body) }];
  }
  const anchors = {};
  shards.forEach((shard, index) => {
    for (const item of shard) {
      anchors[item.id] = String(index + 1);
    }
  });
  const contents = renderContents(
    document.units,
    (id) => `${anchors[id]}.html`
  );
  const pages = [
    {
      path: 'index.html',
      content: shell(`${header}<main>${contents}</main>`, anchorScript),
    },
    { path: 'anchors.json', content: JSON.stringify(anchors) },
  ];
  shards.forEach((shard, index) => {
    const nav = shardNav(index, shards.length);
    const body = `${nav}<h1>${escapeHtml(document.title)}</h1><main>${renderUnits(shard, { href: `${index + 1}.html` })}</main>${nav}`;
    pages.push({ path: `${index + 1}.html`, content: shell(body) });
  });
  return pages;
}
