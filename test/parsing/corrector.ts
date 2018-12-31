import {Option, RNG, flatten, nonnull, range} from '../../src/lib/base';
import {Grammar, Lexer, Match, Term, Token} from '../../src/parsing/base';
import {Tense, Tree, XGrammar, XRule} from '../../src/parsing/extensions';
import {Corrector} from '../../src/parsing/corrector';
import {Parser} from '../../src/parsing/parser';
import {Template as BT} from '../../src/template/base';
import {Template, Value} from '../../src/template/value';
import {Test} from '../test';

// Basic helpers for constructing a generative grammar.

type Spec = {
  lhs: string;
  rhs: string[];
  fn?: string;
  precedence?: number[];
  tense?: Tense;
};

const kDefaultTemplate: Template = {
  merge: xs => null,
  split: x => (x === null ? [{}] : []),
};

const make_grammar = (specs: Spec[]): XGrammar<Value> => {
  // Construct the lexer. For the purposes of this text, we will never have to
  // call the "fix" method of the lexer. TODO(skishore): Test a call to fix.
  const fix = () => [];
  const lex = (input: string) =>
    input.split(' ').map(x => {
      const data = {tenses: [{}], text: {latin: x}};
      const match = {data, score: 0, value: x};
      return {matches: {[x]: match}, text: x};
    });
  const unlex = (name: string, value: Option<Value>) => {
    if (value && name !== value.some) return [];
    const data = {tenses: [{}], text: {latin: name}};
    return [{data, score: 0, value: name}];
  };
  const lexer = {fix, lex, unlex};

  // Construct the rules. The key step here is to make use of the fn strings.
  const rules = specs.map(make_rule);
  return Tree.lift({key: JSON.stringify, lexer, rules, start: '$ROOT'});
};

const make_rule = (spec: Spec): XRule<Value, 0> => {
  const data = {
    precedence: spec.precedence || range(spec.rhs.length),
    tense: spec.tense || {},
  };
  const template = spec.fn ? Template.parse(spec.fn) : kDefaultTemplate;
  const merge = {fn: template.merge.bind(template), score: 0};
  const split = {fn: split_fn(template, spec.rhs.length), score: 0};
  const rhs = spec.rhs.map(make_term);
  return {data, lhs: spec.lhs, rhs, merge, split};
};

const make_term = (name: string): Term => {
  return {name, terminal: !name.startsWith('$')};
};

const split_fn = <T>(template: BT<T>, n: number) => {
  return (x: Option<T>): Option<T>[][] => {
    const xs = x ? template.split(x.some) : [{}];
    return xs.map(x => range(n).map(i => (i in x ? {some: x[i] as T} : null)));
  };
};

// Our test includes a grammar supporting basic Hindi agreement.

const corrector: Test = {
  correction_works: () => {
    // prettier-ignore
    const grammar = make_grammar([
      {lhs: '$ROOT', rhs: ['$Num', '$Adjs', '$Noun'], fn: '{adjs: $1, count: $0, noun: $2}', precedence: [0, 2, 1]},
      {lhs: '$Adjs', rhs: ['$Adjs', '$Adj'], fn: '[...$0, $1]'},
      {lhs: '$Adjs', rhs: []},
      {lhs: '$Adj', rhs: ['bara'], fn: '"big"', tense: {count: 'singular', gender: 'male'}},
      {lhs: '$Adj', rhs: ['bare'], fn: '"big"', tense: {count: 'plural', gender: 'male'}},
      {lhs: '$Adj', rhs: ['bari'], fn: '"big"', tense: {gender: 'female'}},
      {lhs: '$Adj', rhs: ['chota'], fn: '"small"', tense: {count: 'singular', gender: 'male'}},
      {lhs: '$Adj', rhs: ['chote'], fn: '"small"', tense: {count: 'plural', gender: 'male'}},
      {lhs: '$Adj', rhs: ['choti'], fn: '"small"', tense: {gender: 'female'}},
      {lhs: '$Num', rhs: ['ek'], fn: '1', tense: {count: 'singular'}},
      {lhs: '$Num', rhs: ['do'], fn: '2', tense: {count: 'plural'}},
      {lhs: '$Noun', rhs: ['admi'], fn: '"man"', tense: {count: 'singular', gender: 'male'}},
      {lhs: '$Noun', rhs: ['admiyo'], fn: '"man"', tense: {count: 'plural', gender: 'male'}},
      {lhs: '$Noun', rhs: ['aurat'], fn: '"woman"', tense: {count: 'singular', gender: 'female'}},
      {lhs: '$Noun', rhs: ['aurte'], fn: '"woman"', tense: {count: 'plural', gender: 'female'}},
    ]);

    // Test the corrected text generation.
    const tree = nonnull(Parser.parse(grammar, 'do chota bari admi')).some;
    const correction = Corrector.correct(grammar, new RNG(), tree);
    const matches = Tree.matches(correction.tree);
    const text = matches.map(x => x.data.text.latin).join(' ');
    Test.assert_eq(text, 'do chote bare admiyo');

    // Test the error explanations.
    const diff = correction.diff;
    const errors = diff.map(x => (x.type === 'wrong' ? x.errors : []));
    Test.assert_eq(errors, [
      [],
      ['count should be plural (was: singular)'],
      ['gender should be male (was: female)'],
      ['count should be plural (was: singular)'],
    ]);
  },
};

export {corrector};
