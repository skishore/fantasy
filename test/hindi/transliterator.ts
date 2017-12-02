import {Transliterator} from '../../src/hindi/transliterator';
import {Test} from '../test';

const transliterator: Test = {
  empty_list_returned_without_transliterations: () => {
    const transliterator = new Transliterator('hE hEM ho hUz'.split(' '));
    Test.assert_eq(transliterator.transliterate('main'), []);
  },
  mismatched_consonant_values_filtered: () => {
    const transliterator = new Transliterator('tA wA dZA'.split(' '));
    Test.assert_eq(transliterator.transliterate('tha'), ['wA', 'tA']);
  },
  mismatched_initial_vowels_filtered: () => {
    const transliterator = new Transliterator('aBI BI'.split(' '));
    Test.assert_eq(transliterator.transliterate('abhi'), ['aBI']);
  },
  transliterations_ranked_correctly: () => {
    const transliterator = new Transliterator('hE hEM ho hUz'.split(' '));
    Test.assert_eq(transliterator.transliterate('hain'),
                   ['hEM', 'hE', 'ho', 'hUz']);
    Test.assert_eq(transliterator.transliterate('hai'),
                   ['hE', 'hEM', 'hUz', 'ho']);
    Test.assert_eq(transliterator.transliterate('ho'),
                   ['ho', 'hE', 'hEM', 'hUz']);
    Test.assert_eq(transliterator.transliterate('hoon'),
                   ['hUz', 'hE', 'hEM', 'ho']);
    Test.assert_eq(transliterator.transliterate('hu'),
                   ['hUz', 'ho', 'hE', 'hEM']);
  },
};

export {transliterator};
