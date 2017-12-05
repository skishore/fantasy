import {flatten} from '../lib/base';
import {Derivation, Leaf} from './derivation';
import {Lexer, Match, Tense, Token} from './lexer';
import {Generator} from './generator';
import {Grammar, Rule, Syntax} from './grammar';

// The correction interface takes a Derivation and attempts to correct it.
// Its output is a new derivation, a new text output, and a list of "fixes",
// each of which is a substring of the original input with a correction.

interface Correction {
  derivation: Derivation,
  issues: Issue[],
  output: string,
}

interface Issue {
  error: string,
  input: string,
  range: [number, number],
  replacement?: string,
}

// Helpers used to implement correct.

interface State {
  tense: Tense,
  grammar: Grammar,
  issues: Issue[],
}

const check = (actual: Tense, state: State): string | null => {
  const goal = state.tense;
  const axes = Object.keys(goal).sort();
  return axes.filter((x) => actual.hasOwnProperty(x) && actual[x] !== goal[x])
             .map((x) => `${x} should be ${goal[x]} (was: ${actual[x]})`)
             .join('; ');
}

const check_and_update = (
    actual: Tense[] | void, state: State): string | null => {
  if (!actual) return null;
  const xs = actual.map((x) => check(x, state));
  const okay = actual.filter((x, i) => !xs[i]);
  if (okay.length === 0) return xs.sort((a, b) => a!.length - b!.length)[0];
  Object.assign(state.tense, merge(okay));
  return null;
}

const check_rule = (rule: Rule, state: State): string | null => {
  if (rule.syntaxes.length === 0) return null;
  return check(rule.syntaxes[0].tense, state);
}

const merge = (tenses: Tense[]): Tense => {
  const first = tenses[0] || {};
  if (tenses.length <= 1) return first;
  const result: Tense = {};
  Object.keys(first)
      .filter((x) => tenses.every((y) => y[x] === first[x]))
      .forEach((x) => result[x] = first[x]);
  return result;
}

const note = (derivation: Derivation, error: string, state: State): Issue => {
  const tokens = Derivation.tokens(derivation);
  if (tokens.length === 0) return {error: '', input: '', range: [0, 0]};
  const last = tokens[tokens.length - 1];
  const range: [number, number] = [tokens[0].range[0], last.range[1]];
  state.issues.push({error, input: last.input, range});
  return state.issues[state.issues.length - 1];
}

const recurse = (derivation: Derivation, state: State): Derivation => {
  // Correct leaf nodes using the Lexer's match_tense method.
  if (derivation.type === 'leaf') {
    const match = derivation.leaf.match;
    const error = check_and_update(match.tenses, state);
    if (!error) return derivation;
    const issue = note(derivation, error, state);
    const maybe = state.grammar.lexer.match_tense(match, state.tense);
    if (!maybe) return derivation;
    check_and_update(maybe.some.tenses, state);
    issue.replacement = state.grammar.lexer.join([match]);
    return {...derivation, leaf: {...derivation.leaf, match: maybe.some}};
  }

  let modified: Derivation = {...derivation};
  modified.xs = modified.xs.slice();

  // Correct top-level issues at a derivation rule node by regenerating the
  // entire subtree rooted at this node.
  let top_level_issue: Issue | null = null;
  const error = check_rule(derivation.rule, state);
  if (error) {
    top_level_issue = note(derivation, error, state);
    const rules = state.grammar.by_name[derivation.rule.lhs].filter(
        (x) => !check_rule(x, state));
    const replacement = Generator.generate_from_rules(
        state.grammar, rules, derivation.value);
    replacement ? (modified = replacement) : (top_level_issue = null);
  }
  if (modified.type !== 'node') throw Error('Invalid node replacement!');
  const check = modified.rule.syntaxes[0];
  if (check) check_and_update([check.tense], state);

  // Correct tense issues in each of the rule node's children.
  const rule = modified.rule;
  const base: Syntax = {indices: rule.rhs.map((x, i) => i), tense: {}};
  const syntaxes = rule.syntaxes.length === 0 ? [base] : rule.syntaxes;
  const original = state.tense;
  for (let i = 0; i < syntaxes.length; i++) {
    if (i > 0) state.tense = {...syntaxes[i].tense};
    for (const j of syntaxes[i].indices) {
      modified.xs[j] = recurse(modified.xs[j], state);
    }
  }

  state.tense = original;
  if (top_level_issue) {
    const matches = Derivation.matches(modified);
    top_level_issue.replacement = state.grammar.lexer.join(matches);
  }
  return modified;
}

// The final correction interface.

const correct = (derivation: Derivation, grammar: Grammar): Correction => {
  const state: State = {tense: {}, grammar, issues: []};
  const corrected = recurse(derivation, state);
  const issues = state.issues.sort((a, b) => a.range[0] - b.range[0]);
  const output = grammar.lexer.join(Derivation.matches(corrected));
  return {derivation: corrected, issues: state.issues, output};
}

const Corrector = {correct};

export {Corrector};
