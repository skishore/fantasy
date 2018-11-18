import {assert} from '../lib/base';

// WX is a transliteration format developed at IIT Kanpur. The main advantages
// of using this format are that all of its transliteration results are single
// alphabetic characters. We first prepare some transliteration dictionaries.

interface Dict {
  [index: string]: string;
}

const EXTRA = 'अंअःअँअ़'.replace(/.(.)/g, '$1');
const HINDI = 'अआइईउऊएऐओऔकखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसहऋॠऌ' + EXTRA;
const LATIN = 'aAiIuUeEoOkKgGfcCjJFtTdDNwWxXnpPbBmyrlvSRshqQL' + 'MHzZ';

const build_dict = (keys: string, values: string): Dict => {
  const result: Dict = {};
  assert(keys.length === values.length);
  Array.from(keys).forEach((x, i) => (result[x] = values[i]));
  return result;
};

const reverse_dict = (dict: Dict): Dict => {
  const result: Dict = {};
  Object.keys(dict).forEach(x => (result[dict[x]] = x));
  assert(Object.keys(dict).length === Object.keys(result).length);
  return result;
};

const HINDI_TO_WX = build_dict(HINDI, LATIN);
const WX_TO_HINDI = reverse_dict(HINDI_TO_WX);

const NUKTA_TO_CHAR = build_dict('कखगजडढफ', 'क़ख़ग़ज़ड़ढ़फ़');
const CHAR_TO_NUKTA = reverse_dict(NUKTA_TO_CHAR);

const VOWEL_TO_CHAR = build_dict('आइईउऊऋऌऍएऐऑओऔॠॡ', 'ािीुूृॢॆेैॊोौॄॣ');
Array.from(EXTRA.slice(0, -1)).forEach(x => (VOWEL_TO_CHAR[x] = x));
/* tslint:disable-next-line:no-string-literal */
VOWEL_TO_CHAR['अ'] = '';
const CHAR_TO_VOWEL = reverse_dict(VOWEL_TO_CHAR);

// Some basic helpers for recognizing classes of WX-encoded characters.

const CONSONANT_I = LATIN.indexOf('k');
const CONSONANT_J = LATIN.indexOf('q');

const is_bindu = (ch: string): boolean => ch === 'M' || ch === 'z';

const is_consonant = (ch: string): boolean => {
  const index = LATIN.indexOf(ch);
  return CONSONANT_I <= index && index < CONSONANT_J;
};

const is_vowel = (ch: string): boolean => {
  const index = LATIN.indexOf(ch);
  return 0 <= index && index < CONSONANT_I;
};

// Now we implement the logic for transliteration from Hindi to WX and back.

const hindi_to_wx = (hindi: string): string => {
  const result: string[] = [];
  const characters = Array.from(hindi);
  const vowels = characters.map(x => VOWEL_TO_CHAR.hasOwnProperty(x));
  const vowel_signs = characters.map(x => CHAR_TO_VOWEL.hasOwnProperty(x));
  const consonants = vowels.map(
    (x, i) => !(x || vowel_signs[i] || characters[i] === '\u094d'),
  );
  characters.forEach((x, i) => {
    if (x === '\u094d') return assert(consonants[i - 1]);
    if (consonants[i - 1] && (consonants[i] || vowels[i])) result.push('a');
    const wx = HINDI_TO_WX[CHAR_TO_NUKTA[x] || CHAR_TO_VOWEL[x] || x];
    assert(!!wx, () => `Invalid Hindi: ${hindi}`);
    result.push(wx);
    if (CHAR_TO_NUKTA[x]) result.push('Z');
  });
  return result.join('');
};

const wx_to_hindi = (wx: string): string => {
  const characters = Array.from(wx).map(x => WX_TO_HINDI[x]);
  assert(characters.every(x => !!x), () => `Invalid WX: ${wx}`);
  const vowels = characters.map(x => VOWEL_TO_CHAR.hasOwnProperty(x));
  const result: string[] = [];
  characters.forEach((x, i) => {
    const previous_was_consonant = i > 0 && !vowels[i - 1];
    if (x === '\u093c') {
      const previous = result.pop();
      if (!previous) throw Error(`Invalid nukta: ${wx}`);
      result.push(NUKTA_TO_CHAR[previous] || previous);
    } else if (previous_was_consonant && vowels[i]) {
      result.push(VOWEL_TO_CHAR[x]);
    } else if (previous_was_consonant && !vowels[i]) {
      result.push('\u094d');
      result.push(x);
    } else {
      result.push(x);
    }
  });
  return result.join('');
};

export {hindi_to_wx, is_bindu, is_consonant, is_vowel, wx_to_hindi};
