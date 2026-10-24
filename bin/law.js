#!/usr/bin/env node
/**
 * law: download, convert and publish laws listed in data/registry.lino.
 * Run `law --help` for commands.
 */
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { convert } from '../src/law/convert/index.js';
import { PoliteFetcher, ROBOTS_TOKEN } from '../src/law/fetcher.js';
import { lawDocument } from '../src/law/model.js';
import { buildTarget } from '../src/law/pipeline.js';
import { probe, probeMarkdown } from '../src/law/probe.js';
import {
  expandRegistry,
  parseRegistry,
  validateRegistry,
} from '../src/law/registry.js';
import { buildSite } from '../src/law/site.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `Usage: law <command> [options]

Commands:
  validate            Check data/registry.lino
  list                List every registry document with its mode
  convert <files…>    Convert local files (--format, --profile, --selector)
  fetch <key>         Download and convert one document to JSON
  probe               Report reachability, robots.txt and CORS per source
  build               Build the static site (fetch + convert + render)

Options:
  --registry <path>   Registry file (default data/registry.lino)
  --out <dir>         Site directory (default build/site)
  --only <prefixes>   Comma-separated key prefixes (e.g. us/constitution,eu/)
  --limit <n>         Max documents per collection
  --html-budget <MB>  Static HTML budget (default 600)
  --previous <url>    Previous site, reused when a download fails
  --catalog <path>    Links Notation catalog to update (data/catalog.lino)
  --proxy <url>       Proxy template ({url} = encoded target URL)
  --format, --profile, --selector  Conversion options for convert
  --output <path>     Write JSON to a file (default: stdout)
  --help              Show this help`;

const options = {
  registry: { type: 'string', default: join(root, 'data/registry.lino') },
  out: { type: 'string', default: 'build/site' },
  only: { type: 'string', default: '' },
  limit: { type: 'string', default: '0' },
  'html-budget': { type: 'string', default: '600' },
  previous: { type: 'string', default: '' },
  catalog: { type: 'string', default: '' },
  proxy: { type: 'string', default: '' },
  format: { type: 'string', default: 'html' },
  profile: { type: 'string' },
  selector: { type: 'string' },
  output: { type: 'string' },
  help: { type: 'boolean', default: false },
};

const log = (message) => console.error(message);

async function loadRegistry(values) {
  return parseRegistry(await readFile(values.registry, 'utf8'));
}

function fetcherFor(values, extra = {}) {
  return new PoliteFetcher({ proxy: values.proxy, log, ...extra });
}

async function emit(values, value) {
  const text = `${JSON.stringify(value, null, 1)}\n`;
  if (values.output) {
    await writeFile(values.output, text);
  } else {
    process.stdout.write(text);
  }
}

async function bundleViewer(out) {
  const { build } = await import('esbuild');
  await build({
    entryPoints: [join(root, 'src/web/viewer.js')],
    outfile: join(out, 'assets/viewer.js'),
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2022',
    logLevel: 'warning',
  });
  await copyFile(join(root, 'src/web/law.css'), join(out, 'assets/law.css'));
}

const commands = {
  async validate(values) {
    const problems = validateRegistry(await loadRegistry(values));
    for (const problem of problems) {
      console.error(problem);
    }
    console.log(
      problems.length ? `${problems.length} problem(s)` : 'Registry is valid'
    );
    return problems.length ? 1 : 0;
  },

  async list(values) {
    for (const target of expandRegistry(await loadRegistry(values))) {
      console.log(
        `${target.mode.padEnd(8)} ${target.key.padEnd(36)} ${target.pages[0]}`
      );
    }
    return 0;
  },

  async convert(values, files) {
    const pages = await Promise.all(files.map((file) => readFile(file)));
    const body = convert({
      format: values.format,
      pages,
      profile: values.profile,
      selector: values.selector,
    });
    await emit(
      values,
      lawDocument({ id: files[0], title: body.title ?? files[0], ...body })
    );
    return 0;
  },

  async fetch(values, [key]) {
    const registry = await loadRegistry(values);
    const target = expandRegistry(registry).find((item) => item.key === key);
    if (!target) {
      console.error(`Unknown document ${key}; see \`law list\``);
      return 1;
    }
    const result = await buildTarget(
      { ...target, mode: target.mode === 'blocked' ? 'blocked' : 'mirror' },
      { fetcher: fetcherFor(values), registry }
    );
    if (!result.document) {
      console.error(result.error);
      return 1;
    }
    await emit(values, result.document);
    return 0;
  },

  async probe(values) {
    const registry = await loadRegistry(values);
    const rows = await probe(registry, {
      fetcher: fetcherFor(values, { retries: 1, timeoutMs: 30000 }),
      only: split(values.only),
    });
    const markdown = probeMarkdown(rows, { agent: ROBOTS_TOKEN });
    await (values.output
      ? writeFile(values.output, markdown)
      : process.stdout.write(markdown));
    return 0;
  },

  async build(values) {
    await mkdir(values.out, { recursive: true });
    const result = await buildSite({
      registryText: await readFile(values.registry, 'utf8'),
      outDir: values.out,
      fetcher: fetcherFor(values),
      only: split(values.only),
      limit: Number(values.limit),
      htmlBudget: Number(values['html-budget']) * 1024 * 1024,
      previous: values.previous.replace(/\/$/u, ''),
      catalog: values.catalog,
      log,
    });
    await bundleViewer(values.out);
    console.log(
      JSON.stringify({ summary: result.summary, htmlBytes: result.htmlBytes })
    );
    return 0;
  },
};

function split(text) {
  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function main() {
  const { values, positionals } = parseArgs({
    options,
    allowPositionals: true,
  });
  const [command, ...rest] = positionals;
  if (values.help || !commands[command]) {
    console.log(HELP);
    return values.help ? 0 : 1;
  }
  return commands[command](values, rest);
}

Promise.resolve()
  .then(main)
  .then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error.stack ?? error.message);
      process.exitCode = 1;
    }
  );
