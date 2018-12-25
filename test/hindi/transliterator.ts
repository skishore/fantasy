import {Transliterator} from '../../src/hindi/transliterator';
import {Test} from '../test';

const transliterator: Test = {
  empty_list_returned_without_transliterations: () => {
    const t = new Transliterator('hE hEM ho hUz'.split(' '));
    Test.assert_eq(t.transliterate('main'), []);
  },
  mismatched_consonant_values_filtered: () => {
    const t = new Transliterator('tA wA dZA'.split(' '));
    Test.assert_eq(t.transliterate('tha'), ['wA', 'tA']);
  },
  mismatched_initial_vowels_filtered: () => {
    const t = new Transliterator('aBI BI'.split(' '));
    Test.assert_eq(t.transliterate('abhi'), ['aBI']);
  },
  transliterations_ranked_correctly: () => {
    const t = new Transliterator('hE hEM ho hUz'.split(' '));
    Test.assert_eq(t.transliterate('hain'), ['hEM', 'hE', 'hUz', 'ho']);
    Test.assert_eq(t.transliterate('hai'), ['hE', 'hEM', 'ho', 'hUz']);
    Test.assert_eq(t.transliterate('ho'), ['ho', 'hE', 'hEM', 'hUz']);
    Test.assert_eq(t.transliterate('hoon'), ['hUz', 'ho', 'hEM', 'hE']);
    Test.assert_eq(t.transliterate('hu'), ['hUz', 'ho', 'hE', 'hEM']);
  },
  transliterator_allows_vowel_skips: () => {
    const t = new Transliterator('khaUnga king'.split(' '));
    Test.assert_eq(t.transliterate('khunga'), ['khaUnga', 'king']);
  },
};

export {transliterator};
