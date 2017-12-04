declare const process: any;
declare const require: any;

const fs = require('fs');
const commander = require('../external/commander');

import {debug} from '../lib/base';
import {Corrector} from '../parsing/corrector';
import {Derivation} from '../parsing/derivation';
import {Grammar} from '../parsing/grammar';
import {Parser} from '../parsing/parser';

commander
  .version('0.1.0')
  .arguments('<grammar> <input...>')
  .action((grammar: string, input: string) => {})
  .parse(process.argv);

const readEntireStream = (stream: any): Promise<string> => {
  const data: string[] = [];
  stream.on('data', (x: string) => data.push(x));
  return new Promise((resolve, reject) => {
    stream.on('end', () => resolve(data.join('')));
    stream.on('error', reject);
  });
}

const verbose_correct =
    (derivation: Derivation, grammar: Grammar, input: string): void => {
  console.error(`Original input: ${JSON.stringify(input)}`);
  const correction = Corrector.correct(derivation, grammar);
  console.error(`Corrected text: ${JSON.stringify(correction.output)}`);
  for (const issue of correction.issues) {
    const [i, j] = issue.range;
    const text = issue.input.substring(i, j);
    console.error(`- At ${i}:${j} ${JSON.stringify(text)}: ${issue.error}`);
  }
}

const verbose_parse = (grammar: Grammar, input: string): Derivation => {
  const parser = new Parser(grammar);
  console.error(parser.debug());
  for (const token of grammar.lexer.lex(input)) {
    console.error();
    parser.feed(token);
    console.error(parser.debug());
  }
  const derivation = parser.result();
  console.error('\nDerivation:');
  console.error(Derivation.print(derivation, /*depth=*/1));
  console.error();
  console.error(debug(derivation.value!.some));
  return derivation;
}

readEntireStream(fs.createReadStream(commander.args[0]))
  .then((data) => Grammar.from_code(data))
  .then((grammar) => {
    const input = commander.args[1].join(' ');
    const derivation = verbose_parse(grammar, input);
    if (grammar.templated) {
      console.error();
      verbose_correct(derivation, grammar, input);
    }
  }).catch((error) => console.error(error.stack));
