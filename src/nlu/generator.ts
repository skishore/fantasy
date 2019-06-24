import {Option, RNG} from '../lib/base';
import {Lexer, Grammar, Rule, Term, Token} from './base';

// We use a memo both to speed up generation and to avoid infinite loops on
// recursive rules, such as the left-recursive modifier rules.

interface Memo<S, T> {
  by_name: {[name: string]: Rule<S, T>[]};
  grammar: Grammar<S, T>;
  rng: RNG;
  saved: {[key: string]: Option<T>};
}

const generate_from_list = <S, T>(
  memo: Memo<S, T>,
  rules: Rule<S, T>[],
  value: S,
): Option<T> => {
  const scores: [number, T][] = [];
  for (const rule of rules) {
    const option = generate_from_rule(memo, rule, value);
    if (option) scores.push([2 ** rule.split.score, option.some]);
  }
  if (scores.length === 0) return null;
  let left = memo.rng.float(scores.reduce((acc, x) => acc + x[0], 0));
  for (const score of scores) {
    left -= score[0];
    if (left < 0) return {some: score[1]};
  }
  return {some: scores[scores.length - 1][1]};
};

const generate_from_memo = <S, T>(
  memo: Memo<S, T>,
  term: Term,
  value: S,
): Option<T> => {
  const key = Generator.key(memo.grammar, term, value);
  if (!memo.saved.hasOwnProperty(key)) {
    memo.saved[key] = null;
    memo.saved[key] = generate_from_term(memo, term, value);
  }
  return memo.saved[key];
};

const generate_from_rule = <S, T>(
  memo: Memo<S, T>,
  rule: Rule<S, T>,
  value: S,
): Option<T> => {
  const candidates = rule.split.fn(value);
  const options: T[][] = [];
  for (const candidate of candidates) {
    const children: T[] = [];
    for (let i = 0; i < rule.rhs.length; i++) {
      const term = generate_from_memo(memo, rule.rhs[i], candidate[i]);
      if (!term) break;
      children.push(term.some);
    }
    if (children.length !== rule.rhs.length) continue;
    options.push(children);
  }
  const option = sample(options, memo.rng);
  return option ? {some: rule.merge.fn(option.some)} : null;
};

const generate_from_term = <S, T>(
  memo: Memo<S, T>,
  term: Term,
  value: S,
): Option<T> => {
  const {name, terminal} = term;
  if (terminal) {
    const option = sample(memo.grammar.lexer.unlex(name, value), memo.rng);
    return option ? {some: option.some.value} : null;
  }
  const rules = memo.by_name[name] || [];
  return generate_from_list(memo, rules, value);
};

const index = <S, T>(grammar: Grammar<S, T>): Memo<S, T>['by_name'] => {
  const result: Memo<S, T>['by_name'] = {};
  grammar.rules
    .filter(x => x.split.score !== -Infinity)
    .forEach(x => (result[x.lhs] = result[x.lhs] || []).push(x));
  return result;
};

const sample = <T>(xs: T[], rng: RNG): Option<T> => {
  if (xs.length === 0) return null;
  return {some: xs[rng.int32(xs.length)]};
};

// This module supports generation from the root or from a provided ruleset.

const generate = <S, T>(
  grammar: Grammar<S, T>,
  rng: RNG,
  value: S,
): Option<T> => {
  const memo: Memo<S, T> = {by_name: index(grammar), grammar, rng, saved: {}};
  return generate_from_list(memo, memo.by_name[grammar.start] || [], value);
};

const generate_from_rules = <S, T>(
  grammar: Grammar<S, T>,
  rng: RNG,
  rules: Rule<S, T>[],
  value: S,
): Option<T> => {
  const memo: Memo<S, T> = {by_name: index(grammar), grammar, rng, saved: {}};
  return generate_from_list(memo, rules, value);
};

const key = <S, T>(grammar: Grammar<S, T>, term: Term, value: S): string =>
  `${JSON.stringify(term)}-${grammar.key(value)}`;

const Generator = {generate, generate_from_rules, key};

export {Generator};
