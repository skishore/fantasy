#![allow(dead_code)]
#![feature(test)]

use jemallocator::Jemalloc;

extern crate jemallocator;
extern crate rand;
extern crate regex;
extern crate rustc_hash;

#[cfg(test)]
extern crate test;

#[global_allocator]
static GLOBAL: Jemalloc = Jemalloc;

mod hindi;
mod lib;
mod nlu;
mod payload;

use lib::base::Result;
use payload::base::Payload;
use payload::lambda::Lambda;

fn debug((k, v): &(usize, Lambda)) -> String {
  format!("Key {}: {}", k, v.stringify())
}

fn main() -> Result<()> {
  let lambda = Lambda::parse("R[a].b & c")?;
  let template = Lambda::template("$0.$1 & $2")?;
  for (i, option) in template.split(&lambda).iter().enumerate() {
    let mut result: Vec<_> = option.iter().map(debug).collect();
    result.sort();
    println!("Option {}:", i);
    result.iter().for_each(|x| println!("    {}", x));
  }
  Ok(())
}
