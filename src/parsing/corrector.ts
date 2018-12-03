import {Option, assert, range} from '../lib/base';
import {Lambda, Template} from '../template/lambda';
import {Tense, Tree, XGrammar, XMatch} from './extensions';
import {Generator} from './generator';

// Internal implementation details of the correction algorithm.
//
// TODO(skishore): The way we track issues in the State type is broken.
// They're stored in a map from node to list of issues, but the set of nodes
// returned by the algorithm is completely disjoint from the inputs. Solving
// this problem is nontrivial because the correction can create and then
// discard entire subtrees, and because whenever we touch a child, we update
// all of its parents as well.

interface Issue {
  actual: string;
  category: string;
  expected: string;
}

interface State<T> {
  grammar: XGrammar<T>;
  issues: Map<Tree<T>, Issue[]>;
  tense: Tense;
}

const apply = <T>(actual: Tense[], state: State<T>): Issue[] => {
  if (actual.length === 0) return [];
  const issues = actual.map(x => check(x, state.tense));
  const okay = actual.filter((x, i) => issues[i].length === 0);
  if (okay.length === 0) return issues.sort((a, b) => a.length - b.length)[0];
  Object.assign(state.tense, merge(okay));
  return [];
};

const check = (actual: Tense, expected: Tense): Issue[] => {
  return Object.keys(expected)
    .filter(x => actual[x] !== expected[x])
    .map(x => ({actual: actual[x], category: x, expected: expected[x]}));
};

const merge = (actual: Tense[]): Tense => {
  const first = actual[0] || {};
  if (actual.length <= 1) return first;
  const result: Tense = {};
  Object.keys(first)
    .filter(x => actual.every(y => y[x] === first[x]))
    .forEach(x => (result[x] = first[x]));
  return result;
};

// The core recursive correction algorithm, which operates on a mutable state.

const recurse = <T>(derivation: Tree<T>, state: State<T>): Tree<T> => {
  // Correct leaf nodes using the provided term correction method.
  if (derivation.type === 'leaf') {
    const match = derivation.match;
    const issues = apply(derivation.match.data.tenses, state);
    if (issues.length === 0) return derivation;
    // TODO(skishore): Record the issues in the state.
    const maybe = state.grammar.lexer.fix(match, state.tense);
    if (!maybe) return derivation;
    assert(apply(maybe.data.tenses, state).length === 0);
    return {...derivation, match: maybe};
  }

  let modified: Tree<T> = {...derivation};
  modified.children = modified.children.slice();

  // Correct top-level issues at a derivation rule node by regenerating the
  // entire subtree rooted at this node.
  const issues = check(derivation.rule.data.tense, state.tense);
  if (issues.length > 0) {
    // TODO(skishore): Record the issues in the state.
    const lhs = derivation.rule.lhs;
    const rules = state.grammar.rules.filter(
      x => x.lhs === lhs && check(x.data.tense, state.tense).length === 0,
    );
    const value = {some: derivation.value};
    const fixed = Generator.generate_from_rules(state.grammar, rules, value);
    if (fixed) modified = fixed.some;
  }
  if (modified.type !== 'node') throw Error('Invalid node replacement!');
  apply([derivation.rule.data.tense], state);

  // Correct tense issues in each of the rule node's children.
  const rule = modified.rule;
  const checked = range(rule.rhs.length).map(() => false);
  for (const i of modified.rule.data.precedence) {
    modified.children[i] = recurse(modified.children[i], state);
    checked[i] = true;
  }
  const original = state.tense;
  for (let i = 0; i < checked.length; i++) {
    if (checked[i]) continue;
    const child_state = {...state, tense: {}};
    modified.children[i] = recurse(modified.children[i], child_state);
  }
  return modified;
};

// TODO(skishore): We need to wrap up this algorithm in a need interface that:
//
//  1. Takes the "correct" method for correcting terms as input.
//  2. Builds the state and calls the recursive algorithm above.
//  3. Computes a diff between the resulting parse tree and the original one.
//  4. For each diff chunk, records a list of issues causing that diff.
