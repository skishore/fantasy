import {Option, debug, flatten} from '../lib/base';
import {Match, Token} from './lexer';
import {Grammar, Rule, Term} from './grammar';

type Derivation =
    {type: 'leaf', leaf: Leaf, value: Option<any>} |
    {type: 'node', rule: Rule, value: Option<any>, xs: Derivation[]};

interface Leaf {match: Match, term: Term, token?: Token};

const empty = (derivation: Derivation): boolean =>
    derivation.type === 'node' && derivation.xs.every(empty);

const print = (derivation: Derivation, depth?: number): string => {
  if (empty(derivation)) return '';
  const padding = Array(depth || 0).fill('  ').join('');
  if (derivation.type === 'leaf') {
    const lhs = Grammar.print_term(derivation.leaf.term);
    return `${padding}${lhs} -> ${debug(derivation.leaf.match.text)}`;
  } else {
    const rhs = derivation.rule.rhs;
    const lines = [`${padding}${derivation.rule.lhs}:`]
    derivation.xs.forEach((x, i) => lines.push(print(x, (depth || 0) + 1)));
    return lines.filter((x) => !!x).join('\n');
  }
}

const texts = (derivation: Derivation): string[] =>
    derivation.type === 'leaf' ? [derivation.leaf.match.text] :
        flatten(derivation.xs.map(texts));

const Derivation = {empty, print, texts};

export {Derivation, Leaf};
