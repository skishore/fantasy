#![allow(dead_code)]
#![feature(test)]

use jemallocator::Jemalloc;
use std::rc::Rc;

extern crate jemallocator;
extern crate rand;
extern crate regex;
extern crate rustc_hash;

#[cfg(test)]
extern crate test;

#[global_allocator]
static GLOBAL: Jemalloc = Jemalloc;

mod lib;
mod nlu;

use lib::lambda::Lambda;

fn debug((k, v): &(usize, Option<Rc<Lambda>>)) -> String {
  format!("Key {}: {}", k, v.as_ref().map(|x| x.stringify()).unwrap_or("-".to_string()))
}

fn main() {
  let lambda = Some(Lambda::parse("R[a].b & c").unwrap());
  let template = Lambda::template("$0.$1 & $2").unwrap();
  for (i, option) in template.split(&lambda).iter().enumerate() {
    let mut result: Vec<_> = option.iter().map(debug).collect();
    result.sort();
    println!("Option {}:", i);
    result.iter().for_each(|x| println!("    {}", x));
  }
}
