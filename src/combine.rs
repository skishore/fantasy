use regex::Regex;
use std::cell::RefCell;
use std::collections::BTreeSet;
use std::rc::Rc;
use std::sync::Arc;

struct State<'a> {
  expected: Vec<Rc<String>>,
  input: &'a str,
  remainder: usize,
}

type Output<'a, T: 'a> = Option<(T, &'a str)>;

type Method<T> = for<'a> Fn(&'a str, &mut State<'a>) -> Output<'a, T>;

pub struct Parser<T> {
  method: Arc<Method<T>>,
}

unsafe impl<T> Sync for Parser<T> {}

impl<T> Clone for Parser<T> {
  fn clone(&self) -> Parser<T> {
    return Parser { method: Arc::clone(&self.method) };
  }
}

impl<T: 'static> Parser<T> {
  fn new<M: 'static>(method: M) -> Parser<T>
  where
    M: for<'a> Fn(&'a str, &mut State<'a>) -> Output<'a, T>,
  {
    Parser { method: Arc::new(method) }
  }

  pub fn or(self, other: Parser<T>) -> Parser<T> {
    any(vec![self, other])
  }

  pub fn map<U: 'static, F: 'static>(self, callback: F) -> Parser<U>
  where
    F: Fn(T) -> U,
  {
    map(self, callback)
  }

  pub fn parse(&self, x: &str) -> Result<T, String> {
    let mut state = State { expected: vec![], input: x, remainder: x.len() };
    match (self.method)(x, &mut state) {
      Some((value, x)) => {
        if x.len() > 0 {
          Result::Err(format(Some(x.len()), &mut state))
        } else {
          Ok(value)
        }
      }
      None => Result::Err(format(None, &mut state)),
    }
  }

  pub fn repeat(self, min: usize) -> Parser<Vec<T>> {
    mul(self, min)
  }

  pub fn separate<U: 'static>(self, seperator: Parser<U>, min: usize) -> Parser<Vec<T>> {
    sep(self, seperator, min)
  }

  pub fn skip<U: 'static>(self, other: Parser<U>) -> Parser<T> {
    seq2((self, other), |x| x.0)
  }

  pub fn then<U: 'static>(self, other: Parser<U>) -> Parser<U> {
    seq2((self, other), |x| x.1)
  }
}

fn format<'a>(remainder: Option<usize>, state: &mut State<'a>) -> String {
  if let Some(remainder) = remainder {
    update(Rc::new("EOF".to_string()), remainder, state);
  }
  let expected: BTreeSet<_> = state.expected.iter().map(|x| x.to_string()).collect();
  let expected: Vec<_> = expected.into_iter().collect();
  let index = state.input.len() - state.remainder;
  format!("At {}: expected: {}", index, expected.join(" | "))
}

fn update<'a>(expected: Rc<String>, remainder: usize, state: &mut State<'a>) {
  if state.remainder < remainder {
    return;
  } else if state.remainder > remainder {
    state.expected.clear();
    state.remainder = remainder;
  }
  state.expected.push(expected);
}

pub fn any<A: 'static>(parsers: Vec<Parser<A>>) -> Parser<A> {
  Parser::new(move |x, s| {
    for parser in &parsers {
      match (parser.method)(x, s) {
        Some(x) => return Some(x),
        None => continue,
      }
    }
    None
  })
}

pub fn laz<A: 'static>() -> (Rc<RefCell<Option<Parser<A>>>>, Parser<A>) {
  let result: Rc<RefCell<Option<Parser<A>>>> = Rc::new(RefCell::new(None));
  let helper = Rc::clone(&result);
  let parser = Parser::new(move |x, s| {
    match *helper.borrow() {
      Some(ref p) => (p.method)(x, s),
      None => None,
    }
  });
  (result, parser)
}

pub fn map<A: 'static, B: 'static, F: 'static>(parser: Parser<A>, callback: F) -> Parser<B>
where
  F: Fn(A) -> B,
{
  Parser::new(move |x, s| match (parser.method)(x, s) {
    Some((value, x)) => Some((callback(value), x)),
    None => None,
  })
}

pub fn mul<A: 'static>(parser: Parser<A>, min: usize) -> Parser<Vec<A>> {
  Parser::new(move |x, s| {
    let mut remainder = x;
    let mut result = vec![];
    while let Some((value, x)) = (parser.method)(remainder, s) {
      remainder = x;
      result.push(value);
    }
    if result.len() < min {
      None
    } else {
      Some((result, remainder))
    }
  })
}

pub fn opt<A: 'static>(a: Parser<A>) -> Parser<Option<A>> {
  Parser::new(move |x, s| match (a.method)(x, s) {
    Some((value, x)) => Some((Some(value), x)),
    None => Some((None, x)),
  })
}

pub fn sep<A: 'static, B: 'static>(a: Parser<A>, b: Parser<B>, min: usize) -> Parser<Vec<A>> {
  let m = if min == 0 { 0 } else { min - 1 };
  let list = seq2((a.clone(), mul(seq2((b, a), |x| x.1), m)), |mut x| {
    let mut result = vec![x.0];
    result.append(&mut x.1);
    result
  });
  if min == 0 {
    any(vec![list, succeed(|| vec![])])
  } else {
    list
  }
}

pub fn seq2<A: 'static, B: 'static, F: 'static, T: 'static>(
  parsers: (Parser<A>, Parser<B>),
  callback: F,
) -> Parser<T>
where
  F: Fn((A, B)) -> T,
{
  Parser::new(move |x, s| {
    if let Some((a, x)) = (parsers.0.method)(x, s) {
      if let Some((b, x)) = (parsers.1.method)(x, s) {
        return Some((callback((a, b)), x));
      }
    }
    None
  })
}

pub fn seq3<A: 'static, B: 'static, C: 'static, F: 'static, T: 'static>(
  parsers: (Parser<A>, Parser<B>, Parser<C>),
  callback: F,
) -> Parser<T>
where
  F: Fn((A, B, C)) -> T,
{
  Parser::new(move |x, s| {
    if let Some((a, x)) = (parsers.0.method)(x, s) {
      if let Some((b, x)) = (parsers.1.method)(x, s) {
        if let Some((c, x)) = (parsers.2.method)(x, s) {
          return Some((callback((a, b, c)), x));
        }
      }
    }
    None
  })
}

pub fn seq4<A: 'static, B: 'static, C: 'static, D: 'static, F: 'static, T: 'static>(
  parsers: (Parser<A>, Parser<B>, Parser<C>, Parser<D>),
  callback: F,
) -> Parser<T>
where
  F: Fn((A, B, C, D)) -> T,
{
  Parser::new(move |x, s| {
    if let Some((a, x)) = (parsers.0.method)(x, s) {
      if let Some((b, x)) = (parsers.1.method)(x, s) {
        if let Some((c, x)) = (parsers.2.method)(x, s) {
          if let Some((d, x)) = (parsers.3.method)(x, s) {
            return Some((callback((a, b, c, d)), x));
          }
        }
      }
    }
    None
  })
}

pub fn re(re: &str) -> Parser<()> {
  regexp(re, |_| ())
}

pub fn regexp<A: 'static, F: 'static>(re: &str, callback: F) -> Parser<A>
where
  F: for<'a> Fn(&'a str) -> A,
{
  let expected = Rc::new(format!("/{}/", re));
  let re = Box::new(Regex::new(&format!("^{}", re)).unwrap());
  Parser::new(move |x, s| {
    if let Some(m) = re.find(x) {
      let (l, r) = x.split_at(m.end());
      return Some((callback(l), r));
    }
    update(Rc::clone(&expected), x.len(), s);
    None
  })
}

pub fn st(st: &str) -> Parser<()> {
  string(st, |_| ())
}

pub fn string<A: 'static, F: 'static>(st: &str, callback: F) -> Parser<A>
where
  F: for<'a> Fn(&'a str) -> A,
{
  let st = st.to_string();
  let expected = Rc::new(format!("{:?}", st));
  Parser::new(move |x, s| {
    if x.starts_with(&st) {
      let (l, r) = x.split_at(st.len());
      return Some((callback(l), r));
    } else {
      update(Rc::clone(&expected), x.len(), s);
      None
    }
  })
}

pub fn succeed<A: 'static, F: 'static>(callback: F) -> Parser<A>
where
  F: Fn() -> A,
{
  Parser::new(move |x, _| Some((callback(), x)))
}

#[cfg(test)]
mod tests {
  use super::*;
  use test::Bencher;

  fn float_parser<'a>() -> Parser<(f32, Option<i32>)> {
    let base = regexp("-?(0|[1-9][0-9]*)([.][0-9]+)?", |x| x.parse::<f32>().unwrap());
    let exponent = regexp("-?(0|[1-9][0-9]*)", |x| x.parse::<i32>().unwrap());
    return seq2((base, opt(any(vec![st("e"), st("E")]).then(exponent))), |x| x);
  }

  #[bench]
  fn benchmark(b: &mut Bencher) {
    let parser = float_parser();
    b.iter(|| parser.parse("-1.23e45"));
  }

  #[test]
  fn comma_test() {
    let parser = sep(st("a"), st(","), 0);
    assert_eq!(parser.parse(""), Ok(vec![]));
    assert_eq!(parser.parse("a"), Ok(vec![()]));
    assert_eq!(parser.parse("a,a"), Ok(vec![(), ()]));
    assert_eq!(parser.parse("a,a?"), Err(r#"At 3: expected: "," | EOF"#.to_string()));
    assert_eq!(parser.parse("a,a,?"), Err(r#"At 4: expected: "a""#.to_string()));
    let parser = sep(st("a"), st(","), 1);
    assert_eq!(parser.parse(""), Err(r#"At 0: expected: "a""#.to_string()));
    assert_eq!(parser.parse("a"), Ok(vec![()]));
    assert_eq!(parser.parse("a,a"), Ok(vec![(), ()]));
    assert_eq!(parser.parse("a,a?"), Err(r#"At 3: expected: "," | EOF"#.to_string()));
    assert_eq!(parser.parse("a,a,?"), Err(r#"At 4: expected: "a""#.to_string()));
  }

  #[test]
  fn range_test() {
    let parser = mul(st("a"), 0);
    assert_eq!(parser.parse(""), Ok(vec![]));
    assert_eq!(parser.parse("a"), Ok(vec![()]));
    assert_eq!(parser.parse("aa"), Ok(vec![(), ()]));
    assert_eq!(parser.parse("aa?"), Err(r#"At 2: expected: "a" | EOF"#.to_string()));
    let parser = mul(st("a"), 1);
    assert_eq!(parser.parse(""), Err(r#"At 0: expected: "a""#.to_string()));
    assert_eq!(parser.parse("a"), Ok(vec![()]));
    assert_eq!(parser.parse("aa"), Ok(vec![(), ()]));
    assert_eq!(parser.parse("aa?"), Err(r#"At 2: expected: "a" | EOF"#.to_string()));
  }

  #[test]
  fn smoke_test() {
    let parser = float_parser();
    assert_eq!(parser.parse("-1.23"), Ok((-1.23, None)));
    assert_eq!(parser.parse("-1.23e45"), Ok((-1.23, Some(45))));
    assert_eq!(parser.parse("-1.23E45"), Ok((-1.23, Some(45))));
    assert_eq!(parser.parse("-1.23e"), Err("At 6: expected: /-?(0|[1-9][0-9]*)/".to_string()));
    assert_eq!(parser.parse("-1.23f45"), Err(r#"At 5: expected: "E" | "e" | EOF"#.to_string()));
    assert_eq!(parser.parse("-1.23e45 "), Err("At 8: expected: EOF".to_string()));
  }
}
