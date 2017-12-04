declare const process: any;
declare const require: any;

const fs = require('fs');
const commander = require('../external/commander');

import {debug} from '../lib/base';
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

readEntireStream(fs.createReadStream(commander.args[0]))
  .then((data) => Grammar.from_code(data))
  .then((grammar): [Grammar, Parser] => [grammar, new Parser(grammar)])
  .then(([grammar, parser]) => {
    const input = commander.args[1].join(' ');
    console.error(parser.debug());
    for (const token of grammar.lexer.lex(input)) {
      console.error();
      parser.feed(token);
      console.error(parser.debug());
    }
    const result = parser.result();
    console.error('\nDerivation:');
    console.error(Derivation.print(result, /*depth=*/1));
    console.error();
    console.error(debug(result.value));
  }).catch((error) => console.error(error.stack));
