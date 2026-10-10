//! The general pasteboard through AppKit (`objc2-app-kit`). Only this file is macOS-only.
//!
//! `types` asks for the items' types, which is not a data read. `read` is `dataForType:` on the
//! first item, the one call that reads another app's data and the one macOS 15.4+ may meet with its
//! pasteboard privacy alert. Nothing here reads `changeCount` or observes the pasteboard.

use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSPasteboard, NSPasteboardItem};
use objc2_foundation::{NSArray, NSData, NSString};

use super::{Pasteboard, PasteboardError, CONCEALED};

pub struct General {
    pb: Retained<NSPasteboard>,
}

impl General {
    /// The general pasteboard, on the main thread only: AppKit's pasteboard belongs to the main
    /// thread, and a synchronous Tauri command runs there.
    pub fn new() -> Result<Self, PasteboardError> {
        MainThreadMarker::new().ok_or_else(|| {
            PasteboardError::Native("the pasteboard is used from the main thread only".into())
        })?;
        Ok(Self {
            pb: NSPasteboard::generalPasteboard(),
        })
    }
}

impl Pasteboard for General {
    fn types(&self) -> Vec<String> {
        let Some(items) = self.pb.pasteboardItems() else {
            return Vec::new();
        };
        let mut types: Vec<String> = items
            .firstObject()
            .map(|first| first.types().iter().map(|t| t.to_string()).collect())
            .unwrap_or_default();
        // A concealed marker on any item refuses the read, not only on the first.
        let concealed = NSString::from_str(CONCEALED);
        if !types.iter().any(|t| t == CONCEALED)
            && items
                .iter()
                .any(|item| item.types().iter().any(|t| *t == *concealed))
        {
            types.push(CONCEALED.to_string());
        }
        types
    }

    fn read(&self, ty: &str) -> Option<Vec<u8>> {
        let first = self.pb.pasteboardItems()?.firstObject()?;
        first
            .dataForType(&NSString::from_str(ty))
            .map(|data| data.to_vec())
    }

    fn write_item(&mut self, reps: &[(String, Vec<u8>)]) -> Result<(), PasteboardError> {
        // Build the whole item first, so a failure leaves the reader's clipboard as it was.
        let item = NSPasteboardItem::new();
        for (ty, bytes) in reps {
            if !item.setData_forType(&NSData::with_bytes(bytes), &NSString::from_str(ty)) {
                return Err(PasteboardError::Native(format!("could not set {ty}")));
            }
        }
        self.pb.clearContents();
        let objects = NSArray::from_retained_slice(&[ProtocolObject::from_retained(item)]);
        if self.pb.writeObjects(&objects) {
            Ok(())
        } else {
            Err(PasteboardError::Native(
                "the pasteboard refused the item".into(),
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pasteboard::{read_reps, write_reps, BUNDLE_ID, HTML, SOURCE, TEXT, TRANSIENT};

    impl General {
        /// libtest runs every test on a spawned thread, so the live test cannot hold a
        /// `MainThreadMarker`; it uses the pasteboard from its own thread instead.
        fn off_main_for_test() -> Self {
            Self {
                pb: NSPasteboard::generalPasteboard(),
            }
        }
    }

    /// Writes the real general pasteboard: plain + HTML as one item, reads both back exactly and
    /// reads the source type. It saves the first item's representations first and puts them back
    /// after; an item marked concealed is neither read nor overwritten.
    #[test]
    #[ignore = "writes the real pasteboard; run on a Mac: cargo test -- --ignored pasteboard_live"]
    fn pasteboard_live() {
        use objc2::sel;
        use objc2_foundation::NSObjectProtocol;

        let mut pb = General::off_main_for_test();
        if pb.pb.respondsToSelector(sel!(accessBehavior)) {
            println!("accessBehavior: {:?}", pb.pb.accessBehavior());
        }
        let before = pb.types();
        if before.iter().any(|t| t == CONCEALED) {
            println!("skipped: the clipboard holds a concealed item; it was not read or replaced");
            return;
        }
        let saved: Vec<(String, Vec<u8>)> = before
            .iter()
            .filter_map(|t| pb.read(t).map(|b| (t.clone(), b)))
            .collect();
        println!(
            "saved {} representation(s) of the reader's clipboard: {:?}",
            saved.len(),
            saved.iter().map(|(t, _)| t.as_str()).collect::<Vec<_>>()
        );

        let plain = "Marxy live check: plain é";
        let html = "<p>Marxy live check: <b>html</b> é</p>";
        let result = (|| {
            write_reps(
                &mut pb,
                &[
                    (TEXT.to_string(), plain.as_bytes().to_vec()),
                    (HTML.to_string(), html.as_bytes().to_vec()),
                ],
                true,
            )?;
            let types = pb.types();
            println!("types after write: {types:?}");
            let got = read_reps(&pb, &[TEXT.to_string(), HTML.to_string()])?;
            let source = pb.read(SOURCE);
            Ok::<_, PasteboardError>((types, got, source))
        })();

        // Put the reader's clipboard back before asserting anything.
        if saved.is_empty() {
            pb.pb.clearContents();
        } else if let Err(e) = pb.write_item(&saved) {
            println!("could not restore the clipboard: {e:?}");
        }
        println!("restored types: {:?}", pb.types());

        let (types, got, source) = result.expect("live write and read");
        assert!(types.iter().any(|t| t == TRANSIENT));
        assert_eq!(
            got,
            vec![
                (TEXT.to_string(), plain.as_bytes().to_vec()),
                (HTML.to_string(), html.as_bytes().to_vec()),
            ]
        );
        assert_eq!(source.as_deref(), Some(BUNDLE_ID.as_bytes()));
        println!(
            "read back exactly: {plain:?}, {html:?}; source = {:?}",
            String::from_utf8_lossy(&source.unwrap())
        );
    }
}
