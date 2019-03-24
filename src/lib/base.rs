pub type HashMap<K, V> = rustc_hash::FxHashMap<K, V>;
pub type HashSet<T> = rustc_hash::FxHashSet<T>;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(PartialEq)]
pub struct Error(String);

impl std::fmt::Debug for Error {
  fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
    write!(f, "{}", self.0)
  }
}

impl<T: Into<String>> From<T> for Error {
  fn from(x: T) -> Error {
    Error(x.into())
  }
}
