import {Option, RNG, assert, range} from '../lib/base';
import {Lambda, Template} from '../template/lambda';
import {Tense, Tree, XGrammar, XMatch, XRule} from './extensions';
import {Generator} from './generator';

// Internal implementation details of the correction algorithm.

interface Mapping<T> {
  errors: string[];
  new_node: Tree<T>;
  old_node: Tree<T>;
}

interface State<T> {
  grammar: XGrammar<T>;
  mapping: Mapping<T>[];
  rng: RNG;
  tense: Tense;
}

const apply = <T>(actual: Tense[], state: State<T>): string[] => {
  if (actual.length === 0) return [];
  const errors = actual.map(x => check_tense(x, state.tense));
  const okay = actual.filter((x, i) => errors[i].length === 0);
  if (okay.length === 0) return errors.sort((a, b) => a.length - b.length)[0];
  Object.assign(state.tense, merge_tense(okay));
  return [];
};

const check_rules = <T>(rule: XRule<T>, tense: Tense): string[] => {
  if (rule.split.score === -Infinity) return ['Invalid phrasing.'];
  return check_tense(rule.data.tense, tense);
};

const check_tense = (actual: Tense, expected: Tense): string[] => {
  return Object.keys(expected)
    .filter(x => actual[x] !== expected[x])
    .map(x => `${x} should be ${expected[x]} (was: ${actual[x]}).`);
};

const merge_tense = (actual: Tense[]): Tense => {
  const first = actual[0] || {};
  if (actual.length <= 1) return first;
  const result: Tense = {};
  Object.keys(first)
    .filter(x => actual.every(y => y[x] === first[x]))
    .forEach(x => (result[x] = first[x]));
  return result;
};

// An algorithm for reconstructing a node to correct top-level issues, which:
//
//  1. Identifies rules with the same LHS that match the contextual tense.
//  2. Generates a tree with the same semantics with one of those rules.
//  3. Reuses subtrees of the original node with the same LHS and semantics.

interface Memo<T> extends Map<string, Tree<T>> {}

const get_memo = <T>(g: XGrammar<T>, node: Tree<T>, memo: Memo<T>): Memo<T> => {
  if (node.type === 'leaf') return memo;
  node.children.map((x, i) => {
    const key = Generator.key(g, node.rule.rhs[i], {some: x.value});
    return memo.set(key, x) && get_memo(g, x, memo);
  });
  return memo;
};

const use_memo = <T>(g: XGrammar<T>, node: Tree<T>, memo: Memo<T>): Tree<T> => {
  if (node.type === 'leaf') return node;
  const children = node.children.map((x, i) => {
    const key = Generator.key(g, node.rule.rhs[i], {some: x.value});
    return memo.get(key) || use_memo(g, x, memo);
  });
  return {...node, children};
};

const rebuild = <T>(lhs: string, node: Tree<T>, state: State<T>): Tree<T> => {
  const {grammar, rng} = state;
  const rules = grammar.rules.filter(
    x => x.lhs === lhs && check_rules(x, state.tense).length === 0,
  );
  const value = {some: node.value};
  const maybe = Generator.generate_from_rules(grammar, rng, rules, value);
  if (!maybe) return node;
  const memo = get_memo(grammar, node, new Map());
  return use_memo(grammar, maybe.some, memo);
};

// The core recursive correction algorithm, which operates on a mutable state.

const recurse = <T>(old_node: Tree<T>, state: State<T>): Tree<T> => {
  // Correct leaf nodes using the provided term correction method.
  if (old_node.type === 'leaf') {
    let new_node = old_node;
    const errors = apply(old_node.match.data.tenses, state);
    if (errors.length > 0) {
      const maybe = state.grammar.lexer.fix(old_node.match, state.tense);
      if (maybe) new_node = {...old_node, match: maybe};
      if (maybe) apply(maybe.data.tenses, state);
    }
    state.mapping.push({errors, new_node, old_node});
    return new_node;
  }

  // Correct top-level issues by regenerating the entire subtree.
  const lhs = old_node.rule.lhs;
  const copy = {...old_node, children: old_node.children.slice()};
  const errors = check_rules(copy.rule, state.tense);
  const new_node = errors.length > 0 ? rebuild(lhs, copy, state) : copy;
  if (new_node.type !== 'node') throw Error('Invalid node replacement!');
  apply([new_node.rule.data.tense], state);

  // Correct tense errors in each of the rule node's children.
  const rule = new_node.rule;
  const checked = range(rule.rhs.length).map(() => false);
  for (const i of rule.data.precedence) {
    new_node.children[i] = recurse(new_node.children[i], state);
    checked[i] = true;
  }
  const original = state.tense;
  for (let i = 0; i < checked.length; i++) {
    if (checked[i]) continue;
    const child_state = {...state, tense: {}};
    new_node.children[i] = recurse(new_node.children[i], child_state);
  }
  state.mapping.push({errors, new_node, old_node});
  return new_node;
};

// TODO(skishore): We need to wrap up this algorithm in a need interface that:
//
//  1. Takes the "correct" method for correcting terms as input.
//  2. Builds the state and calls the recursive algorithm above.
//  3. Computes a diff between the resulting parse tree and the original one.
//  4. Take a seed as input and derandomize this algorithm.
//
// TODO(skishore): Write a test for this code.
// TODO(skishore): Write a parser from sexp -> XGrammar<T>.
