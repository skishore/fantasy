import {Template as BT} from '../../src/template/base';
import {Template} from '../../src/template/value';
import {Test} from '../test';

const reindex_trial = (input: string) => {
  const slots = [
    {index: 3, optional: false},
    {index: 4, optional: false},
    {index: 5, optional: true},
  ];
  const template = BT.reindex(slots, Template.parse(input));
  Test.assert_eq(template.merge(['a', ['b', 'c'], null]), null);
  Test.assert_eq(template.merge([null, null, null, 'a', ['b', 'c']]), [
    'a',
    'b',
    'c',
  ]);
  Test.assert_eq(template.split(['a', 'b', 'c']), [
    {3: 'a', 4: ['b'], 5: ['c']},
    {3: 'a', 4: ['b', 'c'], 5: null},
  ]);
  Test.assert_eq(template.split(['a', 'b']), [{3: 'a', 4: ['b'], 5: null}]);
  Test.assert_eq(template.split(['a']), []);
  Test.assert_eq(template.split(null), []);
  Test.assert_eq(template.split([]), []);
};

const base: Test = {
  reindex_works: () => reindex_trial('[$0, ...$1, ...$2]'),
  reindex_ignores_extra_slots: () => reindex_trial('[$0, ...$1, ...$2, ...$3]'),
};

export {base};
