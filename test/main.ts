// tslint:disable-next-line:no-any
declare const process: any;

import {transliterator} from './hindi/transliterator';
import {wx} from './hindi/wx';
import {dawg} from './lib/dawg';
import {lambda} from './template/lambda';
import {value} from './template/value';
import {Test} from './test';

const kTestCases = {
  dawg,
  lambda,
  transliterator,
  value,
  wx,
};

process.exit(Test.run(kTestCases));
