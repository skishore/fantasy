import {flatten} from '../lib/base';
import {Derivation, Leaf} from './derivation';
import {Agreement, Lexer, Match, Token} from './lexer';
import {Generator} from './generator';
import {Check, Grammar, Rule} from './grammar';

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
  agreement: Agreement,
  grammar: Grammar,
  issues: Issue[],
}

const check = (actual: Agreement, state: State): string | null => {
  const goal = state.agreement;
  const axes = Object.keys(goal).sort();
  return axes.filter((x) => actual.hasOwnProperty(x) && actual[x] !== goal[x])
             .map((x) => `${x} should be ${goal[x]} (was: ${actual[x]})`)
             .join('; ');
}

const check_and_update = (
    actual: Agreement | void, state: State): string | null => {
  if (!actual) return null;
  const error = check(actual, state);
  if (error) return error;
  Object.assign(state.agreement, actual);
  return null;
}

const check_rule = (rule: Rule, state: State): string | null => {
  if (rule.checks.length === 0) return null;
  return check(rule.checks[0].agreement, state);
}

const get_matches = (derivation: Derivation): Match[] =>
    derivation.type === 'leaf' ? [derivation.leaf.match] :
        flatten(derivation.xs.map(get_matches));

const get_tokens = (derivation: Derivation): Token[] => {
  if (derivation.type === 'leaf') {
    const token = derivation.leaf.token;
    return !!token ? [token] : [];
  }
  return flatten(derivation.xs.map(get_tokens));
}

const note = (derivation: Derivation, error: string, state: State): Issue => {
  const tokens = get_tokens(derivation);
  if (tokens.length === 0) return {error: '', input: '', range: [0, 0]};
  const last = tokens[tokens.length - 1];
  const range: [number, number] = [tokens[0].range[0], last.range[1]];
  state.issues.push({error, input: last.input, range});
  return state.issues[state.issues.length];
}

const recurse = (derivation: Derivation, state: State): Derivation => {
  // Correct leaf nodes using the Lexer's match_agreement method.
  if (derivation.type === 'leaf') {
    const match = derivation.leaf.match;
    const error = check_and_update(match.agreement, state);
    if (!error) return derivation;
    const issue = note(derivation, error, state);
    const maybe = state.grammar.lexer.match_agreement(match, state.agreement);
    if (!maybe) return derivation;
    check_and_update(maybe.some.agreement, state);
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
  check_and_update((modified.rule.checks[0] || {}).agreement, state);

  // Correct agreement issues in each of the rule node's children.
  const rule = modified.rule;
  const base : Check = {agreement: {}, indices: rule.rhs.map((x, i) => i)};
  const checks = rule.checks.length === 0 ? [base] : rule.checks;
  const original = state.agreement;
  for (let i = 0; i < checks.length; i++) {
    if (i > 0) state.agreement = {...checks[i].agreement};
    for (const j of checks[i].indices) {
      modified.xs[j] = recurse(modified.xs[j], state);
    }
  }

  state.agreement = original;
  if (top_level_issue) {
    top_level_issue.replacement =
        state.grammar.lexer.join(get_matches(modified));
  }
  return modified;
}

// The final correction interface.

const correct = (derivation: Derivation, grammar: Grammar): Correction => {
  const state: State = {agreement: {}, grammar, issues: []};
  const corrected = recurse(derivation, state);
  const issues = state.issues.sort((a, b) => a.range[0] - b.range[0]);
  const output = grammar.lexer.join(get_matches(corrected));
  return {derivation: corrected, issues: state.issues, output};
}

const Corrector = {correct};

export {Corrector};
