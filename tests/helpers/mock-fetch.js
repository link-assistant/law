import { PoliteFetcher } from '../../src/law/fetcher.js';

/**
 * A fetch mock answering from a URL → route table. A route is a body, a
 * Response, a function returning a Response, or an Error to reject with.
 */
export function mockFetch(routes, calls = []) {
  return (url, init = {}) => {
    calls.push({ url, headers: new Headers(init.headers) });
    const route = routes[url];
    if (route === undefined) {
      return Promise.resolve(new Response('not found', { status: 404 }));
    }
    if (route instanceof Error) {
      return Promise.reject(route);
    }
    if (typeof route === 'function') {
      return Promise.resolve(route());
    }
    if (route instanceof Response) {
      return Promise.resolve(route);
    }
    return Promise.resolve(new Response(route, { status: 200 }));
  };
}

/** A PoliteFetcher over `mockFetch` without waiting between requests. */
export const fastFetcher = (routes, calls) =>
  new PoliteFetcher({
    fetch: mockFetch(routes, calls),
    intervalMs: 0,
    retryBaseMs: 1,
    retries: 2,
  });
