//! An in-memory pasteboard for the logic's tests. It records every data read, so a test can say
//! exactly which representations were read and that a concealed item was not read at all.

use std::cell::RefCell;

use super::{Pasteboard, PasteboardError};

#[derive(Default)]
pub struct FakePasteboard {
    /// Each item is its `(type, bytes)` pairs, in the order they were set.
    pub items: Vec<Vec<(String, Vec<u8>)>>,
    /// How many times the pasteboard was cleared.
    pub clears: usize,
    reads: RefCell<Vec<String>>,
}

impl FakePasteboard {
    pub fn holding(items: Vec<Vec<(String, Vec<u8>)>>) -> Self {
        Self {
            items,
            ..Self::default()
        }
    }

    /// The types whose data was read, in order.
    pub fn reads(&self) -> Vec<String> {
        self.reads.borrow().clone()
    }

    pub fn data_reads(&self) -> usize {
        self.reads.borrow().len()
    }
}

impl Pasteboard for FakePasteboard {
    fn types(&self) -> Vec<String> {
        self.items
            .first()
            .map(|item| item.iter().map(|(t, _)| t.clone()).collect())
            .unwrap_or_default()
    }

    fn read(&self, ty: &str) -> Option<Vec<u8>> {
        self.reads.borrow_mut().push(ty.to_string());
        self.items
            .first()?
            .iter()
            .find(|(t, _)| t == ty)
            .map(|(_, b)| b.clone())
    }

    fn write_item(&mut self, reps: &[(String, Vec<u8>)]) -> Result<(), PasteboardError> {
        self.clears += 1;
        self.items = vec![reps.to_vec()];
        Ok(())
    }
}
