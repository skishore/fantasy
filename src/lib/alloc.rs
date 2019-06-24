use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::UnsafeCell;

#[derive(Debug)]
struct BumpData {
  cur: *mut u8,
  end: *mut u8,
  ptr: *mut u8,
  layout: Option<Layout>,
}

pub struct BumpAllocator(UnsafeCell<BumpData>);

impl BumpAllocator {
  pub unsafe fn start(&self, size: usize) {
    let data = &mut *self.0.get();
    assert!(data.layout.is_none());
    let layout = Layout::from_size_align(size, 8).unwrap();
    data.cur = System.alloc(layout);
    data.end = data.cur.offset(size as isize);
    data.ptr = data.cur;
    data.layout = Some(layout);
    dbg!(data);
  }

  pub unsafe fn end(&self) {
    let data = &mut *self.0.get();
    dbg!(&data);
    System.dealloc(data.ptr, data.layout.clone().unwrap());
    data.layout = None;
  }
}

unsafe impl Sync for BumpAllocator {}

unsafe impl GlobalAlloc for BumpAllocator {
  unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
    let data = &mut *self.0.get();
    if data.layout.is_none() { return System.alloc(layout); };
    let mask = layout.align() - 1;
    let cur = data.cur.offset_from(std::ptr::null_mut()) as usize;
    let end = data.end.offset_from(std::ptr::null_mut()) as usize;
    let new = (cur + mask) & !mask;
    if new + layout.size() > end {
      std::ptr::null_mut()
    } else {
      let result = std::ptr::null_mut::<u8>().offset(new as isize);
      data.cur = result.offset(layout.size() as isize);
      result
    }
  }

  unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
    let data = &*self.0.get();
    if data.layout.is_none() { System.dealloc(ptr, layout) };
  }
}

pub static BUMP: BumpAllocator = BumpAllocator(UnsafeCell::new(BumpData {
  cur: std::ptr::null_mut(),
  end: std::ptr::null_mut(),
  ptr: std::ptr::null_mut(),
  layout: None,
}));
