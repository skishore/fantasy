use super::super::lib::base::HashMap;
use super::super::lib::base::Result;

// WX is a transliteration format developed at IIT Kanpur. The main advantages
// of using this format are that all of its transliteration results are single
// alphabetic characters. We first prepare some transliteration dictionaries.

type Dict = HashMap<char, char>;

static EXTRA: &'static str = "\u{902}\u{903}\u{901}\u{93c}";
static HINDI: &'static str = "अआइईउऊएऐओऔकखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसहऋॠऌ\u{902}\u{903}\u{901}\u{93c}";
static LATIN: &'static str = "aAiIuUeEoOkKgGfcCjJFtTdDNwWxXnpPbBmyrlvSRshqQLMHzZ";

static NUKTA: char = '\u{93c}';
static SCHWA: char = '\u{905}';
static VIRAMA: char = '\u{94d}';

thread_local! {
  static HINDI_TO_WX: Dict = make_dict(HINDI, LATIN);
  static WX_TO_HINDI: Dict = HINDI_TO_WX.with(|x| flip_dict(x));

  static NUKTA_TO_CHAR: Dict = make_dict("कखगजडढफ", "क़ख़ग़ज़ड़ढ़फ़");
  static CHAR_TO_NUKTA: Dict = NUKTA_TO_CHAR.with(|x| flip_dict(x));

  static VOWEL_TO_CHAR: Dict = {
    let mut base = make_dict("आइईउऊऋऌऍएऐऑओऔॠॡ", "\u{93e}\u{93f}\u{940}\u{941}\u{942}\u{943}\u{962}\u{946}\u{947}\u{948}\u{94a}\u{94b}\u{94c}\u{944}\u{963}");
    EXTRA.chars().for_each(|y| std::mem::drop(base.insert(y, y)));
    base.remove(&NUKTA);
    base
  };
  static CHAR_TO_VOWEL: Dict = VOWEL_TO_CHAR.with(|x| flip_dict(x));
}

fn flip_dict(dict: &Dict) -> Dict {
  let mut result = HashMap::default();
  dict.iter().for_each(|(k, v)| std::mem::drop(result.insert(v.clone(), k.clone())));
  result
}

fn make_dict(keys: &str, values: &str) -> Dict {
  assert_eq!(keys.chars().count(), values.chars().count());
  let mut result = HashMap::default();
  keys.chars().zip(values.chars()).for_each(|(k, v)| std::mem::drop(result.insert(k, v)));
  result
}

// Some simple helpers used for transliteration.

pub fn is_consonant(ch: char) -> bool {
  !(ch == VIRAMA || is_vowel(ch) || CHAR_TO_VOWEL.with(|x| x.contains_key(&ch)))
}

pub fn is_vowel(ch: char) -> bool {
  ch == SCHWA || VOWEL_TO_CHAR.with(|x| x.contains_key(&ch))
}

// Now we implement the logic for transliteration from Hindi to WX and back.

pub fn hindi_to_wx(hindi: &str) -> Result<String> {
  let mut prev_consonant = false;
  let mut result = String::with_capacity(2 * hindi.len());
  hindi.chars().try_for_each(|x| {
    let next_consonant = is_consonant(x);
    if x == VIRAMA {
      let success = prev_consonant;
      prev_consonant = next_consonant;
      return if success { Ok(()) } else { Err(format!("Invalid Hindi: {}", hindi)) };
    }
    if prev_consonant && (next_consonant || is_vowel(x)) {
      result.push('a');
    }
    let nukta = CHAR_TO_NUKTA.with(|a| a.get(&x).cloned());
    let vowel = nukta.or_else(|| CHAR_TO_VOWEL.with(|a| a.get(&x).cloned()));
    let wx = HINDI_TO_WX.with(|a| a.get(&vowel.unwrap_or(x)).cloned());
    result.push(wx.ok_or_else(|| format!("Invalid Hindi: {}", hindi))?);
    if nukta.is_some() {
      result.push('Z');
    }
    prev_consonant = next_consonant;
    Ok(())
  })?;
  Ok(result)
}

pub fn wx_to_hindi(wx: &str) -> Result<String> {
  let mut prev_consonant = false;
  let mut result = String::with_capacity(2 * wx.len());
  wx.chars().try_for_each(|x| -> Result<()> {
    let hi = WX_TO_HINDI.with(|a| a.get(&x).cloned());
    let hi = hi.ok_or_else(|| format!("Invalid WX: {}", wx))?;
    let next_consonant = is_consonant(hi);
    if hi == NUKTA {
      let previous = result.pop().ok_or_else(|| format!("Invalid WX: {}", wx))?;
      result.push(NUKTA_TO_CHAR.with(|a| a.get(&previous).cloned().unwrap_or(previous)));
    } else if prev_consonant {
      if let Some(y) = VOWEL_TO_CHAR.with(|a| a.get(&hi).cloned()) {
        result.push(y);
      } else if next_consonant {
        result.extend(&[VIRAMA, hi]);
      }
    } else {
      result.push(hi);
    }
    prev_consonant = next_consonant;
    Ok(())
  })?;
  Ok(result)
}

#[cfg(test)]
mod tests {
  use super::*;

  thread_local! {
    static ITEMS: Vec<[&'static str; 2]> = vec![
      ["apane", "अपने"],
      ["badZe", "बड़े"],
      ["evaM", "एवं"],
      ["ladZakiyoM", "लड़कियों"],
      ["miSr", "मिश्र"],
      ["nahIM", "नहीं"],
      ["pAMc", "पांच"],
    ];
  }

  #[test]
  fn test_hindi_to_wx() {
    ITEMS.with(|a| a.iter().for_each(|x| assert_eq!(hindi_to_wx(x[1]).unwrap(), x[0].to_string())));
  }

  #[test]
  fn test_wx_to_hindi() {
    ITEMS.with(|a| a.iter().for_each(|x| assert_eq!(wx_to_hindi(x[0]).unwrap(), x[1].to_string())));
  }
}
