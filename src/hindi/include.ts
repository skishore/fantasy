import {debug, flatten} from '../lib/base';
import {HindiLexer} from './lexer';
import {Vocabulary} from './vocabulary';

const {adjective, copula, noun, number, particle, pronoun, verb} = Vocabulary;

const vocabulary = flatten([
  adjective('bad', 'kharab/KarAb'),
  adjective('large', 'bara/baDZA'),
  adjective('small', 'chota/cotA'),
  copula('hoon/hUz hai/hE . hain/hEM ho/ho hain/hEM .'),
  noun('apple', 'seb/seb . . sebo/seboM', 'masculine'),
  noun('boy', 'larka/ladZakA larke/ladZake . larko/ladZakoM', 'masculine'),
  noun('boss', 'malik/mAlik . . maliko/mAlikoM', 'masculine'),
  noun('girl', 'larki/ladZakI . larkiya/ladZakiyA larkiyo/ladZakiyoM', 'feminine'),
  number('sifar/siPZar ek/ek do/xo theen/wIn char/cAr panch/pAzc'),
  particle('this', 'yeh/yah', 'determiner'),
  particle('that', 'voh/vah', 'determiner'),
  pronoun('main/mEM tu/wU voh/vah hum/ham tum/wum aap/Ap voh/vah'),
  verb('eat', 'khana/KAnA'),
  verb('sleep', 'sona/sonA'),
]);

const lexer = new HindiLexer(vocabulary);

export {lexer};
