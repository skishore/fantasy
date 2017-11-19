declare const process: any;

import {wx} from './hindi/wx';
import {template} from './lib/template';
import {trie} from './lib/trie';
import {compiler} from './parsing/compiler';
import {generator} from './parsing/generator';
import {Test} from './test';

const kTestCases = {
  compiler,
  generator,
  template,
  trie,
  wx,
};

Test.run(kTestCases).then((x) => process.exit(x));
