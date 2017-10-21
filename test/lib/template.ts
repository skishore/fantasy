import {Template} from '../../src/lib/template';
import {Test} from '../test';

const optional = (n: number) => Array(n).fill(true);
const required = (n: number) => Array(n).fill(false);

const template: Test = {
  merge_realizes_boolean: () => {
    const template = new Template('false');
    Test.assert_eq(template.merge([]), false);
  },
  merge_realizes_number: () => {
    const template = new Template('42');
    Test.assert_eq(template.merge([]), 42);
  },
  merge_realizes_string: () => {
    const template = new Template('"is"');
    Test.assert_eq(template.merge([]), 'is');
  },
  merge_realizes_dict: () => {
    const pattern = '{num: 42, str: "is", bool: false}';
    const template = new Template(pattern);
    Test.assert_eq(template.merge([]), {bool: false, num: 42, str: 'is'});
  },
  merge_realizes_list: () => {
    const pattern = '[42, "is", false]';
    const template = new Template(pattern);
    Test.assert_eq(template.merge([]), [42, 'is', false]);
  },
  merge_performs_substitution: () => {
    const [noun, verb] = ['dog', {concept: 'is', tense: 'present'}];
    const template = new Template('{noun: $0, verb: $1}', optional(2));
    Test.assert_eq(template.merge([noun, verb]), {noun, verb});
  },
  merge_spreads_dict_variable: () => {
    const [noun, verb] = ['dog', {concept: 'is', tense: 'present'}];
    const template = new Template('{noun: $0, ...$1}', optional(2));
    Test.assert_eq(template.merge([noun, verb]),
                   {concept: 'is', noun: 'dog', tense: 'present'});
  },
  merge_spreads_list_variable: () => {
    const template = new Template('[$0, ...$1]', optional(2));
    Test.assert_eq(template.merge(['a', ['b', 'c']]), ['a', 'b', 'c']);
  },
  merge_spreads_variable_dict: () => {
    const [noun, verb] = [{concept: 'dog', plural: false}, 'is'];
    const template = new Template('{...$0, verb: $1}', optional(2));
    Test.assert_eq(template.merge([noun, verb]),
                   {concept: 'dog', plural: false, verb: 'is'});
  },
  merge_spreads_variable_list: () => {
    const template = new Template('[...$0, $1]', optional(2));
    Test.assert_eq(template.merge([['a', 'b'], 'c']), ['a', 'b', 'c']);
  },
  merge_concatenates_repeated_list_key: () => {
    const pattern = '{...$0, ...$1}';
    const template = new Template(pattern, optional(2));
    Test.assert_eq(template.merge([{test: [0]}, {test: [1]}]), {test: [0, 1]});
  },
  merge_overwrites_repeated_singular_key: () => {
    const pattern = '{...$0, ...$1}';
    const template = new Template(pattern, optional(2));
    Test.assert_eq(template.merge([{test: 0}, {test: 1}]), {test: 1});
  },
  merge_drops_unset_dict_spread: () => {
    const pattern = '{num: $0, ...$1}';
    const template = new Template(pattern, optional(2));
    Test.assert_eq(template.merge([42, null]), {num: 42});
  },
  merge_drops_unset_dict_variable: () => {
    const pattern = '{num: $0, ...$1}';
    const template = new Template(pattern, optional(2));
    Test.assert_eq(template.merge([null, {bool: false}]), {bool: false});
  },
  merge_returns_none_when_all_dict_elements_are_empty: () => {
    const pattern = '{num: $0, ...$1}';
    const template = new Template(pattern, optional(2));
    Test.assert_eq(template.merge([null, null]), null);
  },
  merge_drops_unset_list_spread: () => {
    const pattern = '[$0, ...$1]';
    const template = new Template(pattern, optional(2));
    Test.assert_eq(template.merge(['a', null]), ['a']);
  },
  merge_drops_unset_list_variable: () => {
    const pattern = '[$0, ...$1]';
    const template = new Template(pattern, optional(2));
    Test.assert_eq(template.merge([null, ['b', 'c']]), ['b', 'c']);
  },
  merge_returns_none_when_all_list_elements_are_empty: () => {
    const pattern = '[$0, ...$1]';
    const template = new Template(pattern, optional(2));
    Test.assert_eq(template.merge([null, null]), null);
  },
  merge_fails_on_list_key_followed_by_singleton: () => {
    const pattern = '{...$0, ...$1}';
    const template = new Template(pattern, optional(2));
    Test.assert_error(() => template.merge([{test: [0]}, {test: 1}]),
                      'singleton cannot merge with list.');
  },
  merge_fails_on_singleton_key_followed_by_list: () => {
    const pattern = '{...$0, ...$1}';
    const template = new Template(pattern, optional(2));
    Test.assert_error(() => template.merge([{test: 0}, {test: [1]}]),
                      'list cannot merge with singleton.');
  },
  merge_fails_on_merging_dict_and_list: () => {
    const pattern = '[...$0, $1]';
    const template = new Template(pattern, optional(2));
    Test.assert_error(() => template.merge([{num: 42}, ['is']]),
                      'Failed to merge dict and list.');
  },
  merge_fails_on_wrong_number_of_subs: () => {
    const pattern = 'false';
    const template = new Template(pattern);
    Test.assert_error(() => template.merge(['extra']),
                      'Expected: 0 subs; got: 1');
  },
  merge_fails_when_variable_resolves_to_primitive: () => {
    const pattern = '{...$0, ...$1}';
    const template = new Template(pattern, optional(2));
    Test.assert_error(() => template.merge([{num: 42}, 'is']),
                      'Failed to merge variable: "is"');
  },
  split_returns_trivial_assignment_for_boolean: () => {
    const pattern = 'false';
    const template = new Template(pattern);
    Test.assert_eq(template.split(false), [{}]);
  },
  split_returns_trivial_assignment_for_number: () => {
    const pattern = '42';
    const template = new Template(pattern);
    Test.assert_eq(template.split(42), [{}]);
  },
  split_assigns_value_to_variable: () => {
    const pattern = '$0';
    const template = new Template(pattern, optional(1));
    Test.assert_eq(template.split(42), [{0: 42}]);
  },
  split_assigns_none_to_null_optional_variable: () => {
    const pattern = '$0';
    const template = new Template(pattern, optional(1));
    Test.assert_eq(template.split(null), [{0: null}]);
  },
  split_leaves_unassigned_variable_free: () => {
    const pattern = '42';
    const template = new Template(pattern, optional(1));
    Test.assert_eq(template.split(42), [{}]);
  },
  split_returns_trivial_assignment_for_dict: () => {
    const pattern = '{num: 42, str: "is", bool: false}';
    const template = new Template(pattern);
    const value = {bool: false, str: 'is', num: 42};
    Test.assert_eq(template.split(value), [{}]);
  },
  split_returns_trivial_assignment_for_list: () => {
    const pattern = '[42, "is", false]';
    const template = new Template(pattern);
    const value = [42, 'is', false];
    Test.assert_eq(template.split(value), [{}]);
  },
  split_assigns_to_key_value_pair: () => {
    const pattern = '{num: $0}';
    const template = new Template(pattern, optional(1));
    Test.assert_eq(template.split({num: 42}), [{0: 42}]);
  },
  split_assigns_to_nested_key_value_pair: () => {
    const pattern = '{measure: {count: $0, ...$1}}';
    const template = new Template(pattern, [false, true]);
    const value = {measure: {count: 42, unit: 'piece'}};
    Test.assert_eq(template.split(value), [{0: 42, 1: {unit: 'piece'}}]);
  },
  split_assigns_to_variables_within_dict: () => {
    const pattern = '{num: $0, str: $2, bool: $4}';
    const template = new Template(pattern, optional(5));
    const value = {bool: false, num: 42};
    Test.assert_eq(template.split(value), [{0: 42, 2: null, 4: false}]);
  },
  split_assigns_to_variables_within_list: () => {
    const pattern = '[$0, $2, $4]';
    const template = new Template(pattern, optional(5));
    const value = [42, false];
    Test.assert_eq(template.split(value),
                   [{0: 42, 2: false, 4: null},
                    {0: 42, 2: null, 4: false},
                    {0: null, 2: 42, 4: false}]);
  },
  split_generates_multiple_hypotheses_for_dict_and_variable: () => {
    const pattern = '{num: $0, ...$1}';
    const value = {num: 42, str: 'is'};
    Test.assert_eq(new Template(pattern, optional(2)).split(value),
                   [{0: 42, 1: {str: 'is'}},
                    {0: null, 1: {num: 42, str: 'is'}}]);
    Test.assert_eq(new Template(pattern, [true, false]).split(value),
                   [{0: 42, 1: {str: 'is'}},
                    {0: null, 1: {num: 42, str: 'is'}}]);
    Test.assert_eq(new Template(pattern, [false, true]).split(value),
                   [{0: 42, 1: {str: 'is'}}]);
    Test.assert_eq(new Template(pattern, required(2)).split(value),
                   [{0: 42, 1: {str: 'is'}}]);
  },
  split_generates_multiple_hypotheses_for_list_and_variable: () => {
    const pattern = '[$0, ...$1]';
    const value = [42, 'is']
    Test.assert_eq(new Template(pattern, optional(2)).split(value),
                   [{0: 42, 1: ['is']}, {0: null, 1: [42, 'is']}]);
    Test.assert_eq(new Template(pattern, [true, false]).split(value),
                   [{0: 42, 1: ['is']}, {0: null, 1: [42, 'is']}]);
    Test.assert_eq(new Template(pattern, [false, true]).split(value),
                   [{0: 42, 1: ['is']}]);
    Test.assert_eq(new Template(pattern, required(2)).split(value),
                   [{0: 42, 1: ['is']}]);
  },
  split_generates_multiple_hypotheses_for_split_list: () => {
    const pattern = '[...$0, ...$1]';
    const value = [42, 'is']
    Test.assert_eq(new Template(pattern, optional(2)).split(value),
                   [{0: [42, 'is'], 1: null},
                    {0: [42], 1: ['is']},
                    {0: null, 1: [42, 'is']}]);
    Test.assert_eq(new Template(pattern, [true, false]).split(value),
                   [{0: [42], 1: ['is']}, {0: null, 1: [42, 'is']}]);
    Test.assert_eq(new Template(pattern, [false, true]).split(value),
                   [{0: [42, 'is'], 1: null}, {0: [42], 1: ['is']}]);
    Test.assert_eq(new Template(pattern, required(2)).split(value),
                   [{0: [42], 1: ['is']}]);
  },
  split_generates_one_hypothesis_for_list_of_singletons: () => {
    const pattern = '[$0, $1]';
    const xs = [optional(2), [true, false], [false, true], required(2)];
    Test.assert_eq(xs.map((x) => new Template(pattern, x).split([4, 5, 6])),
                   [[], [], [], []]);
    Test.assert_eq(xs.map((x) => new Template(pattern, x).split([4, 5])),
                   [[{0: 4, 1: 5}], [{0: 4, 1: 5}],
                    [{0: 4, 1: 5}], [{0: 4, 1: 5}]]);
    Test.assert_eq(xs.map((x) => new Template(pattern, x).split([4])),
                   [[{0: 4, 1: null}, {0: null, 1: 4}],
                    [{0: null, 1: 4}], [{0: 4, 1: null}], []]);
    Test.assert_eq(xs.map((x) => new Template(pattern, x).split([])),
                   [[{0: null, 1: null}], [], [], []]);
  },
  split_generates_multiple_hypotheses_for_dict_assigned_to_list: () => {
    const pattern = '{num: $0, ...$1}';
    const value = {num: [24, 42]};
    Test.assert_eq(new Template(pattern, optional(2)).split(value),
                   [{0: [24, 42], 1: null},
                    {0: [24], 1: {num: [42]}},
                    {0: null, 1: {num: [24, 42]}}]);
    Test.assert_eq(new Template(pattern, [true, false]).split(value),
                   [{0: [24], 1: {num: [42]}}, {0: null, 1: {num: [24, 42]}}]);
    Test.assert_eq(new Template(pattern, [false, true]).split(value),
                   [{0: [24, 42], 1: null}, {0: [24], 1: {num: [42]}}]);
    Test.assert_eq(new Template(pattern, required(2)).split(value),
                   [{0: [24], 1: {num: [42]}}]);
  },
  split_generates_multiple_hypotheses_for_dict_containing_list: () => {
    const pattern = '{num: [$0], ...$1}';
    const value = {num: [24, 42]};
    Test.assert_eq(new Template(pattern, optional(2)).split(value),
                   [{0: 24, 1: {num: [42]}}, {0: null, 1: {num: [24, 42]}}]);
    Test.assert_eq(new Template(pattern, [true, false]).split(value),
                   [{0: 24, 1: {num: [42]}}, {0: null, 1: {num: [24, 42]}}]);
    Test.assert_eq(new Template(pattern, [false, true]).split(value),
                   [{0: 24, 1: {num: [42]}}]);
    Test.assert_eq(new Template(pattern, required(2)).split(value),
                   [{0: 24, 1: {num: [42]}}]);
  },
  split_fails_on_unmatched_primitive: () => {
    const pattern = '42';
    const template = new Template(pattern);
    Test.assert_eq(template.split(false), []);
  },
  split_fails_on_unmatched_dict_element: () => {
    const pattern = '{num: 42, str: "is", bool: false}';
    const template = new Template(pattern);
    const value = {bool: true, str: 'is', num: 42};
    Test.assert_eq(template.split(value), []);
  },
  split_fails_on_unmatched_list_element: () => {
    const pattern = '[42, "is", false]';
    const template = new Template(pattern);
    const value = [42, 'is', true];
    Test.assert_eq(template.split(value), []);
  },
  split_fails_on_null_required_variable: () => {
    const pattern = '$0';
    const template = new Template(pattern, required(1));
    Test.assert_eq(template.split(null), []);
  },
  split_fails_when_extra_dict_key_is_present: () => {
    const pattern = '{num: $0}';
    const template = new Template(pattern, optional(1));
    Test.assert_eq(template.split({num: 42, str: 'is'}), []);
  },
  split_fails_when_required_dict_key_is_missing: () => {
    const pattern = '{num: $0}';
    Test.assert_eq(new Template(pattern, optional(1)).split({}),
                   [{0: null}]);
    Test.assert_eq(new Template(pattern, required(1)).split({}), []);
  },
  split_fails_without_enough_list_keys: () => {
    const pattern = '[...$0, ...$1, ...$2]';
    const value = [42, 'is']
    Test.assert_eq(new Template(pattern, optional(3)).split(value),
                   [{0: [42, 'is'], 1: null, 2: null},
                    {0: [42], 1: ['is'], 2: null},
                    {0: [42], 1: null, 2: ['is']},
                    {0: null, 1: [42, 'is'], 2: null},
                    {0: null, 1: [42], 2: ['is']},
                    {0: null, 1: null, 2: [42, 'is']}]);
    Test.assert_eq(new Template(pattern, [false, true, true])
                               .split(value),
                   [{0: [42, 'is'], 1: null, 2: null},
                    {0: [42], 1: ['is'], 2: null},
                    {0: [42], 1: null, 2: ['is']}]);
    Test.assert_eq(new Template(pattern, [false, false, true])
                               .split(value),
                   [{0: [42], 1: ['is'], 2: null}]);
    Test.assert_eq(new Template(pattern, required(3)).split(value), []);
  },
  parse_fails_on_unquoted_string_literal: () => {
    Test.assert_error(() => new Template('failed'), 'at line 1, column 1');
  },
  parse_fails_on_malformatted_dict: () => {
    Test.assert_error(() => new Template('{num 42}'), 'at line 1, column 5');
  },
  parse_fails_on_malformatted_list: () => {
    Test.assert_error(() => new Template('["a" "b"]'), 'at line 1, column 6');
  },
  parse_fails_when_variable_is_out_of_bounds: () => {
    const pattern = '$0';
    Test.assert_error(() => new Template(pattern),
                      'Index out of bounds: $0');
  },
  parse_fails_when_variable_is_out_of_bounds_recursively: () => {
    const pattern = '{num: $0}';
    Test.assert_error(() => new Template(pattern),
                      'Index out of bounds: $0');
  },
};

export {template};
