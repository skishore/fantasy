#![feature(test)]

use std::rc::Rc;

#[macro_use]
extern crate lazy_static;
extern crate regex;

#[cfg(test)]
extern crate test;

mod combine;
mod lambda;

fn debug((k, v): &(usize, Option<Rc<lambda::Lambda>>)) -> String {
  format!("Key {}: {}", k, v.as_ref().map(|x| x.stringify()).unwrap_or("-".to_string()))
}

fn main() {
  let lambda = Some(lambda::Lambda::parse("R[a].b & c").unwrap());
  let template = lambda::Lambda::template("$0.$1 & $2").unwrap();
  for (i, option) in template.split(lambda).iter().enumerate() {
    let mut result: Vec<_> = option.iter().map(debug).collect();
    result.sort();
    println!("Option {}:", i);
    result.iter().for_each(|x| println!("    {}", x));
  }
}
