use hindi::transliterator::Transliterator;
use hindi::vocabulary::{build_tense, build_vocabulary, Entry};
use lib::base::{HashMap, Result};
use nlu::base::{Lexer, Match, Tense, Token};
use payload::base::Payload;
use std::rc::Rc;

struct XEntry<T: Payload> {
  match_rc: Rc<Match<T>>,
  scores: HashMap<String, f32>,
  value_str: String,
}

fn agree(a: &Tense, b: &Tense) -> bool {
  a.iter().all(|(k, v)| b.get(k).map(|x| x == v).unwrap_or(true))
}

fn common_prefix<'a>(a: &'a str, b: &'a str) -> &'a str {
  &a[0..a.chars().zip(b.chars()).take_while(|x| x.0 == x.1).map(|x| x.0.len_utf8()).sum()]
}

fn create_xentry<T: Payload>(entry: Entry) -> Result<XEntry<T>> {
  let Entry { head, hindi, latin, scores, tenses, value } = entry;
  let texts = vec![("head", head), ("hindi", hindi), ("latin", latin)].into_iter().collect();
  let value = T::parse(&value)?;
  let value_str = T::stringify(&value);
  let match_rc = Rc::new(Match { tenses, texts, value });
  Ok(XEntry { match_rc, scores, value_str })
}

fn default_match<T: Payload>(text: &str) -> Rc<Match<T>> {
  let mut texts = HashMap::default();
  texts.insert("hindi", text.to_string());
  texts.insert("latin", text.to_string());
  Rc::new(Match { tenses: vec![], texts, value: T::base_lex(text) })
}

fn update_scores<'a, T: Payload>(
  entry: &'a XEntry<T>,
  matches: &mut HashMap<&'a str, (f32, Rc<Match<T>>)>,
  offset: f32,
) {
  for (name, base) in &entry.scores {
    let score = base + offset;
    let items = matches.entry(name).or_insert((score, Rc::clone(&entry.match_rc)));
    if items.0 < offset {
      *items = (score, Rc::clone(&entry.match_rc));
    }
  }
}

pub struct HindiLexer<T: Payload> {
  from_head: HashMap<String, Vec<Rc<XEntry<T>>>>,
  from_name: HashMap<String, Vec<Rc<XEntry<T>>>>,
  from_word: HashMap<String, Vec<Rc<XEntry<T>>>>,
  transliterator: Transliterator,
}

impl<T: Payload> HindiLexer<T> {
  pub fn new(text: &str) -> Result<Box<Lexer<Option<T>, T>>> {
    let mut from_head = HashMap::default();
    let mut from_name = HashMap::default();
    let mut from_word = HashMap::default();
    for entry in build_vocabulary(text)? {
      let (head, hindi) = (entry.head.clone(), entry.hindi.clone());
      let entry = Rc::new(create_xentry(entry)?);
      from_head.entry(head).or_insert(vec![]).push(Rc::clone(&entry));
      from_word.entry(hindi).or_insert(vec![]).push(Rc::clone(&entry));
      for name in entry.scores.keys() {
        from_name.entry(name.clone()).or_insert(vec![]).push(Rc::clone(&entry));
      }
    }
    let t = Transliterator::new(&from_word.keys().map(|x| x.as_str()).collect::<Vec<_>>());
    Ok(Box::new(Self { from_head, from_name, from_word, transliterator: t }))
  }
}

impl<T: Payload> Lexer<Option<T>, T> for HindiLexer<T> {
  fn fix(&self, m: &Match<T>, t: &Tense) -> Vec<Rc<Match<T>>> {
    let (head, latin) = (m.texts.get("head"), m.texts.get("latin"));
    if head.is_none() || latin.is_none() {
      return vec![];
    }
    let (head, latin) = (head.unwrap(), latin.unwrap());
    let value_str = T::stringify(&m.value);
    let check = |x: &&Rc<XEntry<T>>| {
      x.value_str == value_str && x.match_rc.tenses.iter().any(|y| agree(y, t))
    };
    let score = |x: &&Rc<XEntry<T>>| {
      x.match_rc.texts.get("latin").map(|x| common_prefix(x, latin).len()).unwrap_or_default()
    };
    let by_heads = self.from_head.get(head).map(|x| x.as_slice()).unwrap_or_default();
    let by_value: Vec<_> = by_heads.iter().filter(check).collect();
    let max_score = by_value.iter().map(score).max().unwrap_or_default();
    let by_score: Vec<_> = by_value.iter().filter(|x| score(x) == max_score).collect();
    by_score.into_iter().map(|x| Rc::clone(&x.match_rc)).collect()
  }

  fn lex<'a: 'b, 'b>(&'a self, input: &'b str) -> Vec<Token<'b, T>> {
    let xs = input.split(' ').map(|x| {
      let mut matches = HashMap::default();
      matches.insert("%token", (0.0, default_match(x)));
      for (i, option) in self.transliterator.transliterate(x).into_iter().enumerate() {
        let entries = self.from_word.get(&option).unwrap();
        entries.iter().for_each(|x| update_scores(x, &mut matches, -(i as f32)));
      }
      Token { matches: matches.into_iter().collect(), text: x }
    });
    xs.collect()
  }

  fn tense(&self, tense: &HashMap<String, String>) -> Result<Tense> {
    build_tense(tense)
  }

  fn unlex(&self, name: &str, value: &Option<T>) -> Vec<Rc<Match<T>>> {
    if name == "%token" {
      if let Some(value) = value {
        if let Some(text) = T::base_unlex(value) {
          return vec![default_match(text)];
        }
      }
      vec![]
    } else {
      let mut entries = self.from_name.get(name).map(|x| x.iter().collect()).unwrap_or(vec![]);
      if let Some(value) = value {
        let value_str = T::stringify(&value);
        entries = entries.into_iter().filter(|x| x.value_str == value_str).collect();
      }
      let min = std::f32::NEG_INFINITY;
      let max = entries.iter().fold(min, |a, x| a.max(x.scores.get(name).cloned().unwrap_or(min)));
      entries
        .into_iter()
        .filter(|x| x.scores.get(name).cloned().unwrap_or(min) == max)
        .map(|x| Rc::clone(&x.match_rc))
        .collect()
    }
  }
}
