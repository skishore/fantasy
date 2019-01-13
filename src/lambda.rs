use std::collections::HashMap;
use std::rc::Rc;

pub type Args<T> = HashMap<usize, T>;

pub trait Template<T> {
  fn merge(&self, xs: &Args<T>) -> T;
  fn split(&self, x: T) -> Vec<Args<T>>;
}

// A lambda DCS type used for utterance semantics.

#[derive(Clone, Copy, PartialEq)]
pub enum Binary {
  Conjunction,
  Disjunction,
  Join,
}

#[derive(Clone, Copy, PartialEq)]
pub enum Unary {
  Not,
  Reverse,
}

pub enum Lambda {
  Binary(Binary, Vec<Rc<Lambda>>),
  Custom(String, Vec<Rc<Lambda>>),
  Terminal(String),
  Unary(Unary, Rc<Lambda>),
}

impl Lambda {
  pub fn parse(input: &str) -> Result<Rc<Lambda>, String> {
    parse(input)
  }

  pub fn stringify(&self) -> String {
    stringify(self, std::u32::MAX)
  }
}

// Helpers for representing lambda DCS expressions.

struct Operator {
  commutes: bool,
  precedence: u32,
  text: String,
}

impl Binary {
  fn data(&self) -> Operator {
    match self {
      Binary::Conjunction => Operator { commutes: true, precedence: 2, text: " & ".to_string() },
      Binary::Disjunction => Operator { commutes: true, precedence: 2, text: " | ".to_string() },
      Binary::Join => Operator { commutes: false, precedence: 0, text: ".".to_string() },
    }
  }
}

impl Unary {
  fn data(&self) -> Operator {
    match self {
      Unary::Not => Operator { commutes: false, precedence: 1, text: "~".to_string() },
      Unary::Reverse => Operator { commutes: false, precedence: 3, text: "R".to_string() },
    }
  }
}

fn parse(input: &str) -> Result<Rc<Lambda>, String> {
  use combine::*;
  type Node = Parser<Rc<Lambda>>;
  lazy_static! {
    static ref PARSER: Node = {
      let ws = regexp(r#"\s*"#, |_| ());
      let id = regexp("[a-zA-Z0-9_]+", |x| x.to_string()).skip(ws.clone());
      let st = |x| string(x, |_| ()).skip(ws.clone());

      let base = |x: Node| {
        any(vec![
          seq4((st("R"), st("["), x.clone(), st("]")), |x| {
            Rc::new(Lambda::Unary(Unary::Reverse, x.2))
          }),
          seq2((id.clone(), opt(st("(").then(sep(x.clone(), st(","), 0)).skip(st(")")))), |x| {
            match x.1 {
              Some(xs) => Rc::new(Lambda::Custom(x.0, xs)),
              None => Rc::new(Lambda::Terminal(x.0)),
            }
          }),
          seq3((st("("), x.clone(), st(")")), |x| x.1),
        ])
      };

      let binaries = |ops: Vec<(&'static str, Binary)>| {
        move |x: Node| {
          let mut options = vec![];
          for (name, op) in ops.iter() {
            let op = op.clone();
            options.push(st(name).then(x.clone()).repeat(1).map(move |x| Some((op, x))));
          }
          options.push(succeed(|| None));
          seq2((x, any(options)), |mut x| match &mut x.1 {
            Some((ref op, ref mut xs)) => {
              let mut result = vec![x.0];
              result.append(xs);
              Rc::new(Lambda::Binary(*op, result))
            }
            None => x.0,
          })
        }
      };

      let unary = |name: &'static str, op: Unary| {
        move |x: Node| x.clone().or(seq2((st(name), x), move |x| Rc::new(Lambda::Unary(op, x.1))))
      };

      let (cell, init) = laz();
      let precedence: Vec<Box<Fn(Node) -> Node>> = vec![
        Box::new(base),
        Box::new(binaries(vec![(".", Binary::Join)])),
        Box::new(unary("~", Unary::Not)),
        Box::new(binaries(vec![("&", Binary::Conjunction), ("|", Binary::Disjunction)])),
      ];
      cell.replace(Some(precedence.iter().fold(init.clone(), |x, f| f(x))));
      init
    };
  }
  PARSER.parse(input)
}

fn stringify(lambda: &Lambda, context: u32) -> String {
  match lambda {
    Lambda::Binary(op, children) => {
      let Operator { commutes, precedence, text } = op.data();
      let mut base: Vec<_> = children.into_iter().map(|x| stringify(x, precedence)).collect();
      if commutes {
        base.sort();
      }
      if precedence < context {
        base.join(&text)
      } else {
        format!("({})", base.join(&text))
      }
    }
    Lambda::Custom(name, children) => {
      let base: Vec<_> = children.into_iter().map(|x| x.stringify()).collect();
      format!("{}({})", name, base.join(", "))
    }
    Lambda::Terminal(name) => name.to_string(),
    Lambda::Unary(op, child) => {
      let Operator { precedence, text, .. } = op.data();
      let base = stringify(child, precedence);
      if let Unary::Reverse = op {
        format!("{}[{}]", text, base)
      } else if precedence < context {
        format!("{}{}", text, base)
      } else {
        format!("({}{})", text, base)
      }
    }
  }
}

// Templates that operate on lambda DCS expressions.

type OptionLambda = Option<Rc<Lambda>>;

fn cross<T>(xs: &Vec<Args<T>>, ys: &Vec<Args<T>>) -> Vec<Args<T>>
where
  T: Clone,
{
  let mut result = vec![];
  for x in xs {
    for y in ys {
      let mut map = HashMap::new();
      for (k, v) in x.iter() {
        map.insert(*k, v.clone());
      }
      for (k, v) in y.iter() {
        map.insert(*k, v.clone());
      }
      result.push(map);
    }
  }
  result
}

fn collapse(op: Binary, mut x: Vec<Rc<Lambda>>) -> OptionLambda {
  if x.len() > 1 {
    Some(Rc::new(Lambda::Binary(op, x)))
  } else {
    x.pop()
  }
}

fn expand(op: Binary, x: OptionLambda) -> Vec<Rc<Lambda>> {
  match x {
    Some(x) => {
      if let Lambda::Binary(ref y, ref ys) = *x {
        if *y == op {
          return ys.to_vec();
        }
      }
      vec![x]
    }
    None => vec![],
  }
}

struct Concat(Box<Template<OptionLambda>>, Box<Template<OptionLambda>>, Binary);

impl Template<OptionLambda> for Concat {
  fn merge(&self, xs: &Args<OptionLambda>) -> OptionLambda {
    let mut x0 = expand(self.2, self.0.merge(xs));
    let mut x1 = expand(self.2, self.1.merge(xs));
    if self.2.data().commutes || (!x0.is_empty() && !x1.is_empty()) {
      x0.append(&mut x1);
      collapse(self.2, x0)
    } else {
      None
    }
  }
  fn split(&self, x: OptionLambda) -> Vec<Args<OptionLambda>> {
    let base = expand(self.2, x);
    let commutes = self.2.data().commutes;
    let mut result = vec![];
    if !commutes && base.is_empty() {
      result.append(&mut self.0.split(None));
      result.append(&mut self.1.split(None));
      return result;
    }
    let bits: Vec<_> = if commutes {
      (0..(1 << base.len())).collect()
    } else {
      (0..(base.len() - 1)).map(|i| 1 << (i + 1) - 1).collect()
    };
    for i in bits {
      let mut xs = (vec![], vec![]);
      for (j, x) in base.iter().enumerate() {
        if (1 << j) & i > 0 {
          xs.0.push(x.clone());
        } else {
          xs.1.push(x.clone());
        }
      }
      let x0 = self.0.split(collapse(self.2, xs.0));
      let x1 = self.1.split(collapse(self.2, xs.1));
      result.append(&mut cross(&x0, &x1));
    }
    result
  }
}

struct Terminal(String);

impl Template<OptionLambda> for Terminal {
  fn merge(&self, _: &Args<OptionLambda>) -> OptionLambda {
    Some(Rc::new(Lambda::Terminal(self.0.clone())))
  }
  fn split(&self, x: OptionLambda) -> Vec<Args<OptionLambda>> {
    let matched = x.map(|y| match *y {
      Lambda::Terminal(ref z) => *z == self.0,
      _ => false,
    });
    if matched.unwrap_or(false) {
      vec![HashMap::new()]
    } else {
      vec![]
    }
  }
}

struct Variable(usize);

impl Template<OptionLambda> for Variable {
  fn merge(&self, xs: &Args<OptionLambda>) -> OptionLambda {
    xs.get(&self.0).map(|x| x.clone()).unwrap_or(None)
  }
  fn split(&self, x: OptionLambda) -> Vec<Args<OptionLambda>> {
    let mut result = HashMap::new();
    result.insert(self.0, x);
    vec![result]
  }
}

pub fn main() {
  let lambda = Some(Lambda::parse("a & b & c.d").unwrap());
  let template = Concat(
    Box::new(Concat(Box::new(Variable(0)), Box::new(Variable(1)), Binary::Conjunction)),
    Box::new(Concat(Box::new(Terminal("c".to_owned())), Box::new(Variable(2)), Binary::Join)),
    Binary::Conjunction,
  );
  for (i, option) in template.split(lambda).iter().enumerate() {
    println!("Option {}:", i);
    let mut result: Vec<_> = option
      .iter()
      .map(|(k, v)| {
        format!("    Key {}: {}", k, v.as_ref().map(|x| x.stringify()).unwrap_or("{}".to_string()))
      })
      .collect();
    result.sort();
    result.iter().for_each(|x| println!("{}", x));
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use test::Bencher;

  #[bench]
  fn parser_benchmark(b: &mut Bencher) {
    b.iter(|| Lambda::parse("Test(abc & def.ghi, jkl | (mno & pqr))").unwrap());
  }

  #[bench]
  fn template_benchmark_1(b: &mut Bencher) {
    let lambda = Some(Lambda::parse("foo & bar & baz").unwrap());
    let template = Concat(Box::new(Variable(0)), Box::new(Variable(1)), Binary::Conjunction);
    assert_eq!(template.split(lambda.clone()).len(), 8);
    b.iter(|| template.split(lambda.clone()));
  }

  #[bench]
  fn template_benchmark_2(b: &mut Bencher) {
    let lambda = Some(Lambda::parse("a & b & c.d").unwrap());
    let template = Concat(
      Box::new(Concat(Box::new(Variable(0)), Box::new(Variable(1)), Binary::Conjunction)),
      Box::new(Concat(Box::new(Terminal("c".to_owned())), Box::new(Variable(2)), Binary::Join)),
      Binary::Conjunction,
    );
    assert_eq!(template.split(lambda.clone()).len(), 12);
    b.iter(|| template.split(lambda.clone()));
  }
}
