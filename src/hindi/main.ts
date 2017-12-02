import {Option, debug, flatten} from '../lib/base';
import {Match} from '../parsing/lexer';
import {HindiLexer} from './lexer';
import {Vocabulary} from './vocabulary';
import {wx_to_hindi} from './wx';

const {adjective, copula, noun, particle, pronoun, verb} = Vocabulary;

const vocabulary = flatten([
  adjective('bad', 'kharab/KarAb'),
  adjective('large', 'bara/baDZA'),
  copula('hoon/hUz hai/hE . hain/hEM ho/ho hain/hEM .'),
  noun('apple', 'seb/seb . . sebo/seboM', 'masculine'),
  noun('boy', 'larka/ladZakA larke/ladZake . larko/ladZakoM', 'masculine'),
  particle('this', 'yeh/yah', 'determiner'),
  particle('that', 'voh/vah', 'determiner'),
  pronoun('main/mEM tu/wU voh/vah hum/ham tum/wum aap/Ap voh/vah'),
  verb('eat', 'khana/KAnA'),
  verb('sleep', 'sona/sonA'),
]);

vocabulary.forEach((x) => {
  const hindi = wx_to_hindi(x.wx);
  console.log(debug({hindi, latin: x.latin, type: x.type, value: x.value}));
});

const lexer = new HindiLexer(vocabulary);

console.log();
for (const token of lexer.lex('Voh hai ek seb!')) {
  const data = {...token};
  token.text_matches = <any>Object.keys(token.text_matches);
  token.type_matches = <any>Object.keys(token.type_matches);
  console.log(debug(token));
}

const match_debug = (match: Option<Match>): string => {
  if (!match) return debug(null);
  const data = match.some.data;
  return debug(typeof data === 'string' ? data : data.latin);
}

console.log();
console.log(match_debug(lexer.unlex_type('_', null)));
console.log(match_debug(lexer.unlex_type('_', {some: ' '})));
console.log(match_debug(lexer.unlex_type('_', {some: 'Voh'})));
console.log(match_debug(lexer.unlex_type('token', {some: 'Voh'})));

console.log();
const match = lexer.unlex_text('hUz', null)!.some;
const tense2 = {number: 'singular', person: 'second'};
for (const person of ['first', 'second', 'third']) {
  const tense = {number: 'singular', person};
  console.log(match_debug(lexer.match_tense(match, tense)));
}
