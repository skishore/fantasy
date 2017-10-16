declare const process: any;

import {template} from './lib/template';
import {compiler} from './parsing/compiler';
import {Test} from './test';

const kTestCases = {
  compiler,
  template,
};

Test.run(kTestCases).then((x) => process.exit(x));
