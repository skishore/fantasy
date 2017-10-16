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
  check_bootstrapped_grammar: () => {
    const compiler = new Compiler();
    const input = read('src/dsl/bootstrapped.ne');
    const output = read('src/dsl/bootstrapped.js');
    return Promise.all([input, output]).then(([input, output]) => {
      Test.assert_eq(compiler.compile(input), output);
    });
  },
};

export {compiler};
