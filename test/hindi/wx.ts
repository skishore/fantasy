import {hindi_to_wx, wx_to_hindi} from '../../src/hindi/wx';
import {Test} from '../test';

const ITEMS: [string, string][] = [
  ['apane', 'अपने'],
  ['badZe', 'बड़े'],
  ['evaM', 'एवं'],
  ['ladZakiyoM', 'लड़कियों'],
  ['miSr', 'मिश्र'],
  ['nahIM', 'नहीं'],
  ['pAMc', 'पांच'],
];

const wx: Test = {
  test_hindi_to_wx: () => {
    ITEMS.forEach(([wx, hindi]) => Test.assert_eq(hindi_to_wx(hindi), wx));
  },
  test_wx_to_hindi: () => {
    ITEMS.forEach(([wx, hindi]) => Test.assert_eq(wx_to_hindi(wx), hindi));
  },
};

export {wx};
