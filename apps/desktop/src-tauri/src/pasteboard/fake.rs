//! An in-memory pasteboard for the logic's tests. It records every data read, so a test can say
//! exactly which representations were read and that a concealed item was not read at all.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use super::{Pasteboard, PasteboardError, Snapshot};

type Items = Vec<Vec<(String, Vec<u8>)>>;

#[derive(Default)]
pub struct FakePasteboard {
    /// Each item is its `(type, bytes)` pairs, in the order they were set.
    pub items: Items,
    /// How many times the pasteboard was cleared.
    pub clears: usize,
    /// Make `write_item` fail after clearing, as `writeObjects` can.
    pub fail_write: bool,
    /// A copy that lands the instant after the next snapshot is taken.
    pub lands_after_snapshot: RefCell<Option<Items>>,
    landed: RefCell<Option<Items>>,
    snapshots: Cell<usize>,
    reads: Rc<RefCell<Vec<String>>>,
}

struct FakeSnapshot {
    items: Items,
    reads: Rc<RefCell<Vec<String>>>,
}

impl Snapshot for FakeSnapshot {
    fn item_types(&self) -> Vec<Vec<String>> {
        self.items
            .iter()
            .map(|item| item.iter().map(|(t, _)| t.clone()).collect())
            .collect()
    }

    fn read(&self, ty: &str) -> Option<Vec<u8>> {
        self.reads.borrow_mut().push(ty.to_string());
        self.items
            .first()?
            .iter()
            .find(|(t, _)| t == ty)
            .map(|(_, b)| b.clone())
    }
}

impl FakePasteboard {
    pub fn holding(items: Items) -> Self {
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

    /// How many snapshots were taken.
    pub fn snapshots(&self) -> usize {
        self.snapshots.get()
    }

    /// What the pasteboard holds now, including a copy that landed after a snapshot.
    pub fn current(&self) -> Items {
        self.landed
            .borrow()
            .clone()
            .unwrap_or_else(|| self.items.clone())
    }
}

impl Pasteboard for FakePasteboard {
    fn snapshot(&self) -> Box<dyn Snapshot> {
        self.snapshots.set(self.snapshots.get() + 1);
        let snap = FakeSnapshot {
            items: self.items.clone(),
            reads: Rc::clone(&self.reads),
        };
        if let Some(next) = self.lands_after_snapshot.borrow_mut().take() {
            *self.landed.borrow_mut() = Some(next);
        }
        Box::new(snap)
    }

    fn write_item(&mut self, reps: &[(String, Vec<u8>)]) -> Result<(), PasteboardError> {
        self.clears += 1;
        self.items = Vec::new();
        if self.fail_write {
            return Err(PasteboardError::Native(
                "the pasteboard refused the item".into(),
            ));
        }
        self.items = vec![reps.to_vec()];
        Ok(())
    }
}
