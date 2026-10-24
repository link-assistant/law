/**
 * robots.txt evaluation (RFC 9309): group selection by product token,
 * longest-match Allow/Disallow with `*` and `$`, plus the non-standard
 * Crawl-delay that several law publishers set.
 */

function parseGroups(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(text ?? '').split(/\r?\n/u)) {
    const line = raw.replace(/#.*$/u, '').trim();
    const match = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/u);
    if (!match) {
      continue;
    }
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) {
      continue;
    }
    if (key === 'allow' || key === 'disallow') {
      current.rules.push({ allow: key === 'allow', path: value });
    } else if (key === 'crawl-delay' && Number.isFinite(Number(value))) {
      current.crawlDelay = Number(value);
    }
  }
  return groups;
}

function patternOf(path) {
  const anchored = path.endsWith('$');
  const body = (anchored ? path.slice(0, -1) : path)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`, 'u');
}

/**
 * @param {string} text robots.txt body
 * @param {string} agent product token, e.g. `link-assistant-law`
 */
export function parseRobots(text, agent) {
  const token = agent.toLowerCase();
  const groups = parseGroups(text);
  const own = groups.filter((group) =>
    group.agents.some((name) => name !== '*' && token.startsWith(name))
  );
  const chosen = own.length
    ? own
    : groups.filter((group) => group.agents.includes('*'));
  const rules = chosen
    .flatMap((group) => group.rules)
    .filter((rule) => rule.path);
  const delays = chosen
    .map((group) => group.crawlDelay)
    .filter((value) => value !== null);
  return {
    crawlDelay: delays.length ? Math.max(...delays) : null,
    /** @param {string} path path plus query */
    allows(path) {
      let best = null;
      for (const rule of rules) {
        if (!patternOf(rule.path).test(path)) {
          continue;
        }
        const better =
          !best ||
          rule.path.length > best.path.length ||
          (rule.path.length === best.path.length && rule.allow);
        if (better) {
          best = rule;
        }
      }
      return best ? best.allow : true;
    },
  };
}
