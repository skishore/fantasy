import {Option, sample} from '../lib/base';
import {Lexer, Grammar, Rule, Term, Token} from './base';

// We use a memo both to speed up generation and to avoid infinite loops on
// recursive rules, such as the left-recursive modifier rules.

interface Memo<S, T> {
  by_name: {[name: string]: Rule<S, T>[]};
  grammar: Grammar<S, T>;
  saved: {[key: string]: Option<T>};
}

const generate_from_memo = <S, T>(
  memo: Memo<S, T>,
  term: Term,
  value: S,
): Option<T> => {
  const key = JSON.stringify([term, value]);
  if (!memo.saved.hasOwnProperty(key)) {
    memo.saved[key] = null;
    memo.saved[key] = generate_from_term(memo, term, value);
  }
  return memo.saved[key];
};

const generate_from_name = <S, T>(
  memo: Memo<S, T>,
  symbol: string,
  value: S,
): Option<T> => {
  const options = (memo.by_name[symbol] || []).map(x =>
    generate_from_rule(memo, x, value),
  );
  return sample(options.filter(x => !!x).map(x => x!.some));
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
  const result = sample(options);
  return result ? {some: rule.merge.fn(result.some)} : null;
};

const generate_from_term = <S, T>(
  memo: Memo<S, T>,
  term: Term,
  value: S,
): Option<T> => {
  const {type, value: term_value} = term;
  if (type === 'name') return generate_from_name(memo, term_value, value);
  const result = memo.grammar.lexer.unlex(term, value);
  return result ? {some: result.value} : null;
};

const index = <S, T>(grammar: Grammar<S, T>): Memo<S, T>['by_name'] => {
  const result: Memo<S, T>['by_name'] = {};
  grammar.rules
    .filter(x => x.split.score !== -Infinity)
    .forEach(x => (result[x.lhs] = result[x.lhs] || []).push(x));
  return result;
};

// The public interface of this module is currently a single static method.
// TODO(skishore): Make use of scores here. Sample proportional to 2 ** score.
// TODO(skishore): Take a seed as input and derandomize this algorithm.

const generate = <S, T>(grammar: Grammar<S, T>, value: S): Option<T> => {
  const memo: Memo<S, T> = {by_name: index(grammar), grammar, saved: {}};
  return generate_from_name(memo, grammar.start, value);
};

const generate_from_rules = <S, T>(
  grammar: Grammar<S, T>,
  rules: Rule<S, T>[],
  value: S,
): Option<T> => {
  const memo: Memo<S, T> = {by_name: index(grammar), grammar, saved: {}};
  const options = rules.map(x => generate_from_rule(memo, x, value));
  return sample(options.filter(x => !!x).map(x => x!.some));
};

const Generator = {generate, generate_from_rules};

export {Generator};
