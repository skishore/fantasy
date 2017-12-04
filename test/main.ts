declare const process: any;

import {transliterator} from './hindi/transliterator';
import {wx} from './hindi/wx';
import {template} from './lib/template';
import {trie} from './lib/trie';
import {compiler} from './parsing/compiler';
import {corrector} from './parsing/corrector';
import {parser} from './parsing/parser';
import {generator} from './parsing/generator';
import {Test} from './test';

const kTestCases = {
  compiler,
  corrector,
  generator,
  parser,
  template,
  transliterator,
  trie,
  wx,
};

Test.run(kTestCases).then((x) => process.exit(x));
