declare const process: any;

import {transliterator} from './hindi/transliterator';
import {wx} from './hindi/wx';
import {lexer} from './lib/lexer';
import {template} from './lib/template';
import {trie} from './lib/trie';
import {Test} from './test';

const kTestCases = {
  lexer,
  template,
  transliterator,
  trie,
  wx,
};

Test.run(kTestCases).then((x) => process.exit(x));
