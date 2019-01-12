use std::collections::HashMap;
use std::rc::Rc;

pub type Args<T> = HashMap<u32, Rc<T>>;

pub trait Template<T> {
  fn merge(xs: Args<T>) -> Rc<T>;
  fn split(x: Rc<T>) -> Vec<Args<T>>;
}

// A lambda DCS type used for utterance semantics.

pub enum Binary {
  Conjunction,
  Disjunction,
  Join,
}

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
  pub fn parse(input: &str) -> Result<Lambda, String> {
    unimplemented!()
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
      Binary::Conjunction => Operator { commutes: true, precedence: 2, text: " & ".to_owned() },
      Binary::Disjunction => Operator { commutes: true, precedence: 2, text: " | ".to_owned() },
      Binary::Join => Operator { commutes: false, precedence: 0, text: ".".to_owned() },
    }
  }
}

impl Unary {
  fn data(&self) -> Operator {
    match self {
      Unary::Not => Operator { commutes: false, precedence: 3, text: "R".to_owned() },
      Unary::Reverse => Operator { commutes: false, precedence: 1, text: "~".to_owned() },
    }
  }
}

fn parse(input: &str) -> Result<Lambda, String> {
  unimplemented!()
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
    Lambda::Terminal(name) => name.to_owned(),
    Lambda::Unary(op, child) => {
      let Operator { precedence, text, .. } = op.data();
      let base = stringify(child, precedence);
      if let Unary::Reverse = op {
        format!("{}[{}]", text, base)
      } else if precedence < context {
        format!("{}{}", text, base)
      } else {
        format!("{}({})", text, base)
      }
    }
  }
}
