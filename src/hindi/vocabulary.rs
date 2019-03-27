use super::super::lib::base::{HashMap, Result};
use super::super::nlu::base::Tense;
use super::wx::wx_to_hindi;

pub struct Entry {
  pub head: String,
  pub hindi: String,
  pub latin: String,
  pub scores: HashMap<String, f32>,
  pub tenses: Vec<Tense>,
  pub value: String,
}

thread_local! {
  static CATEGORIES: Vec<(&'static str, Vec<(u8, &'static str)>)> = vec![
    ("count", vec![(b'p', "plural"), (b's', "singular")]),
    ("gender", vec![(b'f', "female"), (b'm', "male")]),
    ("person", vec![(b'1', "first"), (b'2', "second"), (b'3', "third")]),
    ("time", vec![(b'<', "past"), (b'=', "present"), (b'>', "future")]),
    ("tone", vec![(b'c', "casual"), (b'f', "formal"), (b'i', "intimate")]),
  ];
}

// Some helpers. Call rollup to construct a list of related vocabulary entries. Call tense
// to build a Tense object with interned (statically-allocated) string keys and values.

struct Case {
  hindi: String,
  latin: String,
  tense: Tense,
}

fn rollup(cases: &[Case], class: &str, value: &str) -> Vec<Entry> {
  assert!(!cases.is_empty());
  let head = format!("{}-{}", class, cases[0].hindi);
  let mut result: Vec<Entry> = vec![];

  for case in cases {
    if result.iter().any(|x| x.hindi == case.hindi) {
      continue;
    }
    let (hindi, latin) = (case.hindi.clone(), case.latin.clone());
    let scores = std::iter::once((format!("%{}", class), 0.0))
      .chain(cases.iter().map(|x| (x.latin.clone(), if x.hindi == hindi { 0.0 } else { -1.0 })))
      .collect();
    let tenses = cases.iter().filter(|x| x.hindi == hindi).map(|x| x.tense.clone()).collect();
    result.push(Entry { head: head.clone(), hindi, latin, scores, tenses, value: value.into() });
  }
  result
}

fn split(word: &str) -> Result<(String, String)> {
  let index = word.find('/').ok_or_else(|| format!("Invalid word (missing slash): {}", word))?;
  let (hindi, latin) = word.split_at(index);
  wx_to_hindi(hindi)?;
  Ok((hindi.to_string(), latin.to_string()))
}

fn tense(code: &str) -> Tense {
  CATEGORIES.with(|categories| {
    assert!(code.len() == categories.len());
    let mut result = Tense::default();
    for (i, ch) in code.as_bytes().iter().cloned().enumerate().filter(|x| x.1 != b'.') {
      let (category, values) = &categories[i];
      result.insert(category, values.iter().filter(|x| x.0 == ch).next().unwrap().1);
    }
    result
  })
}

fn zip(hindis: Vec<String>, latins: Vec<String>, tenses: Vec<Tense>) -> Vec<Case> {
  assert!(hindis.len() == latins.len() && latins.len() == tenses.len());
  let iter = hindis.into_iter().zip(latins.into_iter()).zip(tenses.into_iter());
  iter.map(|x| Case { hindi: (x.0).0, latin: (x.0).1, tense: x.1 }).collect()
}

// Our public interface is a series of functions that can be used to build vocabulary entries.

pub fn adjectives(table: &str) -> Result<Vec<Entry>> {
  let mut entries = vec![];
  for_each_row!(table, [meaning, word], {
    let (hindi, latin) = split(word)?;
    if hindi.ends_with('A') && latin.ends_with('a') {
      let (hstem, lstem) = (&hindi[..hindi.len() - 1], &latin[..latin.len() - 1]);
      let hindis: Vec<_> = ['A', 'e', 'I'].iter().map(|x| format!("{}{}", hstem, x)).collect();
      let latins: Vec<_> = ['a', 'e', 'i'].iter().map(|x| format!("{}{}", lstem, x)).collect();
      let tenses: Vec<_> = ["sm...", "pm...", ".f..."].iter().map(|x| tense(x)).collect();
      entries.push(rollup(&zip(hindis, latins, tenses), "adjective", meaning));
    } else {
      entries.push(rollup(&[Case { hindi, latin, tense: Tense::default() }], "adjective", meaning));
    }
  });
  Ok(entries.into_iter().flatten().collect())
}

pub fn numbers(table: &str) -> Result<Vec<Entry>> {
  let mut entries = vec![];
  for_each_row!(table, [meaning, word], {
    let value = meaning.parse::<usize>().map_err(|_| format!("Invalid number: {}", meaning))?;
    let (hindi, latin) = split(word)?;
    let tense = tense(if value == 1 { "s...." } else { "p...." });
    entries.push(rollup(&[Case { hindi, latin, tense }], "number", meaning));
  });
  Ok(entries.into_iter().flatten().collect())
}

pub fn particles(table: &str) -> Result<Vec<Entry>> {
  let mut entries = vec![];
  for_each_row!(table, [category, meaning, word, declines], {
    let (hindi, latin) = split(word)?;
    let declines = match declines {
      "n" => false,
      "y" => true,
      _ => Err(format!("declines must be n or y; got: {}", declines))?,
    };
    if declines {
      if !(hindi.ends_with('A') && latin.ends_with('a')) {
        Err(format!("Declining particles must end in A. Got: {}", word))?
      }
      let (hstem, lstem) = (&hindi[..hindi.len() - 1], &latin[..latin.len() - 1]);
      let hindis: Vec<_> = ['A', 'e', 'I'].iter().map(|x| format!("{}{}", hstem, x)).collect();
      let latins: Vec<_> = ['a', 'e', 'i'].iter().map(|x| format!("{}{}", lstem, x)).collect();
      let tenses: Vec<_> = ["sm...", "pm...", ".f..."].iter().map(|x| tense(x)).collect();
      entries.push(rollup(&zip(hindis, latins, tenses), "particle", meaning));
    } else {
      entries.push(rollup(&[Case { hindi, latin, tense: Tense::default() }], "particle", meaning));
    }
    let last = entries.last_mut().unwrap();
    last.iter_mut().for_each(|x| std::mem::drop(x.scores.insert(format!("%{}", category), 0.0)));
  });
  Ok(entries.into_iter().flatten().collect())
}
