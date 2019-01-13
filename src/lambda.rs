use std::collections::HashMap;
use std::rc::Rc;

pub type Args<T> = HashMap<u32, Rc<T>>;

pub trait Template<T> {
  fn merge(xs: Args<T>) -> Rc<T>;
  fn split(x: Rc<T>) -> Vec<Args<T>>;
}

// A lambda DCS type used for utterance semantics.

#[derive(Clone, Copy)]
pub enum Binary {
  Conjunction,
  Disjunction,
  Join,
}

#[derive(Clone, Copy)]
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
      let ws = re(r#"\s*"#);
      let id = regexp("[a-zA-Z0-9_]+", |x| x.to_string()).skip(ws.clone());
      let st = |x| st(x).skip(ws.clone());

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

#[cfg(test)]
mod tests {
  use super::*;
  use test::Bencher;

  #[bench]
  fn benchmark(b: &mut Bencher) {
    b.iter(|| Lambda::parse("Test(foo.bar.baz, a.b.c)").unwrap());
  }

  #[test]
  fn smoke_test() {
    Lambda::parse("Test(foo.bar.baz, a.b.c)").unwrap();
  }
}
