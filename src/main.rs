#![feature(test)]

extern crate regex;

#[cfg(test)]
extern crate test;

use regex::Regex;
use std::collections::BTreeSet;
use std::rc::Rc;

struct State<'a> {
  expected: Vec<Rc<String>>,
  input: &'a str,
  remainder: usize,
}

type Output<'a, T> = Option<(T, &'a str)>;

type Method<'a, T> = Fn(&'a str, &mut State<'a>) -> Output<'a, T> + 'a;

pub struct Parser<'a, T> {
  method: Box<Method<'a, T>>,
}

impl<'a, T> Parser<'a, T> {
  fn new<M>(method: M) -> Parser<'a, T>
  where
    M: Fn(&'a str, &mut State<'a>) -> Output<'a, T> + 'a,
  {
    Parser { method: Box::new(method) }
  }

  pub fn parse(&self, x: &'a str) -> Result<T, String> {
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

pub fn any<'a, A: 'a>(parsers: Vec<Parser<'a, A>>) -> Parser<'a, A> {
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

pub fn map<'a, A: 'a, B: 'a, F>(parser: Parser<'a, A>, callback: F) -> Parser<'a, B>
where
  F: Fn(A) -> B + 'a,
{
  Parser::new(move |x, s| match (parser.method)(x, s) {
    Some((value, x)) => Some((callback(value), x)),
    None => None,
  })
}

pub fn mul<'a, A: 'a>(parser: Parser<'a, A>, min: usize) -> Parser<'a, Vec<A>> {
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

pub fn opt<'a, A: 'a>(a: Parser<'a, A>) -> Parser<'a, Option<A>> {
  Parser::new(move |x, s| match (a.method)(x, s) {
    Some((value, x)) => Some((Some(value), x)),
    None => Some((None, x)),
  })
}

pub fn seq<'a, A: 'a, B: 'a>(a: Parser<'a, A>, b: Parser<'a, B>) -> Parser<'a, (A, B)> {
  Parser::new(move |x, s| {
    (a.method)(x, s).and_then(|(a, x)| (b.method)(x, s).and_then(|(b, x)| Some(((a, b), x))))
  })
}

pub fn regexp<'a>(re: &str) -> Parser<'a, &'a str> {
  let expected = Rc::new(format!("/{}/", re));
  let re = Box::new(Regex::new(&format!("^{}", re)).unwrap());
  Parser::new(move |x, s| {
    if let Some(m) = re.find(x) {
      return Some(x.split_at(m.end()));
    }
    update(Rc::clone(&expected), x.len(), s);
    None
  })
}

pub fn string<'a>(st: &'a str) -> Parser<'a, &'a str> {
  let expected = Rc::new(format!("{:?}", st));
  Parser::new(move |x, s| {
    if x.starts_with(st) {
      return Some(x.split_at(st.len()));
    } else {
      update(Rc::clone(&expected), x.len(), s);
      None
    }
  })
}

#[cfg(test)]
mod tests {
  use super::*;
  use test::Bencher;

  fn float_parser<'a>() -> Parser<'a, (&'a str, Option<(&'a str, &'a str)>)> {
    let base = regexp("-?(0|[1-9][0-9]*)([.][0-9]+)?");
    let exponent = regexp("(0|[1-9][0-9]*)");
    return seq(base, opt(seq(any(vec![string("e"), string("E")]), exponent)));
  }

  #[bench]
  fn benchmark(b: &mut Bencher) {
    let parser = float_parser();
    b.iter(|| parser.parse("-1.23e45"));
  }

  #[test]
  fn smoke_test() {
    let parser = float_parser();
    assert_eq!(parser.parse("-1.23"), Ok(("-1.23", None)));
    assert_eq!(parser.parse("-1.23e45"), Ok(("-1.23", Some(("e", "45")))));
    assert_eq!(parser.parse("-1.23E45"), Ok(("-1.23", Some(("E", "45")))));
    assert_eq!(parser.parse("-1.23e"), Err("At 6: expected: /(0|[1-9][0-9]*)/".to_string()));
    assert_eq!(parser.parse("-1.23f45"), Err(r#"At 5: expected: "E" | "e" | EOF"#.to_string()));
    assert_eq!(parser.parse("-1.23e45 "), Err("At 8: expected: EOF".to_string()));
  }
}
