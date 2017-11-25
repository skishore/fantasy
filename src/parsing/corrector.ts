import {flatten} from '../lib/base';
import {Derivation} from './derivation';
import {Lexer, Match} from './lexer';
import {Grammar} from './grammar';

// The correction interface takes a Derivation and attempts to correct it.
// Its output is a new derivation, a new text output, and a list of "fixes",
// each of which is a substring of the original input with a correction.

interface Correction {
  derivation: Derivation,
  fixes: Fix[],
  output: string,
}

interface Fix {
  input: string,
  range: [number, number],
  replacement: string,
}

// Helpers used to implement correct.

const matches = (derivation: Derivation): Match[] =>
    derivation.type === 'leaf' ? [derivation.leaf.match] :
        flatten(derivation.xs.map(matches));

// The final correction interface.

const correct = (derivation: Derivation, grammar: Grammar): Correction => {
  const output = grammar.lexer.join(matches(derivation));
  return {derivation, fixes: [], output};
}

export {correct};
