declare const process: any;

import {template} from './lib/template';
import {Test} from './test';

const kTestCases = {
  template,
};

Test.run(kTestCases).then((x) => process.exit(x));
