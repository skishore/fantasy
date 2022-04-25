use super::super::lib::base::{HashMap, Result};
use std::borrow::Borrow;
use std::cell::{RefCell, RefMut};
use std::fmt::{Display, Formatter};

// Our tense type is a mapping from interned string -> interned string. The keys represent
// grammatical categories, such as "count", "gender", or "person". The values represent
// values of those categories: "count" may have values "plural" or "singular".
//
// For any language, there is a small finite list of categories and values. Some languages
// like English have barely any agreement - mostly on "count" and "person". Other languages
// have more types of grammatical agreement. However, 1 << 16 should be enough strings to
// capture all the tenses for all languages.

#[derive(Clone, Default)]
pub struct Tense(HashMap<Interned, Interned>);

impl Tense {
  pub fn new<T: Borrow<str>>(t: &HashMap<T, T>) -> Result<Tense> {
    let iter = t.iter().map(|(k, v)| Ok((Interned::new(k.borrow())?, Interned::new(v.borrow())?)));
    iter.collect::<Result<HashMap<_, _>>>().map(Tense)
  }

  pub fn agree(&self, other: &Tense) -> bool {
    self.0.iter().all(|(k, v)| other.0.get(k).map(|x| x == v).unwrap_or(true))
  }

  pub fn check(&self, other: &Tense) -> Vec<String> {
    let base = self.check_base(other);
    base.iter().map(|x| format!("{} should be {} (was: {})", x.0, x.1, x.2)).collect()
  }

  pub fn get(&self, category: &str) -> Option<String> {
    Some(self.0.get(&Interned::new(category).ok()?)?.to_string())
  }

  pub fn union(&mut self, others: &Tense) {
    others.0.iter().for_each(|(k, v)| std::mem::drop(self.0.insert(*k, *v)))
  }

  pub fn union_checked(&mut self, others: &[Tense]) -> Vec<String> {
    if others.is_empty() {
      return vec![];
    }
    let checks: Vec<_> = others.iter().map(|x| (x, self.check_base(x))).collect();
    let agrees: Vec<_> = checks.iter().filter(|x| x.1.is_empty()).map(|x| x.0).collect();
    if agrees.is_empty() {
      let min = checks.iter().map(|x| x.1.len()).min().unwrap();
      let min_errors = checks.iter().find(|x| x.1.len() == min).unwrap();
      min_errors.1.iter().map(|x| format!("{} should be {} (was: {})", x.0, x.1, x.2)).collect()
    } else if agrees.len() == 1 {
      self.union(agrees[0]);
      vec![]
    } else {
      let intersection = agrees.iter().skip(1).fold(agrees[0].clone(), |acc, x| acc.intersect(x));
      self.union(&intersection);
      vec![]
    }
  }

  fn check_base(&self, other: &Tense) -> Vec<(Interned, Interned, Interned)> {
    let f = |(k, v): (&Interned, &Interned)| {
      other.0.get(k).map(|x| if x == v { None } else { Some((*k, *v, *x)) })?
    };
    self.0.iter().filter_map(f).collect()
  }

  fn intersect(&self, other: &Tense) -> Tense {
    let f = |(k, v): (&Interned, &Interned)| {
      other.0.get(k).map(|x| if x == v { Some((*k, *v)) } else { None })?
    };
    Tense(self.0.iter().filter_map(f).collect())
  }
}

// The Interned helper type allows us to intern strings, checks whether a given string is
// already interned, and checks when we run out of interned string space. If we need more
// space we just need to bump the size on the type below.

thread_local! {
  static MAP: RefCell<(Vec<String>, HashMap<String, Interned>)> = RefCell::default();
}

type InternedId = u16;

#[derive(Clone, Copy, Eq, Hash, PartialEq)]
pub struct Interned(InternedId);

impl Interned {
  pub fn new(value: &str) -> Result<Interned> {
    MAP.with(|x| {
      let pair = RefMut::map_split(x.borrow_mut(), |x| (&mut x.0, &mut x.1));
      let (mut id_to_str, mut str_to_id) = pair;
      if let Some(x) = str_to_id.get(value) {
        return Ok(*x);
      }
      let len = id_to_str.len();
      if len > InternedId::max_value() as usize {
        Err(format!("Hit string interning limit: {}", len))?
      }
      id_to_str.push(value.to_string());
      str_to_id.insert(value.to_string(), Interned(len as InternedId));
      Ok(Interned(len as InternedId))
    })
  }
}

impl Display for Interned {
  fn fmt(&self, f: &mut Formatter) -> std::fmt::Result {
    MAP.with(|x| write!(f, "{}", x.borrow().0[self.0 as usize]))
  }
}
