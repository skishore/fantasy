// tslint:disable-next-line:no-any
declare const process: any;

import {transliterator} from './hindi/transliterator';
import {wx} from './hindi/wx';
import {dawg} from './lib/dawg';
import {corrector} from './nlu/corrector';
import {generator} from './nlu/generator';
import {parser} from './nlu/parser';
import {base} from './payload/base';
import {lambda} from './payload/lambda';
import {json} from './payload/json';
import {Test} from './test';

const kTestCases = {
  base,
  corrector,
  dawg,
  json,
  lambda,
  generator,
  parser,
  transliterator,
  wx,
};

process.exit(Test.run(kTestCases));
