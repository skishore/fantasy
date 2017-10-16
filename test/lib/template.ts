import {Template} from '../../src/lib/template';
import {Test} from '../test';

const optional = (n: number) => Array(n).fill(true);
const required = (n: number) => Array(n).fill(false);

const template: Test = {
  apply_realizes_boolean: () => {
    const template = new Template('false');
    Test.assert_eq(template.apply([]), false);
  },
  apply_realizes_number: () => {
    const template = new Template('42');
    Test.assert_eq(template.apply([]), 42);
  },
  apply_realizes_string: () => {
    const template = new Template('"is"');
    Test.assert_eq(template.apply([]), 'is');
  },
  apply_realizes_dict: () => {
    const pattern = '{num: 42, str: "is", bool: false}';
    const template = new Template(pattern);
    Test.assert_eq(template.apply([]), {bool: false, num: 42, str: 'is'});
  },
  apply_realizes_list: () => {
    const pattern = '[42, "is", false]';
    const template = new Template(pattern);
    Test.assert_eq(template.apply([]), [42, 'is', false]);
  },
  apply_realizes_merged_dicts: () => {
    const pattern = '({num: 42}, {str: "is", bool: false})';
    const template = new Template(pattern);
    Test.assert_eq(template.apply([]), {bool: false, num: 42, str: 'is'});
  },
  apply_realizes_merged_lists: () => {
    const pattern = '([42], ["is", false])'
    const template = new Template(pattern);
    Test.assert_eq(template.apply([]), [42, 'is', false]);
  },
  apply_performs_substitution: () => {
    const [noun, verb] = ['dog', {concept: 'is', tense: 'present'}];
    const template = new Template('{noun: $0, verb: $1}', optional(2));
    Test.assert_eq(template.apply([noun, verb]), {noun, verb});
  },
  apply_merges_dicts_and_variables: () => {
    const [noun, verb] = ['dog', {concept: 'is', tense: 'present'}];
    const template = new Template('({noun: $0}, $1)', optional(2));
    Test.assert_eq(template.apply([noun, verb]),
                   {concept: 'is', noun: 'dog', tense: 'present'});
  },
  apply_merges_lists_and_variables: () => {
    const template = new Template('([$0], $1)', optional(2));
    Test.assert_eq(template.apply(['a', ['b', 'c']]), ['a', 'b', 'c']);
  },
  apply_merges_variables_and_dicts: () => {
    const [noun, verb] = [{concept: 'dog', plural: false}, 'is'];
    const template = new Template('($0, {verb: $1})', optional(2));
    Test.assert_eq(template.apply([noun, verb]),
                   {concept: 'dog', plural: false, verb: 'is'});
  },
  apply_merges_variables_and_lists: () => {
    const template = new Template('($0, [$1])', optional(2));
    Test.assert_eq(template.apply([['a', 'b'], 'c']), ['a', 'b', 'c']);
  },
  apply_concatenates_repeated_list_key: () => {
    const pattern = '({noun: ["dog"]}, {noun: ["cat"]})';
    const template = new Template(pattern);
    Test.assert_eq(template.apply([]), {noun: ['dog', 'cat']});
  },
  apply_overwrites_repeated_singular_key: () => {
    const pattern = '({noun: "dog"}, {noun: "cat"})';
    const template = new Template(pattern);
    Test.assert_eq(template.apply([]), {noun: 'cat'});
  },
  apply_drops_unset_variable_in_dict: () => {
    const pattern = '{num: $0, str: $1, bool: $2}';
    const template = new Template(pattern, optional(3));
    Test.assert_eq(template.apply([42, null, false]), {bool: false, num: 42});
  },
  apply_drops_unset_variable_in_list: () => {
    const pattern = '([$0], $1)';
    const template = new Template(pattern, optional(2));
    Test.assert_eq(template.apply(['a', null]), ['a']);
  },
  apply_drops_unset_variable_outside_list: () => {
    const pattern = '([$0], $1)';
    const template = new Template(pattern, optional(2));
    Test.assert_eq(template.apply([null, ['b', 'c']]), ['b', 'c']);
  },
  apply_returns_none_when_all_dict_elements_are_empty: () => {
    const pattern = '{num: $0, str: $1, bool: $2}';
    const template = new Template(pattern, optional(3));
    Test.assert_eq(template.apply([null, null, null]), null);
  },
  apply_returns_none_when_all_list_elements_are_empty: () => {
    const pattern = '([$0], $1)';
    const template = new Template(pattern, optional(2));
    Test.assert_eq(template.apply([null, null]), null);
  },
  apply_fails_on_list_key_followed_by_singleton: () => {
    const pattern = '({noun: ["dog"]}, {noun: "cat"})'
    const template = new Template(pattern);
    Test.assert_error(() => template.apply([]),
                      'singleton cannot merge with list.');
  },
  apply_fails_on_singleton_key_followed_by_list: () => {
    const pattern = '({noun: "dog"}, {noun: ["cat"]})'
    const template = new Template(pattern);
    Test.assert_error(() => template.apply([]),
                      'list cannot merge with singleton.');
  },
  apply_fails_on_merging_dict_and_list: () => {
    const pattern = '($0, $1)';
    const template = new Template(pattern, optional(2));
    Test.assert_error(() => template.apply([{num: 42}, ['is']]),
                      'Failed to merge dict and list.');
  },
  apply_fails_on_wrong_number_of_subs: () => {
    const pattern = 'false';
    const template = new Template(pattern);
    Test.assert_error(() => template.apply(['extra']),
                      'Expected: 0 subs; got: 1');
  },
  apply_fails_when_variable_resolves_to_primitive: () => {
    const pattern = '($0, $1)';
    const template = new Template(pattern, optional(2));
    Test.assert_error(() => template.apply([{num: 42}, 'is']),
                      'Failed to merge variable: "is"');
  },
  generate_returns_trivial_assignment_for_boolean: () => {
    const pattern = 'false';
    const template = new Template(pattern);
    Test.assert_eq(template.generate(false), [{}]);
  },
  generate_returns_trivial_assignment_for_number: () => {
    const pattern = '42';
    const template = new Template(pattern);
    Test.assert_eq(template.generate(42), [{}]);
  },
  generate_assigns_value_to_variable: () => {
    const pattern = '$0';
    const template = new Template(pattern, optional(1));
    Test.assert_eq(template.generate(42), [{0: 42}]);
  },
  generate_assigns_none_to_null_optional_variable: () => {
    const pattern = '$0';
    const template = new Template(pattern, optional(1));
    Test.assert_eq(template.generate(null), [{0: null}]);
  },
  generate_leaves_unassigned_variable_free: () => {
    const pattern = '42';
    const template = new Template(pattern, optional(1));
    Test.assert_eq(template.generate(42), [{}]);
  },
  generate_returns_trivial_assignment_for_dict: () => {
    const pattern = '{num: 42, str: "is", bool: false}';
    const template = new Template(pattern);
    const value = {bool: false, str: 'is', num: 42};
    Test.assert_eq(template.generate(value), [{}]);
  },
  generate_returns_trivial_assignment_for_list: () => {
    const pattern = '[42, "is", false]';
    const template = new Template(pattern);
    const value = [42, 'is', false];
    Test.assert_eq(template.generate(value), [{}]);
  },
  generate_assigns_to_key_value_pair: () => {
    const pattern = '{num: $0}';
    const template = new Template(pattern, optional(1));
    Test.assert_eq(template.generate({num: 42}), [{0: 42}]);
  },
  generate_assigns_to_nested_key_value_pair: () => {
    const pattern = '{measure: ({count: $0}, $1)}';
    const template = new Template(pattern, [false, true]);
    const value = {measure: {count: 0, unit: 'piece'}};
    Test.assert_eq(template.generate(value), [{0: 0, 1: {unit: 'piece'}}]);
  },
  generate_assigns_to_variables_within_dict: () => {
    const pattern = '{num: $0, str: $2, bool: $4}';
    const template = new Template(pattern, optional(5));
    const value = {bool: false, num: 42};
    Test.assert_eq(template.generate(value), [{0: 42, 2: null, 4: false}]);
  },
  generate_assigns_to_variables_within_list: () => {
    const pattern = '[$0, $2, $4]';
    const template = new Template(pattern, optional(5));
    const value = [42, false];
    Test.assert_eq(template.generate(value),
                   [{0: 42, 2: false, 4: null},
                    {0: 42, 2: null, 4: false},
                    {0: null, 2: 42, 4: false}]);
  },
  generate_generates_multiple_hypotheses_for_dict_and_variable: () => {
    const pattern = '({num: $0}, $1)';
    const value = {num: 42, str: 'is'};
    Test.assert_eq(new Template(pattern, optional(2)).generate(value),
                   [{0: 42, 1: {str: 'is'}},
                    {0: null, 1: {num: 42, str: 'is'}}]);
    Test.assert_eq(new Template(pattern, [true, false]).generate(value),
                   [{0: 42, 1: {str: 'is'}},
                    {0: null, 1: {num: 42, str: 'is'}}]);
    Test.assert_eq(new Template(pattern, [false, true]).generate(value),
                   [{0: 42, 1: {str: 'is'}}]);
    Test.assert_eq(new Template(pattern, required(2)).generate(value),
                   [{0: 42, 1: {str: 'is'}}]);
  },
  generate_generates_multiple_hypotheses_for_list_and_variable: () => {
    const pattern = '([$0], $1)';
    const value = [42, 'is']
    Test.assert_eq(new Template(pattern, optional(2)).generate(value),
                   [{0: 42, 1: ['is']},
                    {0: null, 1: [42, 'is']}]);
    Test.assert_eq(new Template(pattern, [true, false]).generate(value),
                   [{0: 42, 1: ['is']},
                    {0: null, 1: [42, 'is']}]);
    Test.assert_eq(new Template(pattern, [false, true]).generate(value),
                   [{0: 42, 1: ['is']}]);
    Test.assert_eq(new Template(pattern, required(2)).generate(value),
                   [{0: 42, 1: ['is']}]);
  },
  generate_generates_multiple_hypotheses_for_split_list: () => {
    const pattern = '($0, $1)';
    const value = [42, 'is']
    Test.assert_eq(new Template(pattern, optional(2)).generate(value),
                   [{0: [42, 'is'], 1: null},
                    {0: [42], 1: ['is']},
                    {0: null, 1: [42, 'is']}]);
    Test.assert_eq(new Template(pattern, [true, false]).generate(value),
                   [{0: [42], 1: ['is']},
                    {0: null, 1: [42, 'is']}]);
    Test.assert_eq(new Template(pattern, [false, true]).generate(value),
                   [{0: [42, 'is'], 1: null},
                    {0: [42], 1: ['is']}]);
    Test.assert_eq(new Template(pattern, required(2)).generate(value),
                   [{0: [42], 1: ['is']}]);
  },
  generate_generates_one_hypothesis_for_list_of_singletons: () => {
    const pattern = '[$0, $1]';
    const value = [42, 'is']
    Test.assert_eq(new Template(pattern, optional(2)).generate(value),
                   [{0: 42, 1: 'is'}]);
    Test.assert_eq(new Template(pattern, [true, false]).generate(value),
                   [{0: 42, 1: 'is'}]);
    Test.assert_eq(new Template(pattern, [false, true]).generate(value),
                   [{0: 42, 1: 'is'}]);
    Test.assert_eq(new Template(pattern, required(2)).generate(value),
                   [{0: 42, 1: 'is'}]);
  },
  generate_generates_multiple_hypotheses_for_dict_assigned_to_list: () => {
    const pattern = '({num: $0}, $1)';
    const value = {num: [24, 42]};
    Test.assert_eq(new Template(pattern, optional(2)).generate(value),
                   [{0: [24, 42], 1: null},
                    {0: [24], 1: {num: [42]}},
                    {0: null, 1: {num: [24, 42]}}]);
    Test.assert_eq(new Template(pattern, [true, false]).generate(value),
                   [{0: [24], 1: {num: [42]}}, {0: null, 1: {num: [24, 42]}}]);
    Test.assert_eq(new Template(pattern, [false, true]).generate(value),
                   [{0: [24, 42], 1: null}, {0: [24], 1: {num: [42]}}]);
    Test.assert_eq(new Template(pattern, required(2)).generate(value),
                   [{0: [24], 1: {num: [42]}}]);
  },
  generate_generates_multiple_hypotheses_for_dict_containing_list: () => {
    const pattern = '({num: [$0]}, $1)';
    const value = {num: [24, 42]};
    Test.assert_eq(new Template(pattern, optional(2)).generate(value),
                   [{0: 24, 1: {num: [42]}}, {0: null, 1: {num: [24, 42]}}]);
    Test.assert_eq(new Template(pattern, [true, false]).generate(value),
                   [{0: 24, 1: {num: [42]}}, {0: null, 1: {num: [24, 42]}}]);
    Test.assert_eq(new Template(pattern, [false, true]).generate(value),
                   [{0: 24, 1: {num: [42]}}]);
    Test.assert_eq(new Template(pattern, required(2)).generate(value),
                   [{0: 24, 1: {num: [42]}}]);
  },
  generate_fails_on_unmatched_primitive: () => {
    const pattern = '42';
    const template = new Template(pattern);
    Test.assert_eq(template.generate(false), []);
  },
  generate_fails_on_unmatched_dict_element: () => {
    const pattern = '{num: 42, str: "is", bool: false}';
    const template = new Template(pattern);
    const value = {bool: true, str: 'is', num: 42};
    Test.assert_eq(template.generate(value), []);
  },
  generate_fails_on_unmatched_list_element: () => {
    const pattern = '[42, "is", false]';
    const template = new Template(pattern);
    const value = [42, 'is', true];
    Test.assert_eq(template.generate(value), []);
  },
  generate_fails_on_null_required_variable: () => {
    const pattern = '$0';
    const template = new Template(pattern, required(1));
    Test.assert_eq(template.generate(null), []);
  },
  generate_fails_when_extra_dict_key_is_present: () => {
    const pattern = '{num: $0}';
    const template = new Template(pattern, optional(1));
    Test.assert_eq(template.generate({num: 42, str: 'is'}), []);
  },
  generate_fails_when_required_dict_key_is_missing: () => {
    const pattern = '{num: $0}';
    Test.assert_eq(new Template(pattern, optional(1)).generate({}),
                   [{0: null}]);
    Test.assert_eq(new Template(pattern, required(1)).generate({}), []);
  },
  generate_fails_without_enough_list_keys: () => {
    const pattern = '($0, $1, $2)';
    const value = [42, 'is']
    Test.assert_eq(new Template(pattern, optional(3)).generate(value),
                   [{0: [42, 'is'], 1: null, 2: null},
                    {0: [42], 1: ['is'], 2: null},
                    {0: [42], 1: null, 2: ['is']},
                    {0: null, 1: [42, 'is'], 2: null},
                    {0: null, 1: [42], 2: ['is']},
                    {0: null, 1: null, 2: [42, 'is']}]);
    Test.assert_eq(new Template(pattern, [false, true, true])
                               .generate(value),
                   [{0: [42, 'is'], 1: null, 2: null},
                    {0: [42], 1: ['is'], 2: null},
                    {0: [42], 1: null, 2: ['is']}]);
    Test.assert_eq(new Template(pattern, [false, false, true])
                               .generate(value),
                   [{0: [42], 1: ['is'], 2: null}]);
    Test.assert_eq(new Template(pattern, required(3)).generate(value), []);
  },
  parse_fails_on_unquoted_string_literal: () => {
    Test.assert_error(() => new Template('failed'), 'at line 1, column 1');
  },
  parse_fails_on_malformatted_dict: () => {
    Test.assert_error(() => new Template('{num 42}'), 'at line 1, column 6');
  },
  parse_fails_on_malformatted_list: () => {
    Test.assert_error(() => new Template('["a" "b"]'), 'at line 1, column 6');
  },
  parse_fails_on_merge_with_primitive: () => {
    Test.assert_error(() => new Template('($0, false, $1)', optional(2)),
                      'at line 1, column 6');
  },
  parse_fails_on_mixed_dict_and_list_keys: () => {
    const pattern = '({num: 42}, ["is"])';
    Test.assert_error(() => new Template(pattern), 'at line 1, column 13');
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
