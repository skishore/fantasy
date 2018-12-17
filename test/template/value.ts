import {Template} from '../../src/template/value';
import {Test} from '../test';

const value: Test = {
  boolean_template_works: () => {
    const template = Template.parse('false');
    Test.assert_eq(template.merge([]), false);
    Test.assert_eq(template.split(false), [{}]);
    Test.assert_eq(template.split(true), []);
    Test.assert_eq(template.split(null), []);
  },
  number_template_works: () => {
    const template = Template.parse('17.5');
    Test.assert_eq(template.merge([]), 17.5);
    Test.assert_eq(template.split(17.5), [{}]);
    Test.assert_eq(template.split(17), []);
    Test.assert_eq(template.split(null), []);
  },
  string_template_works: () => {
    const template = Template.parse('"1000"');
    Test.assert_eq(template.merge([]), '1000');
    Test.assert_eq(template.split('1000'), [{}]);
    Test.assert_eq(template.split(1000), []);
    Test.assert_eq(template.split(null), []);
  },
  dict_template_works: () => {
    const template = Template.parse('{num: 17, str: "is", bool: false}');
    Test.assert_eq(template.merge([]), {num: 17, str: 'is', bool: false});
    Test.assert_eq(template.split({num: 17, str: 'is', bool: false}), [{}]);
    Test.assert_eq(template.split({num: 17, str: 'is'}), []);
    Test.assert_eq(template.split(null), []);
  },
  list_template_works: () => {
    const template = Template.parse('[17, "is", false]');
    Test.assert_eq(template.merge([]), [17, 'is', false]);
    Test.assert_eq(template.split([17, 'is', false]), [{}]);
    Test.assert_eq(template.split([17, 'is']), []);
    Test.assert_eq(template.split(null), []);
  },
  variable_template_works: () => {
    const template = Template.parse('$2');
    Test.assert_eq(template.merge([null, null, 17]), 17);
    Test.assert_eq(template.split(17), [{2: 17}]);
    Test.assert_eq(template.split(null), [{2: null}]);
  },
  dict_with_variables_works: () => {
    const template = Template.parse('{num: $0, bool: $2}');
    Test.assert_eq(template.merge([17, 'is', false]), {num: 17, bool: false});
    Test.assert_eq(template.merge([17, 'is', null]), {num: 17});
    Test.assert_eq(template.merge([null, 'is', null]), null);
    Test.assert_eq(template.split({num: 17, bool: false, key: 'value'}), []);
    Test.assert_eq(template.split({num: 17, bool: false}), [{0: 17, 2: false}]);
    Test.assert_eq(template.split({num: 17}), [{0: 17, 2: null}]);
    Test.assert_eq(template.split(null), [{0: null, 2: null}]);
    Test.assert_eq(template.split({}), []);
  },
  dict_with_spreads_works: () => {
    const template = Template.parse('{num: $0, ...$1, bool: $2}');
    Test.assert_eq(template.merge([17, {str: 'is'}, false]), {
      num: 17,
      str: 'is',
      bool: false,
    });
    Test.assert_eq(template.merge([17, null, false]), {num: 17, bool: false});
    Test.assert_eq(template.merge([null, null, null]), null);
    Test.assert_eq(template.split({num: 17, bool: false}), [
      {0: 17, 1: {bool: false}, 2: null},
      {0: null, 1: {num: 17, bool: false}, 2: null},
      {0: 17, 1: null, 2: false},
      {0: null, 1: {num: 17}, 2: false},
    ]);
    Test.assert_eq(template.split({num: 17}), [
      {0: 17, 1: null, 2: null},
      {0: null, 1: {num: 17}, 2: null},
    ]);
    Test.assert_eq(template.split(null), [{0: null, 1: null, 2: null}]);
    Test.assert_eq(template.split({}), []);
  },
  list_with_variables_works: () => {
    const template = Template.parse('[$0, $1]');
    Test.assert_eq(template.merge(['a', 'b']), ['a', 'b']);
    Test.assert_eq(template.merge(['a', null]), ['a']);
    Test.assert_eq(template.merge([null, null]), null);
    Test.assert_eq(template.split(['a', 'b', 'c']), []);
    Test.assert_eq(template.split(['a', 'b']), [{0: 'a', 1: 'b'}]);
    Test.assert_eq(template.split(['a']), [
      {0: null, 1: 'a'},
      {0: 'a', 1: null},
    ]);
    Test.assert_eq(template.split(null), [{0: null, 1: null}]);
    Test.assert_eq(template.split([]), []);
  },
  list_with_spreads_works: () => {
    const template = Template.parse('[$0, ...$1, ...$2]');
    Test.assert_eq(template.merge(['a', ['b', 'c'], null]), ['a', 'b', 'c']);
    Test.assert_eq(template.merge(['a', null, null]), ['a']);
    Test.assert_eq(template.merge([null, null, null]), null);
    Test.assert_eq(template.split(['a', 'b', 'c']), [
      {0: null, 1: null, 2: ['a', 'b', 'c']},
      {0: null, 1: ['a'], 2: ['b', 'c']},
      {0: 'a', 1: null, 2: ['b', 'c']},
      {0: null, 1: ['a', 'b'], 2: ['c']},
      {0: 'a', 1: ['b'], 2: ['c']},
      {0: null, 1: ['a', 'b', 'c'], 2: null},
      {0: 'a', 1: ['b', 'c'], 2: null},
    ]);
    Test.assert_eq(template.split(['a', 'b']), [
      {0: null, 1: null, 2: ['a', 'b']},
      {0: null, 1: ['a'], 2: ['b']},
      {0: 'a', 1: null, 2: ['b']},
      {0: null, 1: ['a', 'b'], 2: null},
      {0: 'a', 1: ['b'], 2: null},
    ]);
    Test.assert_eq(template.split(['a']), [
      {0: null, 1: null, 2: ['a']},
      {0: null, 1: ['a'], 2: null},
      {0: 'a', 1: null, 2: null},
    ]);
    Test.assert_eq(template.split(null), [{0: null, 1: null, 2: null}]);
    Test.assert_eq(template.split([]), []);
  },
  parse_fails_on_unquoted_string_literal: () => {
    Test.assert_error(() => Template.parse('failed'), 'At line 1, column 1');
  },
  parse_fails_on_malformatted_dict: () => {
    Test.assert_error(() => Template.parse('{num; 42}'), 'At line 1, column 5');
  },
  parse_fails_on_malformatted_list: () => {
    Test.assert_error(() => Template.parse('["a" "b"]'), 'At line 1, column 6');
  },
  parse_handles_whitespace: () => {
    const t = Template.parse(' { x : [ true , 2 , "3" , ...$0 , $1 ] } ');
    Test.assert_eq(t.merge([[4, 5], 6]), {x: [true, 2, '3', 4, 5, 6]});
  },
};

export {value};
