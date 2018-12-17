// tslint:disable-next-line:no-any
declare const process: any;

import {transliterator} from './hindi/transliterator';
import {wx} from './hindi/wx';
import {dawg} from './lib/dawg';
import {corrector} from './parsing/corrector';
import {generator} from './parsing/generator';
import {parser} from './parsing/parser';
import {base} from './template/base';
import {lambda} from './template/lambda';
import {value} from './template/value';
import {Test} from './test';

const kTestCases = {
  base,
  corrector,
  dawg,
  lambda,
  generator,
  parser,
  transliterator,
  value,
  wx,
};

process.exit(Test.run(kTestCases));
