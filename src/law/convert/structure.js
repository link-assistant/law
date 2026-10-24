/**
 * Rule-driven structural converter: ordered text blocks → law units.
 * Used for every HTML/XHTML publisher; see ./profiles.js for the rules.
 */
import { unit } from '../model.js';
import { cleanLine, normalizeNumber, slug } from '../text.js';
import { getProfile } from './profiles.js';

function matchRule(profile, block) {
  for (const rule of profile.rules) {
    if (rule.className && !rule.className.test(block.className)) {
      continue;
    }
    if (rule.maxLength && block.text.length > rule.maxLength) {
      continue;
    }
    if (!rule.pattern) {
      return { rule, groups: {} };
    }
    const match = block.text.match(rule.pattern);
    if (match) {
      return { rule, groups: match.groups ?? {} };
    }
  }
  return null;
}

function kindOf(rule, groups) {
  if (rule.kindFromLabel && groups.label) {
    return slug(groups.label);
  }
  return rule.kind;
}

/** The unit marker as printed in the source, e.g. "第一条" or "Статья 1." */
function marker(text, groups) {
  let value = text;
  for (const part of [groups.text, groups.heading]) {
    if (part && value.endsWith(part)) {
      value = value.slice(0, value.length - part.length);
    }
  }
  return cleanLine(value.replace(/[\s.:—–-]+$/u, '').replace(/^\s+/u, ''));
}

function appendText(target, text) {
  target.text = target.text ? `${target.text}\n${text}` : text;
}

/** Skips a table of contents: from `stopAt` until its first entry repeats. */
function contentsSkipper(profile, enabled) {
  const state = { skipping: false, resumeKey: null, used: false };
  state.skip = (text) => {
    if (enabled && !state.used && profile.stopAt?.test(text)) {
      state.skipping = true;
      state.used = true;
      return true;
    }
    if (!state.skipping) {
      return false;
    }
    if (state.resumeKey === null) {
      state.resumeKey = text;
      return true;
    }
    state.skipping = text !== state.resumeKey;
    return state.skipping;
  };
  return state;
}

function isChrome(profile, block, text) {
  return (
    !text ||
    Boolean(profile.skipClass?.test(block.className)) ||
    Boolean(profile.skipText?.test(text))
  );
}

/** Heading on the matched line, or on the next block when the rule says so. */
function takeHeading(rule, groups, next) {
  const heading = cleanLine(groups.heading);
  if (heading || !rule.headingNext || !next?.className) {
    return { heading, consumed: false };
  }
  if (!rule.headingNext.test(next.className)) {
    return { heading, consumed: false };
  }
  return { heading: cleanLine(next.text), consumed: true };
}

/** Close levels for a new structural unit and return the remaining stack. */
function openStack(stack, rule, kind) {
  if (rule.reset) {
    return [];
  }
  if (rule.leaf) {
    return stack;
  }
  const open = stack.findIndex((item) => item.kind === kind);
  return open >= 0 ? stack.slice(0, open) : stack;
}

function structuralUnit({ rule, groups, kind, heading, text, stack }) {
  const num = groups.num ? cleanLine(groups.num) : '';
  const local = num
    ? `${slug(kind)}-${slug(normalizeNumber(num))}`
    : slug(kind);
  const parent = stack[stack.length - 1] ?? null;
  const scoped = !rule.leaf || rule.scoped;
  const value = unit({
    id: scoped && parent ? `${parent.id}-${local}` : local,
    kind,
    num: marker(text, groups) || num || undefined,
    heading,
    parent: parent?.id ?? null,
    level: stack.length,
  });
  if (groups.text) {
    value.text = cleanLine(groups.text);
  }
  return value;
}

function runProfile(blocks, profile, { leafKind, contents }) {
  const units = [];
  const front = { text: '' };
  const skipper = contentsSkipper(profile, contents);
  let stack = [];
  let current = null;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const text = cleanLine(block.text);
    if (isChrome(profile, block, text) || skipper.skip(text)) {
      continue;
    }
    const matched = matchRule(profile, { ...block, text });
    if (!matched) {
      appendText(current ?? front, text);
      continue;
    }
    const { rule, groups } = matched;
    const kind = rule.leaf && leafKind ? leafKind : kindOf(rule, groups);
    const { heading, consumed } = takeHeading(rule, groups, blocks[index + 1]);
    index += consumed ? 1 : 0;
    stack = openStack(stack, rule, kind);
    current = structuralUnit({ rule, groups, kind, heading, text, stack });
    units.push(current);
    if (!rule.leaf) {
      stack.push(current);
    }
  }
  if (front.text) {
    units.unshift({
      ...unit({ id: 'front', kind: 'front', level: 0 }),
      text: front.text,
    });
  }
  return { units, unfinished: skipper.skipping };
}

/**
 * Convert blocks with a structure profile.
 * @param {{ text: string, className: string }[]} blocks
 * @param {{ profile: string, leafKind?: string }} options
 * @returns {import('../model.js').LawUnit[]}
 */
export function convertBlocks(blocks, { profile: name, leafKind } = {}) {
  const profile = getProfile(name);
  const result = runProfile(blocks, profile, { leafKind, contents: true });
  if (!result.unfinished) {
    return result.units;
  }
  // The contents entry never repeated: what looked like contents was the body.
  return runProfile(blocks, profile, { leafKind, contents: false }).units;
}
