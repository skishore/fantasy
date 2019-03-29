use super::base::Result;

#[macro_export]
macro_rules! for_each_row {
  ($a:expr, [$($b:ident),+], $c:block) => {
    let helper = super::super::lib::table::parse_table;
    for ($($b),*) in helper(&[$(stringify!($b)),*], $a)?.into_iter().map(|x| {
      match &x.as_slice() { &[$($b),*] => ($(*$b),*), _ => panic!() }
    }) $c
  }
}

pub fn parse_table<'a>(columns: &[&str], table: &'a str) -> Result<Vec<Vec<&'a str>>> {
  let lines: Vec<_> = table.split('\n').map(|x| x.trim()).collect();
  let valid: Vec<_> = lines.into_iter().filter(|x| !(x.is_empty() || x.starts_with('#'))).collect();
  if valid.len() < 3 {
    Err(format!("Invalid table. Tables must have at least one row:\n{}", table))?
  }
  let (mut prev, mut result) = (vec![], vec![]);
  let actual: Vec<_> = valid[0].split('|').map(|x| x.trim()).collect();
  if actual != columns {
    let (actual, columns) = (actual.join(", "), columns.join(", "));
    Err(format!("Invalid table. Got columns: {}; expected: {}:\n{}", actual, columns, table))?
  }
  let n = columns.len();
  for (i, row) in valid[2..].iter().enumerate() {
    let mut next: Vec<_> = row.split('|').map(|x| x.trim()).collect();
    if next.len() != n {
      Err(format!("Invalid row {}: got {} fields; expected: {}\n{}", i + 1, next.len(), n, table))?;
    }
    for j in 0..next.len() {
      let mut cell = Some(next[j]);
      if next[j] == "<" {
        cell = if j == 0 { None } else { Some(next[j - 1]) };
      } else if next[j] == "^" {
        cell = if i == 0 { None } else { Some(prev[j]) };
      }
      next[j] = cell.ok_or(format!("Invalid cell row {}, column {}:\n{}", i + 1, j + 1, table))?;
    }
    result.push(next.clone());
    prev = next;
  }
  Ok(result)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn test_error<T: std::fmt::Debug>(result: Result<T>, prefix: &str) {
    let error = format!("{:?}", result.unwrap_err());
    if !error.starts_with(prefix) {
      let error = error.split('\n').nth(0).unwrap_or("");
      panic!("Error does not match prefix:\nexpected: {:?}\n  actual: {:?}", prefix, error);
    }
  }

  #[test]
  fn test_valid_table() {
    let table = "
      # Check that top-level comments are ignored.

      key | value
      ----|------
       k1 | v1
        ^ | <
        ^ | v2
       k2 | <
    ";
    assert_eq!(
      parse_table(&["key", "value"], table).unwrap(),
      [["k1", "v1"], ["k1", "k1"], ["k1", "v2"], ["k2", "k2"]],
    );
  }

  #[test]
  fn test_empty_table() {
    let table = "
      key | value | extra
      ----|-------|------
      #k1 | ^     | <
    ";
    test_error(
      parse_table(&["key", "value", "extra"], table),
      "Invalid table. Tables must have at least one row:",
    );
  }

  #[test]
  fn test_incorrect_columns() {
    let table = "
      key | value | extra
      ----|-------|------
       k1 | v1
    ";
    test_error(
      parse_table(&["key", "extra", "value"], table),
      "Invalid table. Got columns: key, value, extra; expected: key, extra, value:",
    );
  }

  #[test]
  fn test_incorrect_number_of_columns() {
    let table = "
      key | value | extra
      ----|-------|------
       k1 | v1
    ";
    test_error(
      parse_table(&["key", "value", "extra"], table),
      "Invalid row 1: got 2 fields; expected: 3",
    );
  }

  #[test]
  fn test_invalid_redirect() {
    let table = "
      key | value | extra
      ----|-------|------
       k1 | ^     | <
    ";
    test_error(parse_table(&["key", "value", "extra"], table), "Invalid cell row 1, column 2:");
  }
}
