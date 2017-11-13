declare const process: any;

import {template} from './lib/template';
import {trie} from './lib/trie';
import {compiler} from './parsing/compiler';
import {Test} from './test';

const kTestCases = {
  compiler,
  template,
  trie,
};

Test.run(kTestCases).then((x) => process.exit(x));
