use super::super::lib::base::{HashMap, HashSet};
use super::frequencies::{Bytes, LOG_FREQUENCY, VOWEL_SKIP_LOG_FREQUENCY};
use lib::dawg::Dawg;
use std::str::from_utf8;

// Used to compute a coarse hash key for a given Latin or WX string, such that
// the keysets intersect iff the Latin string could map to that Hindi word.

thread_local! {
  static DROPPED_SUFFIXES: Vec<String> = {
    let pieces: Vec<Bytes> = vec![b"ny", b"zy"];
    let result: HashSet<_> = LOG_FREQUENCY.with(|a| {
      pieces.iter().flat_map(|x| a.get(x).unwrap().1.keys().map(|x| coerce(x).into())).collect()
    });
    result.into_iter().collect()
  };

  static WX_HASH_KEYS: HashMap<Bytes, Vec<String>> = {
    LOG_FREQUENCY.with(|a| a.iter().map(|(k, v)| {
      let set: HashSet<_> = v.1.keys().map(|x| disemvowel(coerce(x))).collect();
      (*k, set.into_iter().collect())
    }).collect())
  };
}

fn coerce(x: Bytes) -> &'static str {
  from_utf8(x).unwrap()
}

fn disemvowel(x: &str) -> String {
  x.replace(|c| "aeiouy".contains(c), "")
}

fn hash_keys_from_latin(latin: &str) -> Vec<String> {
  let mut disemvowelled = disemvowel(latin);
  if disemvowelled.get(0..1) != latin.get(0..1) {
    disemvowelled.insert(0, '*');
  }
  DROPPED_SUFFIXES.with(|a| a.iter().filter_map(|x| try_strip_suffix(&disemvowelled, x)).collect())
}

fn hash_keys_from_wx(wx: &str) -> Vec<String> {
  let options: Vec<_> = WX_HASH_KEYS
    .with(|a| split(wx).into_iter().map(|x| a.get(x).cloned().unwrap_or_default()).collect());
  let vowel = !options.is_empty() && options[0].iter().any(|x| x.is_empty());
  let basis = if vowel { vec!["*".to_string()] } else { vec!["".to_string()] };
  options.into_iter().fold(basis, |a, x| {
    a.into_iter().flat_map(|b| x.iter().map(|y| b.clone() + y).collect::<Vec<_>>()).collect()
  })
}

fn try_strip_suffix(prefix: &str, suffix: &str) -> Option<String> {
  if prefix.ends_with(suffix) {
    Some(prefix[..prefix.len() - suffix.len()].to_string())
  } else {
    None
  }
}

// Used to split a WX string into fragments that appear in the frequency map.

fn check(ch: &[u8]) -> Option<Bytes> {
  LOG_FREQUENCY.with(|a| a.get(ch).map(|x| x.0))
}

fn split(wx: &str) -> Vec<Bytes> {
  let wx = wx.as_bytes();
  let mut prev_vowel = false;
  let mut prev_consonant = false;
  let mut result = Vec::with_capacity(2 * wx.len());
  for (i, byte) in wx.iter().enumerate() {
    let ch = *byte;
    let next_vowel = b"aeiouAEIOU".contains(byte);
    let next_consonant = !next_vowel && !b"zM".contains(byte);
    if ch == b'Z' {
      continue;
    } else if i + 1 < wx.len() && wx[i] == b'Z' {
      check(&wx[i..i + 2]).or_else(|| check(&wx[i..i + 1])).map(|x| result.push(x));
    } else if ch == b'a' && prev_consonant {
      result.push(b"ax");
    } else if ch == b'z' || ch == b'M' {
      result.push(b"nx");
    } else if prev_vowel && next_vowel {
      result.push(b"yx");
      check(&wx[i..i + 1]).map(|x| result.push(x));
    } else {
      check(&wx[i..i + 1]).map(|x| result.push(x));
    }
    prev_vowel = next_vowel;
    prev_consonant = next_consonant;
  }
  if result.is_empty() {
    return vec![b"zy"];
  }
  let last = result.len() - 1;
  if prev_consonant {
    result.push(b"ay");
  } else if result[last] == b"ax" {
    result[last] = b"ay";
    result.push(b"zy");
  } else if result[last] == b"nx" {
    result[last] = b"ny";
  } else {
    result.push(b"zy");
  }
  result
}

// The core transliteration scoring algorithm.

fn viterbi(latin: &str, wx: &str) -> f32 {
  LOG_FREQUENCY.with(move |a| {
    let (latin, parts, row) = (latin.as_bytes(), split(wx), latin.len() + 1);
    let mut memo = vec![std::f32::NEG_INFINITY; row * (parts.len() + 1)];
    memo[0] = 0.0;
    for (i, part) in parts.into_iter().enumerate() {
      if let Some(options) = a.get(&part) {
        for j in 0..row {
          let head = i * row + j;
          if memo[head] == std::f32::NEG_INFINITY {
            continue;
          }
          for (option, score) in options.1.iter() {
            let tail = head + row + option.len();
            if !latin[j..].starts_with(option) || memo[tail] >= memo[head] + score {
              continue;
            }
            memo[tail] = memo[head] + score;
            for k in j + option.len()..latin.len() {
              if !b"aeiou".contains(&latin[k]) {
                break;
              }
              let index = tail + k - j - option.len();
              let score = VOWEL_SKIP_LOG_FREQUENCY.with(|a| memo[index] + *a);
              if memo[index + 1] >= score {
                break;
              }
              memo[index + 1] = score;
            }
          }
        }
      }
    }
    memo[memo.len() - 1]
  })
}

// We wrap the transliteration logic in a simple interface.

struct Transliterator {
  dawg: Dawg<u8, String>,
}

impl Transliterator {
  pub fn new(words: &[&str]) -> Self {
    let mut dawg = Dawg::new(&[]);
    for wx in words {
      for key in hash_keys_from_wx(wx) {
        dawg.add(key.as_bytes(), &wx.to_string());
      }
    }
    Self { dawg: dawg.compress() }
  }

  pub fn transliterate(&self, latin: &str) -> Vec<String> {
    let latin = latin.to_lowercase();
    let mut scores = HashMap::default();
    for key in hash_keys_from_latin(&latin) {
      for wx in self.dawg.get(key.as_bytes()) {
        scores.entry(wx.clone()).or_insert_with(|| viterbi(&latin, &wx));
      }
    }
    let mut scores: Vec<_> = scores.into_iter().filter(|x| x.1 > std::f32::NEG_INFINITY).collect();
    scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scores.into_iter().map(|x| x.0).collect()
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use test::Bencher;

  fn check(actual: Vec<String>, expected: &[&str]) {
    assert_eq!(actual, expected.iter().map(|x| x.to_string()).collect::<Vec<_>>());
  }

  #[test]
  fn empty_list_returned_without_transliterations() {
    let t = Transliterator::new(&"hE hEM ho hUz".split(' ').collect::<Vec<_>>());
    check(t.transliterate("main"), &[]);
  }

  #[test]
  fn mismatched_consonant_values_filtered() {
    let t = Transliterator::new(&"tA wA dZA".split(' ').collect::<Vec<_>>());
    check(t.transliterate("tha"), &["wA", "tA"]);
  }

  #[test]
  fn mismatched_initial_vowels_filtered() {
    let t = Transliterator::new(&"aBI BI".split(' ').collect::<Vec<_>>());
    check(t.transliterate("abhi"), &["aBI"]);
  }

  #[test]
  fn transliterations_ranked_correctly() {
    let t = Transliterator::new(&"hE hEM ho hUz".split(' ').collect::<Vec<_>>());
    check(t.transliterate("hain".trim()), &["hEM", "hE", "hUz", "ho"]);
    check(t.transliterate("hai ".trim()), &["hE", "hEM", "ho", "hUz"]);
    check(t.transliterate("ho  ".trim()), &["ho", "hE", "hEM", "hUz"]);
    check(t.transliterate("hoon".trim()), &["hUz", "ho", "hEM", "hE"]);
    check(t.transliterate("hu  ".trim()), &["hUz", "ho", "hE", "hEM"]);
  }

  #[test]
  fn transliteration_allows_vowel_skips() {
    let t = Transliterator::new(&"khaUnga king".split(' ').collect::<Vec<_>>());
    check(t.transliterate("khunga"), &["khaUnga", "king"]);
  }

  #[test]
  fn transliteration_allows_y_between_vowels() {
    let t = Transliterator::new(&"leenge leyenge".split(' ').collect::<Vec<_>>());
    check(t.transliterate("leenge ".trim()), &["leenge"]);
    check(t.transliterate("leyenge".trim()), &["leyenge", "leenge"]);
  }

  #[bench]
  fn transliteration_benchmark(b: &mut Bencher) {
    let t = Transliterator::new(&"cAhIe cAhe cAhI cAh Cah cAhA".split(' ').collect::<Vec<_>>());
    b.iter(|| t.transliterate("chahie"));
  }
}
