use super::base::Result;
use regex::Regex;
use std::borrow::Borrow;
use std::cell::RefCell;
use std::rc::Rc;

struct State<'a> {
  expected: Vec<Rc<String>>,
  input: &'a str,
  remainder: usize,
}

type Method<T> = dyn for<'a> Fn(&'a str, &mut State<'a>) -> Option<(T, &'a str)>;

pub struct Parser<T>(Rc<Method<T>>);

impl<T> Into<Parser<T>> for &Parser<T> {
  fn into(self) -> Parser<T> {
    Parser(Rc::clone(&self.0))
  }
}

impl<T: 'static> Parser<T> {
  fn new<F: for<'a> Fn(&'a str, &mut State<'a>) -> Option<(T, &'a str)> + 'static>(f: F) -> Self {
    Parser(Rc::new(f))
  }

  pub fn parse(&self, x: &str) -> Result<T> {
    let mut state = State { expected: vec![], input: x, remainder: x.len() };
    match (self.0)(x, &mut state) {
      Some((value, "")) => Ok(value),
      Some((_, x)) => Err(format(Some(x.len()), &mut state).into()),
      None => Err(format(None, &mut state).into()),
    }
  }
}

// Methods for constructing parsers.

pub fn any<A: 'static>(parsers: &[impl Borrow<Parser<A>>]) -> Parser<A> {
  let parsers: Vec<Parser<A>> = parsers.iter().map(|x| x.borrow().into()).collect();
  Parser::new(move |x, s| parsers.iter().filter_map(|y| (y.0)(x, s)).next())
}

pub fn fail<A: 'static>(message: &str) -> Parser<A> {
  let expected = Rc::new(message.to_string());
  Parser::new(move |x, s| {
    update(Rc::clone(&expected), x.len(), s);
    None
  })
}

pub fn lazy<A: 'static>() -> (Rc<RefCell<Parser<A>>>, Parser<A>) {
  let result = Rc::new(RefCell::new(fail("Uninitialized lazy!")));
  (Rc::clone(&result), Parser::new(move |x, s| (RefCell::borrow(&result).0)(x, s)))
}

pub fn map<A: 'static, B: 'static, F: Fn(A) -> B + 'static>(
  parser: impl Into<Parser<A>>,
  callback: F,
) -> Parser<B> {
  let parser = parser.into();
  Parser::new(move |x, s| (parser.0)(x, s).map(|(value, x)| (callback(value), x)))
}

pub fn opt<A: 'static>(parser: impl Into<Parser<A>>) -> Parser<Option<A>> {
  let parser = parser.into();
  Parser::new(move |x, s| match (parser.0)(x, s) {
    Some((value, x)) => Some((Some(value), x)),
    None => Some((None, x)),
  })
}

pub fn regexp<A: 'static, F: Fn(&str) -> A + 'static>(re: &str, callback: F) -> Parser<A> {
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

pub fn repeat<A: 'static>(parser: impl Into<Parser<A>>, min: usize) -> Parser<Vec<A>> {
  let parser = parser.into();
  Parser::new(move |x, s| {
    let mut remainder = x;
    let mut result = vec![];
    while let Some((value, x)) = (parser.0)(remainder, s) {
      remainder = x;
      result.push(value);
    }
    return if result.len() < min { None } else { Some((result, remainder)) };
  })
}

pub fn separate<A: 'static, B: 'static>(
  item: impl Into<Parser<A>>,
  separator: impl Into<Parser<B>>,
  min: usize,
) -> Parser<Vec<A>> {
  let (item, separator) = (item.into(), separator.into());
  let m = if min == 0 { 0 } else { min - 1 };
  let list = seq2((&item, repeat(seq2((separator, &item), |x| x.1), m)), |mut x| {
    let mut result = vec![x.0];
    result.append(&mut x.1);
    result
  });
  return if min == 0 { any(&[list, succeed(|| vec![])]) } else { list };
}

pub fn seq2<A: 'static, B: 'static, F: Fn((A, B)) -> T + 'static, T: 'static>(
  parsers: (impl Into<Parser<A>>, impl Into<Parser<B>>),
  callback: F,
) -> Parser<T> {
  let (a, b) = (parsers.0.into(), parsers.1.into());
  Parser::new(move |x, s| {
    let (a, x) = a.0(x, s)?;
    let (b, x) = b.0(x, s)?;
    Some((callback((a, b)), x))
  })
}

pub fn seq3<A: 'static, B: 'static, C: 'static, F: Fn((A, B, C)) -> T + 'static, T: 'static>(
  parsers: (impl Into<Parser<A>>, impl Into<Parser<B>>, impl Into<Parser<C>>),
  callback: F,
) -> Parser<T> {
  let (a, b, c) = (parsers.0.into(), parsers.1.into(), parsers.2.into());
  Parser::new(move |x, s| {
    let (a, x) = a.0(x, s)?;
    let (b, x) = b.0(x, s)?;
    let (c, x) = c.0(x, s)?;
    Some((callback((a, b, c)), x))
  })
}

pub fn seq4<A: 'static, B: 'static, C: 'static, D: 'static, F: 'static, T: 'static>(
  parsers: (impl Into<Parser<A>>, impl Into<Parser<B>>, impl Into<Parser<C>>, impl Into<Parser<D>>),
  callback: F,
) -> Parser<T>
where
  F: Fn((A, B, C, D)) -> T,
{
  let (a, b, c, d) = (parsers.0.into(), parsers.1.into(), parsers.2.into(), parsers.3.into());
  Parser::new(move |x, s| {
    let (a, x) = a.0(x, s)?;
    let (b, x) = b.0(x, s)?;
    let (c, x) = c.0(x, s)?;
    let (d, x) = d.0(x, s)?;
    Some((callback((a, b, c, d)), x))
  })
}

pub fn string<A: 'static, F: Fn(&str) -> A + 'static>(st: &str, callback: F) -> Parser<A> {
  let st = st.to_string();
  let expected = Rc::new(format!("{:?}", st));
  Parser::new(move |x, s| {
    if x.starts_with(&st) {
      let (l, r) = x.split_at(st.len());
      return Some((callback(l), r));
    }
    update(Rc::clone(&expected), x.len(), s);
    None
  })
}

pub fn succeed<A: 'static, F: Fn() -> A + 'static>(callback: F) -> Parser<A> {
  Parser::new(move |x, _| Some((callback(), x)))
}

// Internal helpers used for error handling.

fn format<'a>(remainder: Option<usize>, state: &mut State<'a>) -> String {
  if let Some(remainder) = remainder {
    update(Rc::new("EOF".to_string()), remainder, state);
  }
  let total = state.input.len();
  let index = std::cmp::max(std::cmp::min(total - state.remainder, total), 0);
  let start = state.input[..index].rfind('\n').map_or(0, |x| x + 1);
  let end = state.input[start..].find('\n').map_or(total, |x| x + start);
  let (l, c) = (state.input[..end].split('\n').count(), index - start + 1);
  let (h, w) = (&state.input[start..end], " ".repeat(c - 1));
  let mut expected: Vec<_> = state.expected.iter().map(|x| x.to_string()).collect();
  expected.sort();
  format!("At line {}, column {}: expected: {}\n\n  {}\n  {}^\n", l, c, expected.join(" | "), h, w)
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

#[cfg(test)]
mod tests {
  use super::*;
  use test::Bencher;

  fn float_parser<'a>() -> Parser<(f32, Option<i32>)> {
    let base = regexp("-?(0|[1-9][0-9]*)([.][0-9]+)?", |x| x.parse::<f32>().unwrap());
    let exponent = regexp("-?(0|[1-9][0-9]*)", |x| x.parse::<i32>().unwrap());
    return seq2((base, opt(seq2((any(&[tag("e"), tag("E")]), exponent), |x| x.1))), |x| x);
  }

  fn tag(x: &str) -> Parser<()> {
    string(x, |_| ())
  }

  fn test_error<T: std::fmt::Debug>(result: Result<T>, prefix: &str) {
    let error = format!("{:?}", result.unwrap_err());
    if !error.starts_with(prefix) {
      let error = error.split('\n').nth(0).unwrap_or("");
      panic!("Error does not match prefix:\nexpected: {:?}\n  actual: {:?}", prefix, error);
    }
  }

  #[test]
  fn float_parser_test() {
    let parser = float_parser();
    assert_eq!(parser.parse("-1.23"), Ok((-1.23, None)));
    assert_eq!(parser.parse("-1.23e45"), Ok((-1.23, Some(45))));
    assert_eq!(parser.parse("-1.23E45"), Ok((-1.23, Some(45))));
    test_error(parser.parse("-1.23e"), "At line 1, column 7: expected: /-?(0|[1-9][0-9]*)/");
    test_error(parser.parse("-1.23f45"), r#"At line 1, column 6: expected: "E" | "e" | EOF"#);
    test_error(parser.parse("-1.23e45 "), "At line 1, column 9: expected: EOF");
  }

  #[test]
  fn repeat_test() {
    let parser = repeat(tag("a"), 0);
    assert_eq!(parser.parse(""), Ok(vec![]));
    assert_eq!(parser.parse("a"), Ok(vec![()]));
    assert_eq!(parser.parse("aa"), Ok(vec![(), ()]));
    test_error(parser.parse("aa?"), r#"At line 1, column 3: expected: "a" | EOF"#);
    let parser = repeat(tag("a"), 1);
    test_error(parser.parse(""), r#"At line 1, column 1: expected: "a""#);
    assert_eq!(parser.parse("a"), Ok(vec![()]));
    assert_eq!(parser.parse("aa"), Ok(vec![(), ()]));
    test_error(parser.parse("aa?"), r#"At line 1, column 3: expected: "a" | EOF"#);
  }

  #[test]
  fn separate_test() {
    let parser = separate(tag("a"), tag(","), 0);
    assert_eq!(parser.parse(""), Ok(vec![]));
    assert_eq!(parser.parse("a"), Ok(vec![()]));
    assert_eq!(parser.parse("a,a"), Ok(vec![(), ()]));
    test_error(parser.parse("a,a?"), r#"At line 1, column 4: expected: "," | EOF"#);
    test_error(parser.parse("a,a,?"), r#"At line 1, column 5: expected: "a""#);
    let parser = separate(tag("a"), tag(","), 1);
    test_error(parser.parse(""), r#"At line 1, column 1: expected: "a""#);
    assert_eq!(parser.parse("a"), Ok(vec![()]));
    assert_eq!(parser.parse("a,a"), Ok(vec![(), ()]));
    test_error(parser.parse("a,a?"), r#"At line 1, column 4: expected: "," | EOF"#);
    test_error(parser.parse("a,a,?"), r#"At line 1, column 5: expected: "a""#);
  }

  #[bench]
  fn float_parser_benchmark(b: &mut Bencher) {
    let parser = float_parser();
    b.iter(|| parser.parse("-1.23e45"));
  }
}
