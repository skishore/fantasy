import {Option, flatten} from '../lib/base';
import {Grammar, Lexer, Match, Rule, Term, Token} from './base';

// We can only correct a grammar if three conditions are satisfied:
//
//  1. Its rules and tokens are augmented with additional tense information.
//  2. Its lexer provides a way to correct the tense of a given token.
//  3. A call to generate or parse returns a parse tree, not a raw value.
//
// We first define the rule and token annotations, satisfying condition 1.
//
// Each raw lexed token must list a set of tenses in which it makes sense.
// We accept a list because a word make be appropriate in multiple tenses:
// for example, in Hindi, "hai" is the copula for the 2nd person singular
// intimate tense and also for the 3rd person plural.
//
// Each rule must provide a base tense (implied by the rule alone) and a list
// of terms to check tenses for, in order. The overall tense for the rule node
// is the union of the base tense and the term tenses, in that order; if any
// two terms disagree on a grammatical category, the later one is wrong.
//
// Most rules will not have a base tense, which means we will just compute the
// node's tense recursively by visiting the terms in order of precedence.
//
// Finally, terms that don't appear in the precedence list still have their
// tense checked internally, just in a separate context from the main check.

interface Tense {
  [category: string]: string;
}

interface RuleData {
  precedence: number[];
  tense: Tense;
}

interface TermData {
  tenses: Tense[];
  text: {[script: string]: string};
}

// We define extensions of our grammar types that include the tense data.
// The extended lexer type also has a "fix" method satisfying condition 2.
//
// It's easier to construct this extended grammar by producting rules that
// return raw T values, so we have a second type parameter, U, such that when
// U is 0, the grammar outputs T, but when U is 1, it outputs Tree<T>.

type Out<T, U> = U extends 0 ? T : Tree<T>;

interface XGrammar<T, U = 1> extends Grammar<Option<T>, Out<T, U>> {
  lexer: XLexer<T, U>;
  rules: XRule<T, U>[];
}

interface XLexer<T, U = 1> extends Lexer<Option<T>, Out<T, U>> {
  fix: (match: XMatch<T, U>, tense: Tense) => XMatch<T, U> | null;
  lex: (input: string) => XToken<T, U>[];
  unlex: (term: Term, value: Option<T>) => XMatch<T, U> | null;
}

interface XMatch<T, U = 1> extends Match<Out<T, U>> {
  data: TermData;
}

interface XRule<T, U = 1> extends Rule<Option<T>, Out<T, U>> {
  data: RuleData;
}

interface XToken<T, U = 1> extends Token<Out<T, U>> {
  text_matches: {[text: string]: XMatch<T, U>};
  type_matches: {[type: string]: XMatch<T, U>};
}

// Finally, we define Tree<T>, the parse-tree output of a correctable grammar.
// This definition satisfies the condition 3 above. We also provide a utility
// method that will "lift" a grammar's return type up to a tree.

type Tree<T> =
  | {type: 'leaf'; value: T; term: Term; match: XMatch<T>}
  | {type: 'node'; value: T; rule: XRule<T>; children: Tree<T>[]};

// Some internal implementation details of this lift method.

const lift1 = <T>(rule: XRule<T, 0>): XRule<T> => {
  // tslint:disable-next-line:no-any
  const result: XRule<T> = {...rule, merge: {...rule.merge, fn: null as any}};
  result.merge.fn = (children: Tree<T>[]) => {
    const value = rule.merge.fn(children.map(x => x.value));
    return {type: 'node', value, rule: result, children} as Tree<T>;
  };
  return result;
};

const lift2 = <T>(term: Term, match: XMatch<T, 0>): XMatch<T> => {
  const {data, score, value} = match;
  // tslint:disable-next-line:no-any
  const result: XMatch<T> = {data, score, value: null as any};
  result.value = {type: 'leaf', value, term, match: result};
  return result;
};

const lift3 = <T>(term: Term, match: XMatch<T, 0> | null): XMatch<T> | null => {
  return match && lift2(term, match);
};

const lift4 = <S, T>(token: XToken<T, 0>): XToken<T> => {
  const text = token.text;
  const result: XToken<T> = {text, text_matches: {}, type_matches: {}};
  for (const x of [true, false]) {
    const k = x ? 'text' : 'type';
    const v = x ? 'text_matches' : 'type_matches';
    const [old_matches, new_matches] = [token[v], result[v]];
    // tslint:disable-next-line:forin
    for (const y in old_matches) {
      const term = {type: k, value: y} as Term;
      new_matches[y] = lift2(term, old_matches[y]);
    }
  }
  return result;
};

const lift5 = <S, T>(lexer: XLexer<T, 0>): XLexer<T> => ({
  fix: (x, y) => {
    if (x.value.type !== 'leaf') return null;
    const {data, score, value} = x.value.match;
    return lift3(x.value.term, lexer.fix({data, score, value: value.value}, y));
  },
  lex: x => lexer.lex(x).map(x => lift4(x)),
  unlex: (x, y) => lift3(x, lexer.unlex(x, y)),
});

// The actual lift method, plus some debugging utilities on parse trees.

const lift = <T>(grammar: XGrammar<T, 0>): XGrammar<T> => ({
  key: grammar.key,
  lexer: lift5(grammar.lexer),
  rules: grammar.rules.map(x => lift1(x)),
  start: grammar.start,
});

const matches = <S, T>(x: Tree<T>): XMatch<T>[] =>
  x.type === 'leaf' ? [x.match] : flatten(x.children.map(matches));

const print = <S, T>(x: Tree<T>, script: string, depth?: number): string => {
  const padding = Array(depth || 0)
    .fill('  ')
    .join('');
  if (x.type === 'leaf') {
    const lhs = `${x.term.type === 'type' ? '%' : ''}${x.term.value}`;
    return `${padding}${lhs} -> ${x.match.data.text[script]}`;
  } else {
    const rhs = x.rule.rhs;
    const lines = [`${padding}${x.rule.lhs}:`];
    x.children.forEach(y => lines.push(print(y, script, (depth || 0) + 1)));
    return lines.filter(x => !!x).join('\n');
  }
};

const Tree = {lift, matches, print};

export {Tense, Term, Tree, XGrammar, XLexer, XMatch, XRule, XToken};
