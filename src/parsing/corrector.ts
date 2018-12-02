import {Option, assert, range} from '../lib/base';
import {Lambda, Template} from '../template/lambda';
import {Grammar, Match} from './base';
import {Derivation} from './derivation';
import {Generator} from './generator';

// Below, we define the types that make correction possible.
//
// We can only correct a grammar if two conditions are satisfied:
//
//  1. Its T type must be a Derivation, meaning it returns full parse trees.
//  2. Its rules and tokens are augmented with additional tense information.
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
  text: {[language: string]: string};
}

interface Base<T> extends Grammar<Option<T>, T, RuleData, TermData> {}

interface Lift<T> extends Grammar<Option<T>, Tree<T>, RuleData> {}

type Term<T> = Match<T> & TermData;

type Tree<T> = Derivation<Base<T>>;

const derive: <T>(base: Base<T>) => Lift<T> = Derivation.derive;

// Internal implementation details of the correction algorithm.
//
// TODO(skishore): The way we track interfaces in the State type is broken.
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
  correct: (match: Term<T>, tense: Tense) => Term<T> | null;
  grammar: Lift<T>;
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
    const issues = apply(derivation.match.tenses, state);
    if (issues.length === 0) return derivation;
    // TODO(skishore): Record the issues in the state.
    const maybe = state.correct(match, state.tense);
    if (!maybe) return derivation;
    assert(apply(maybe.tenses, state).length === 0);
    return {...derivation, match: maybe};
  }

  let modified: Tree<T> = {...derivation};
  modified.children = modified.children.slice();

  // Correct top-level issues at a derivation rule node by regenerating the
  // entire subtree rooted at this node.
  const issues = check(derivation.rule.tense, state.tense);
  if (issues.length > 0) {
    // TODO(skishore): Record the issues in the state.
    const lhs = derivation.rule.lhs;
    const rules = state.grammar.rules.filter(
      x => x.lhs === lhs && check(x.tense, state.tense).length === 0,
    );
    const value = {some: derivation.value};
    const fixed = Generator.generate_from_rules(state.grammar, rules, value);
    if (fixed) modified = fixed.some;
  }
  if (modified.type !== 'node') throw Error('Invalid node replacement!');
  apply([derivation.rule.tense], state);

  // Correct tense issues in each of the rule node's children.
  const rule = modified.rule;
  const checked = range(rule.rhs.length).map(() => false);
  for (const i of modified.rule.precedence) {
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
