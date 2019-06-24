import {nonnull} from '../../src/lib/base';
import {Lambda} from '../../src/payload/lambda';
import {Test} from '../test';

const dsl = <T>(fn: (x: string) => T) => (x: TemplateStringsArray): T => {
  if (x.length !== 1) throw new Error(`Invalid template: ${x.raw}`);
  return fn(x[0]);
};

const l = dsl(Lambda.parse);
const t = dsl(Lambda.template);

const lambda: Test = {
  merging_joins_works: () => {
    const template = t`color.$0`;
    Test.assert_eq(template.merge([l`red`]), l`color.red`);
    Test.assert_eq(template.merge([null]), null);
  },
  merging_binary_operators_works: () => {
    const template = t`$0 & country.$1`;
    Test.assert_eq(template.merge([l`I`, l`US`]), l`I & country.US`);
    Test.assert_eq(template.merge([l`I`, null]), l`I`);
    Test.assert_eq(template.merge([null, l`US`]), l`country.US`);
    Test.assert_eq(template.merge([null, null]), null);
  },
  merging_unary_operators_works: () => {
    const template = t`R[$0].I & ~$1`;
    Test.assert_eq(template.merge([l`name`, l`X`]), l`R[name].I & ~X`);
    Test.assert_eq(template.merge([l`R[name]`, l`X`]), l`name.I & ~X`);
    Test.assert_eq(template.merge([l`name`, l`~X`]), l`R[name].I & X`);
    Test.assert_eq(template.merge([l`R[name]`, l`~X`]), l`name.I & X`);
    Test.assert_eq(template.merge([l`name`, null]), l`R[name].I`);
    Test.assert_eq(template.merge([null, l`~X`]), l`X`);
    Test.assert_eq(template.merge([null, null]), null);
  },
  merging_custom_functions_works: () => {
    const template = t`Tell($0, name.$1)`;
    Test.assert_eq(template.merge([l`I`, l`X`]), l`Tell(I, name.X)`);
    Test.assert_eq(template.merge([l`I`, null]), null);
    Test.assert_eq(template.merge([null, l`X`]), null);
    Test.assert_eq(template.merge([null, null]), null);
  },
  splitting_joins_works: () => {
    const template = t`color.$0`;
    Test.assert_eq(template.split(l`color.red`), [{0: l`red`}]);
    Test.assert_eq(template.split(null), [{0: null}]);
  },
  splitting_binary_operators_works: () => {
    const template = t`$0 & country.$1`;
    Test.assert_eq(template.split(l`I & country.US`), [
      {0: l`I`, 1: l`US`},
      {0: l`I & country.US`, 1: null},
    ]);
    Test.assert_eq(template.split(l`country.US & I`), [
      {0: l`I`, 1: l`US`},
      {0: l`country.US & I`, 1: null},
    ]);
    Test.assert_eq(template.split(l`country.US`), [
      {0: null, 1: l`US`},
      {0: l`country.US`, 1: null},
    ]);
    Test.assert_eq(template.split(l`I`), [{0: l`I`, 1: null}]);
    Test.assert_eq(template.split(null), [{0: null, 1: null}]);
  },
  splitting_unary_operators_works: () => {
    const template = t`R[$0].I & ~$1`;
    Test.assert_eq(template.split(l`R[name].I & ~Ann`), [
      {0: null, 1: l`~(R[name].I & ~Ann)`},
      {0: l`name`, 1: l`Ann`},
    ]);
  },
  splitting_custom_functions_works: () => {
    const template = t`Tell($0, name.$1)`;
    Test.assert_eq(template.split(l`Tell(I, name.X)`), [{0: l`I`, 1: l`X`}]);
    Test.assert_eq(template.split(null), [{0: null}, {1: null}]);
  },
  binary_operators_commute: () => {
    const template = t`$0 & country.$1`;
    Test.assert_eq(template.split(l`country.US & I`), [
      {0: l`I`, 1: l`US`},
      {0: l`country.US & I`, 1: null},
    ]);
  },
  parse_handles_underscore: () => {
    const lambda = l`abc_de_f(hi_jk.lm_no)`;
    Test.assert_eq(lambda, l`abc_de_f(hi_jk.lm_no)`);
  },
  parse_handles_whitespace: () => {
    const lambda = l` Tell ( ( R [ a ] . b & c ) | d , ( e . f | ~ ( g ) ) ) `;
    Test.assert_eq(lambda, l`Tell((R[a].b & c) | d, e.f | ~g)`);
  },
  printing_returns_sorted_results: () => {
    const lambda = l`Tell(x) & f.e & (d.c | b.a)`;
    Test.assert_eq(Lambda.stringify(lambda), '(b.a | d.c) & Tell(x) & f.e');
  },
};

export {lambda};
