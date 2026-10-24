/**
 * Polite, isomorphic HTTP fetcher for law sources.
 *
 * - One queue per host with a minimum interval (default 1500 ms, raised to
 *   the robots.txt Crawl-delay when it is larger).
 * - robots.txt is honoured for automated runs (Node.js / CI). In the browser
 *   the user is the agent, so `robots: false` is the default there.
 * - Retries on 429 / 5xx / network errors with exponential back-off and
 *   `Retry-After` support.
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

export class PoliteFetcher {
  /**
   * @param {object} [options]
   * @param {typeof fetch} [options.fetch]
   * @param {number} [options.intervalMs]
   * @param {boolean} [options.robots]
   * @param {string} [options.proxy]
   * @param {number} [options.retries]
   * @param {number} [options.retryBaseMs]
   * @param {number} [options.timeoutMs]
   * @param {(message: string) => void} [options.log]
   */
  constructor(options = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.intervalMs = options.intervalMs ?? 1500;
    this.robots = options.robots ?? !isBrowser();
    this.proxy = options.proxy ?? '';
    this.retries = options.retries ?? 3;
    this.retryBaseMs = options.retryBaseMs ?? 2000;
    this.timeoutMs = options.timeoutMs ?? 120000;
    this.log = options.log ?? (() => {});
    this.hosts = new Map();
  }

  host(origin) {
    if (!this.hosts.has(origin)) {
      this.hosts.set(origin, {
        tail: Promise.resolve(),
        last: 0,
        intervalMs: this.intervalMs,
        rules: null,
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
      this.log(`robots.txt unavailable for ${origin}: ${error.message}`);
    }
    const rules = parseRobots(text, ROBOTS_TOKEN);
    if (rules.crawlDelay) {
      state.intervalMs = Math.max(state.intervalMs, rules.crawlDelay * 1000);
    }
    return rules;
  }

  request(url, init) {
    const headers = new Headers(init.headers ?? {});
    if (!isBrowser() && !headers.has('user-agent')) {
      headers.set('user-agent', USER_AGENT);
    }
    const signal =
      typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(this.timeoutMs)
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
   * @param {RequestInit & { robots?: boolean }} [init]
   */
  async fetch(url, init = {}) {
    const { robots = this.robots, ...rest } = init;
    const parsed = new URL(url);
    if (robots) {
      const rules = await this.rulesFor(url);
      if (!rules.allows(`${parsed.pathname}${parsed.search}`)) {
        throw Object.assign(new Error(`Disallowed by robots.txt: ${url}`), {
          code: 'ROBOTS_DISALLOWED',
        });
      }
    }
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
        this.log(`retry ${attempt + 1} for ${url}: ${error.message}`);
        await wait(this.retryBaseMs * 2 ** attempt);
        continue;
      }
      if (!retryable(response.status) || attempt >= this.retries) {
        return response;
      }
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

  async text(url, init) {
    return (await this.ok(url, init)).text();
  }

  async bytes(url, init) {
    return new Uint8Array(await (await this.ok(url, init)).arrayBuffer());
  }

  async json(url, init) {
    return (await this.ok(url, init)).json();
  }
}
