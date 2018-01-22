declare const require: any;
const fs = require('fs');
const util = require('util');

import {Compiler} from '../../src/parsing/compiler';
import {Test} from '../test';

const read = (filename: string): Promise<string> => {
  const readFileAsync = util.promisify(fs.readFile);
  return readFileAsync(filename, {encoding: 'utf8'});
}

const compiler: Test = {
  error_on_dead_end_symbols: () => {
    const input = `
      main -> determiner:? adjective:* noun
      determiner -> "the"
    `;
    Test.assert_error(() => Compiler.compile(input),
                      'Found dead-end symbols: adjective, noun');
  },
  error_on_unreachable_symbols: () => {
    const input = `
      main -> determiner:? adjective:* noun
      determiner -> "the"
      adjective -> "big" | "small"
      noun -> "cat" | "dog"
      verb -> "eat" | "eats"
    `;
    Test.assert_error(() => Compiler.compile(input),
                      'Found unreachable symbols: verb');
  },
};

['bootstrapped', 'template'].forEach((x) => {
  compiler[`${x}_grammar_compiles`] = () => {
    const input = read(`src/dsl/${x}.ne`);
    const output = read(`src/dsl/${x}.js`);
    return Promise.all([input, output]).then(([input, output]) => {
      Test.assert_eq(Compiler.compile(input), output);
    });
  }
});

export {compiler};
