use hindi::transliterator::Transliterator;
use hindi::vocabulary::{build_tense, build_vocabulary, Entry};
use lib::base::{HashMap, Result};
use nlu::base::{Lexer, Match, Tense, Token};
use payload::base::Payload;
use std::rc::Rc;

struct XEntry<T: Payload> {
  match_rc: Rc<Match<T>>,
  scores: HashMap<String, f32>,
  value_string: String,
}

fn agree(a: &Tense, b: &Tense) -> bool {
  a.iter().all(|(k, v)| b.get(k).map(|x| x == v).unwrap_or(true))
}

fn default_match<T: Payload>(text: &str) -> Rc<Match<T>> {
  let mut texts = HashMap::default();
  texts.insert("default", text.to_string());
  Rc::new(Match { tenses: vec![], texts, value: T::base_lex(text) })
}

fn update<'a, T: Payload>(
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
      let Entry { head, hindi, latin, scores, tenses, value } = entry;
      let value = T::parse(&value)?;
      let value_string = T::stringify(&value);
      let mut texts = HashMap::default();
      texts.insert("head", head.clone());
      texts.insert("hindi", hindi.clone());
      texts.insert("latin", latin.clone());
      let match_rc = Rc::new(Match { tenses, texts, value });
      let entry = Rc::new(XEntry { match_rc, scores, value_string });
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
    if let Some(head) = m.texts.get("head") {
      let entries = self.from_head.get(head).map(|x| x.as_slice()).unwrap_or(&[]);
      let value_string = T::stringify(&m.value);
      // TODO(skishore): Return the fixed result closest to the original.
      // We should always correct "mera" -> "meri" and not to "hamari".
      entries
        .iter()
        .filter(|x| x.value_string == value_string && x.match_rc.tenses.iter().any(|y| agree(y, t)))
        .map(|x| Rc::clone(&x.match_rc))
        .collect()
    } else {
      vec![]
    }
  }

  fn lex<'a: 'b, 'b>(&'a self, input: &'b str) -> Vec<Token<'b, T>> {
    let xs = input.split(' ').map(|x| {
      let mut matches = HashMap::default();
      matches.insert("%token", (0.0, default_match(x)));
      for (i, option) in self.transliterator.transliterate(x).into_iter().enumerate() {
        let offset = -(i as f32);
        self.from_word.get(&option).unwrap().iter().for_each(|x| update(x, &mut matches, offset));
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
          vec![default_match(text)]
        } else {
          vec![]
        }
      } else {
        // TODO(skishore): This line of code is wrong. All of this file is terrible.
        vec![default_match("")]
      }
    } else {
      let mut entries = self.from_name.get(name).map(|x| x.iter().collect()).unwrap_or(vec![]);
      if let Some(value) = value {
        let value_string = T::stringify(&value);
        entries = entries.into_iter().filter(|x| x.value_string == value_string).collect();
      }
      let max_score = entries.iter().fold(std::f32::NEG_INFINITY, |a, x| {
        a.max(x.scores.get(name).cloned().unwrap_or(std::f32::NEG_INFINITY))
      });
      entries
        .into_iter()
        .filter(|x| x.scores.get(name).cloned().unwrap_or(std::f32::NEG_INFINITY) == max_score)
        .map(|x| Rc::clone(&x.match_rc))
        .collect()
    }
  }
}
