import {Option} from '../../src/lib/base';
import {DAWG} from '../../src/lib/dawg';
import {Test} from '../test';

type Item<V> = [string[], V];

const length = <K, V>(dawg: DAWG<K, V>): number => {
  // Subtract one to account for the initial dummy node in these dawgs.
  return dawg.serialize()[0].length - 1;
};

const serde = <K, V>(dawg: DAWG<K, V>): DAWG<K, V> => {
  const serialized = JSON.stringify(dawg.serialize());
  return DAWG.deserialize(JSON.parse(serialized));
};

const subsets = <T>(values: T[]): T[][] => {
  if (values.length === 0) return [[]];
  const child = subsets(values.slice(1));
  return child.concat(child.map(x => [values[0]].concat(x)));
};

const dawg: Test = {
  all_entries_included: () => {
    const keys = subsets(Array.from('abcde'));
    const dawg = new DAWG(keys.map((x): Item<boolean> => [x, true]));
    keys.forEach(x => Test.assert_eq(dawg.get(x), [true]));
    Test.assert_eq(dawg.entries().length, 32);
    Test.assert_eq(dawg.get('ba'), []);
  },
  all_entries_preserved_by_serialize: () => {
    const keys = subsets(Array.from('abcde'));
    const dawg = new DAWG(keys.map((x): Item<boolean> => [x, true]));
    keys.forEach(x => Test.assert_eq(dawg.get(x), [true]));
    Test.assert_eq(dawg.entries().length, 32);
    Test.assert_eq(dawg.get('ba'), []);
  },
  compression_yields_fewer_nodes: () => {
    const keys = subsets(Array.from('abcde'));
    const base = new DAWG(keys.map((x): Item<boolean> => [x, true]));
    const dawg = serde(base);
    Test.assert_eq(length(base), 6);
    Test.assert_eq(length(dawg), 6);
  },
  compression_handles_varied_keys: () => {
    const keys = subsets(Array.from('abcde'));
    const base = new DAWG(keys.map((x): Item<number> => [x, x.length % 2]));
    const dawg = serde(base);
    Test.assert_eq(length(base), 10);
    Test.assert_eq(length(dawg), 10);
  },
  dynamic_updates_work: () => {
    const old_keys = subsets(Array.from('abcde'));
    const new_keys = subsets(Array.from('abcd'));
    const dawg = new DAWG(old_keys.map((x): Item<boolean> => [x, true]));
    new_keys.forEach(x => Test.assert_eq(dawg.get(x.concat('e')), [true]));
    new_keys.forEach(x => Test.assert_eq(dawg.get(x), [true]));
    Test.assert_eq(dawg.entries().length, 32);
    Test.assert_eq(length(dawg), 6);

    new_keys.map(x => dawg.add(x, false));
    new_keys.forEach(x => Test.assert_eq(dawg.get(x.concat('e')), [true]));
    new_keys.forEach(x => Test.assert_eq(dawg.get(x), [false, true]));
    Test.assert_eq(dawg.entries().length, 48);
    Test.assert_eq(length(dawg), 54);

    dawg.compress();
    new_keys.forEach(x => Test.assert_eq(dawg.get(x.concat('e')), [true]));
    new_keys.forEach(x => Test.assert_eq(dawg.get(x), [false, true]));
    Test.assert_eq(dawg.entries().length, 48);
    Test.assert_eq(length(dawg), 6);
  },
  read_methods_work: () => {
    const keys = subsets(Array.from('abcde'));
    const dawg = new DAWG(keys.map((x): Item<number> => [x, x.length % 2]));
    const entries = keys.sort().map(x => [x, x.length % 2]);
    Test.assert_eq(entries, dawg.entries());
    Test.assert_eq(dawg.entries().length, 32);
  },
};

export {dawg};
