/**
 * Polite, isomorphic HTTP fetcher for law sources.
 *
 * - One queue per host with a minimum interval (default 1500 ms, raised to
 *   the robots.txt Crawl-delay when it is larger).
 * - robots.txt is honoured for automated runs (Node.js / CI), on every
 *   redirect target too. In the browser the user is the agent, so
 *   `robots: false` is the default there. A Crawl-delay above one minute
 *   stops requests to that host; the delay is never shortened.
 * - Per-host intervals from the registry (`crawlDelay` on a source).
 * - Retries on 429 / 5xx / network errors with exponential back-off and
 *   `Retry-After` support; each failed attempt also doubles the host
 *   interval (up to a minute) for the rest of the run. A host that still
 *   answers 403 or 429 is left alone for the rest of the run: later requests
 *   fail without a network call, so a refusal is never answered with more
 *   traffic.
 * - Bodies read through `text`, `bytes` and `json` are limited to
 *   `maxBytes` (default 512 MiB).
 * - An optional proxy template (`https://proxy.example/?url={url}`) lets the
 *   browser reach publishers that do not send CORS headers.
 */
import { parseRobots } from './robots.js';

export const USER_AGENT =
  'link-assistant-law/0.1 (+https://github.com/link-assistant/law)';
export const ROBOTS_TOKEN = 'link-assistant-law';

const isBrowser = () =>
  typeof globalThis.window !== 'undefined' &&
  typeof globalThis.document !== 'undefined';

/** `fetch failed` plus the network cause (ECONNRESET, timeout, …). */
export function describeError(error) {
  const cause = error?.cause;
  const detail = cause ? [cause.code, cause.message].filter(Boolean) : [];
  return [error?.message, ...detail].join(': ');
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function applyProxy(url, proxy) {
  if (!proxy) {
    return url;
  }
  return proxy.includes('{url}')
    ? proxy.replace('{url}', encodeURIComponent(url))
    : `${proxy}${url}`;
}

function retryDelay(response, attempt, baseMs) {
  const header = response?.headers?.get?.('retry-after');
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 120000);
  }
  return baseMs * 2 ** attempt;
}

const retryable = (status) => status === 429 || status >= 500;
const REFUSALS = new Set([403, 429]);
const MAX_INTERVAL_MS = 60000;
const MAX_REDIRECTS = 5;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
export const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;

const failure = (message, extra) => Object.assign(new Error(message), extra);

export function concatBytes(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Read a body, giving up as soon as it exceeds `maxBytes`. */
export async function readLimited(response, maxBytes, url) {
  const tooLarge = () =>
    failure(`Response larger than ${maxBytes} bytes: ${url}`, {
      code: 'TOO_LARGE',
    });
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw tooLarge();
  }
  if (!response.body) {
    return new Uint8Array(await response.arrayBuffer());
  }
  const parts = [];
  let size = 0;
  for await (const part of response.body) {
    size += part.length;
    if (size > maxBytes) {
      throw tooLarge();
    }
    parts.push(part);
  }
  return concatBytes(parts);
}

export class PoliteFetcher {
  /**
   * @param {object} [options]
   * @param {typeof fetch} [options.fetch]
   * @param {number} [options.intervalMs]
   * @param {Record<string, number>} [options.hostIntervals] origin → ms
   * @param {boolean} [options.robots]
   * @param {string} [options.proxy]
   * @param {number} [options.retries]
   * @param {number} [options.retryBaseMs]
   * @param {number} [options.timeoutMs]
   * @param {number} [options.maxBytes]
   * @param {(message: string) => void} [options.log]
   */
  constructor(options = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.intervalMs = options.intervalMs ?? 1500;
    this.hostIntervals = options.hostIntervals ?? {};
    this.robots = options.robots ?? !isBrowser();
    this.proxy = options.proxy ?? '';
    this.retries = options.retries ?? 3;
    this.retryBaseMs = options.retryBaseMs ?? 2000;
    this.timeoutMs = options.timeoutMs ?? 120000;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.log = options.log ?? (() => {});
    this.hosts = new Map();
  }

  host(origin) {
    if (!this.hosts.has(origin)) {
      this.hosts.set(origin, {
        tail: Promise.resolve(),
        last: 0,
        intervalMs: Math.max(this.intervalMs, this.hostIntervals[origin] ?? 0),
        rules: null,
        refused: 0,
      });
    }
    return this.hosts.get(origin);
  }

  /** Run `task` in the host queue after the polite interval. */
  schedule(origin, task) {
    const state = this.host(origin);
    const run = state.tail.then(async () => {
      const delay = state.last + state.intervalMs - Date.now();
      if (delay > 0) {
        await wait(delay);
      }
      try {
        return await task();
      } finally {
        state.last = Date.now();
      }
    });
    state.tail = run.catch(() => {});
    return run;
  }

  /** Double the host interval (up to a minute) after a failed attempt. */
  slowDown(state) {
    state.intervalMs = Math.min(state.intervalMs * 2, MAX_INTERVAL_MS);
  }

  rulesFor(url) {
    const { origin } = new URL(url);
    const state = this.host(origin);
    if (!state.rules) {
      state.rules = this.loadRobots(origin, state);
    }
    return state.rules;
  }

  async loadRobots(origin, state) {
    let text = '';
    try {
      const response = await this.schedule(origin, () =>
        this.request(`${origin}/robots.txt`, {})
      );
      // RFC 9309: 4xx means no restrictions; 5xx means assume full disallow.
      if (response.status >= 500) {
        text = 'User-agent: *\nDisallow: /';
      } else if (response.ok) {
        text = await response.text();
      }
    } catch (error) {
      this.log(`robots.txt unavailable for ${origin}: ${describeError(error)}`);
    }
    const rules = parseRobots(text, ROBOTS_TOKEN);
    if (rules.crawlDelay * 1000 > MAX_INTERVAL_MS) {
      state.tooSlow = rules.crawlDelay;
    } else if (rules.crawlDelay) {
      state.intervalMs = Math.max(state.intervalMs, rules.crawlDelay * 1000);
    }
    return rules;
  }

  request(url, { timeoutMs = this.timeoutMs, ...init }) {
    const headers = new Headers(init.headers ?? {});
    if (!isBrowser() && !headers.has('user-agent')) {
      headers.set('user-agent', USER_AGENT);
    }
    const signal =
      typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(timeoutMs)
        : undefined;
    return this.fetchImpl(applyProxy(url, this.proxy), {
      ...init,
      headers,
      signal,
    });
  }

  /**
   * Fetch a URL politely. Resolves with the `Response` (any status).
   * @param {string} url
   * @param {RequestInit & { robots?: boolean, timeoutMs?: number }} [init]
   */
  async fetch(url, init = {}) {
    const { robots = this.robots, ...rest } = init;
    if (!robots) {
      return this.hop(url, rest, false);
    }
    // Follow redirects here so robots.txt is checked for every target.
    let current = url;
    for (let hops = 0; ; hops += 1) {
      const response = await this.hop(
        current,
        { ...rest, redirect: 'manual' },
        true
      );
      const location = response.headers.get('location');
      if (!REDIRECTS.has(response.status) || !location) {
        return response;
      }
      if (hops >= MAX_REDIRECTS) {
        throw failure(`Too many redirects from ${url}`, {
          code: 'TOO_MANY_REDIRECTS',
        });
      }
      await response.body?.cancel();
      current = new URL(location, current).href;
    }
  }

  /** Refuse requests robots.txt or an earlier refusal rules out. */
  async admit(url, robots) {
    const parsed = new URL(url);
    if (robots) {
      const rules = await this.rulesFor(url);
      if (!rules.allows(`${parsed.pathname}${parsed.search}`)) {
        throw failure(`Disallowed by robots.txt: ${url}`, {
          code: 'ROBOTS_DISALLOWED',
        });
      }
    }
    const state = this.host(parsed.origin);
    if (robots && state.tooSlow) {
      throw failure(
        `${parsed.origin} asks for a ${state.tooSlow} s Crawl-delay, above the ${MAX_INTERVAL_MS / 1000} s limit; skipped ${url}`,
        { code: 'CRAWL_DELAY_TOO_LONG' }
      );
    }
    if (state.refused) {
      throw failure(
        `${parsed.origin} refused an earlier request (HTTP ${state.refused}); skipped ${url}`,
        { code: 'HOST_REFUSED', status: state.refused }
      );
    }
    return { parsed, state };
  }

  /** One request with retries, without following redirects itself. */
  async hop(url, rest, robots) {
    const { parsed, state } = await this.admit(url, robots);
    for (let attempt = 0; ; attempt += 1) {
      let response;
      try {
        response = await this.schedule(parsed.origin, () =>
          this.request(url, rest)
        );
      } catch (error) {
        if (attempt >= this.retries) {
          throw error;
        }
        this.slowDown(state);
        this.log(`retry ${attempt + 1} for ${url}: ${describeError(error)}`);
        await wait(this.retryBaseMs * 2 ** attempt);
        continue;
      }
      if (!retryable(response.status) || attempt >= this.retries) {
        if (REFUSALS.has(response.status)) {
          state.refused = response.status;
        }
        return response;
      }
      this.slowDown(state);
      this.log(`retry ${attempt + 1} for ${url}: HTTP ${response.status}`);
      await wait(retryDelay(response, attempt, this.retryBaseMs));
    }
  }

  async ok(url, init) {
    const response = await this.fetch(url, init);
    if (!response.ok) {
      throw Object.assign(new Error(`HTTP ${response.status} for ${url}`), {
        status: response.status,
      });
    }
    return response;
  }

  /** Body bytes of a successful response, within `maxBytes`. */
  async bytes(url, init) {
    return readLimited(await this.ok(url, init), this.maxBytes, url);
  }

  async text(url, init) {
    return new TextDecoder().decode(await this.bytes(url, init));
  }

  async json(url, init) {
    return JSON.parse(await this.text(url, init));
  }
}
