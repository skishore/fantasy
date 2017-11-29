import {Option, debug, flatten} from '../lib/base';
import {Match, Token} from './lexer';
import {Grammar, Rule, Term} from './grammar';

type Derivation =
    {type: 'leaf', leaf: Leaf, value: Option<any>} |
    {type: 'node', rule: Rule, value: Option<any>, xs: Derivation[]};

interface Leaf {match: Match, term: Term, token?: Token};

const empty = (derivation: Derivation): boolean =>
    derivation.type === 'node' && derivation.xs.every(empty);

const matches = (derivation: Derivation): Match[] =>
    derivation.type === 'leaf' ? [derivation.leaf.match] :
        flatten(derivation.xs.map(matches));

const print = (derivation: Derivation, depth?: number): string => {
  if (empty(derivation)) return '';
  const padding = Array(depth || 0).fill('  ').join('');
  if (derivation.type === 'leaf') {
    const token = derivation.leaf.token;
    const lhs = Grammar.print_term(derivation.leaf.term);
    const text = token && token.input.substr(token.range[0], token.range[1]);
    return `${padding}${lhs} -> ${debug(text)}`;
  } else {
    const rhs = derivation.rule.rhs;
    const lines = [`${padding}${derivation.rule.lhs}:`]
    derivation.xs.forEach((x, i) => lines.push(print(x, (depth || 0) + 1)));
    return lines.filter((x) => !!x).join('\n');
  }
}

const tokens = (derivation: Derivation): Token[] => {
  if (derivation.type === 'leaf') {
    const token = derivation.leaf.token;
    return !!token ? [token] : [];
  }
  return flatten(derivation.xs.map(tokens));
}

const Derivation = {empty, matches, print, tokens};

export {Derivation, Leaf};
