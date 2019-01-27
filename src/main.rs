#![feature(test)]

use std::rc::Rc;

extern crate regex;
extern crate rustc_hash;

#[cfg(test)]
extern crate test;

mod combine;
mod lambda;
mod parser;

fn debug((k, v): &(usize, Option<Rc<lambda::Lambda>>)) -> String {
  format!("Key {}: {}", k, v.as_ref().map(|x| x.stringify()).unwrap_or("-".to_string()))
}

fn main() {
  parser::main();
  //let grammar: Option<parser::Grammar<u32>> = None;
  //grammar.as_ref().map(|x| parser::parse(x, ""));
  //
  //let lambda = Some(lambda::Lambda::parse("R[a].b & c").unwrap());
  //let template = lambda::Lambda::template("$0.$1 & $2").unwrap();
  //for (i, option) in template.split(lambda).iter().enumerate() {
  //  let mut result: Vec<_> = option.iter().map(debug).collect();
  //  result.sort();
  //  println!("Option {}:", i);
  //  result.iter().for_each(|x| println!("    {}", x));
  //}
}
