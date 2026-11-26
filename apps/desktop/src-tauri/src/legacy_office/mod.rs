//! A Word 97-2003 document (`.doc`) or a PowerPoint 97-2003 deck (`.ppt`) as text: both are compound files, read through
//! the directory and sector chains `outlook::layout` reads once from the bytes, with each stream's chain walk charged
//! before cfb opens it. What comes back is the document in the office page's own shape (`packages/core/src/office`):
//! headings, paragraphs, lists, tables and slides as runs of text, the pictures and objects it holds named, never drawn or
//! run. Everything is read from bytes held in memory and nothing is written anywhere. Bounded: the file, each stream, the
//! text written, the records walked and their depth, and the steps taken in all.

mod doc;
mod ppt;
mod props;
#[cfg(test)]
mod tests;

use std::io::{Cursor, Read};

use serde::Serialize;

use crate::error::ShellError;
use crate::outlook::layout::Layout;

pub struct Limits {
    /// The file.
    pub file: usize,
    /// One stream.
    pub stream: u64,
    /// Characters of text written; past it the rest is left out and said.
    pub chars: usize,
    /// Directory entries in the compound file.
    pub entries: usize,
    /// Sector-chain steps cfb is let take (`Layout::cost`).
    pub chain_steps: u64,
    /// Records, pieces, runs and characters visited in all: what reading may take in time.
    pub steps: u64,
    /// Containers inside containers in a deck.
    pub depth: usize,
    pub slides: usize,
    /// Pictures and objects named.
    pub images: usize,
    /// Paragraphs, list items, table cells and line breaks written: a file of empty paragraphs or bare breaks would
    /// otherwise make millions.
    pub nodes: usize,
}

impl Limits {
    pub const DEFAULT: Limits = Limits {
        file: 64 * 1024 * 1024,
        stream: 64 * 1024 * 1024,
        chars: 16 * 1024 * 1024,
        entries: 50_000,
        chain_steps: 200_000_000,
        steps: 50_000_000,
        depth: 64,
        slides: 10_000,
        images: 10_000,
        nodes: 500_000,
    };
}

#[derive(Debug, PartialEq, Eq)]
pub enum Fault {
    /// Not a file this reads; the reason in a sentence.
    Not(String),
    /// Locked with a password; the sentence names what it is.
    Encrypted(String),
    Damaged,
    /// Past a cap that stops the whole read; the reason in a sentence.
    TooBig(String),
}

impl Fault {
    pub fn say(&self) -> String {
        match self {
            Fault::Not(why) | Fault::TooBig(why) | Fault::Encrypted(why) => why.clone(),
            Fault::Damaged => "The file could not be read: it is damaged.".into(),
        }
    }
}

const TOO_LONG: &str = "Reading the file would take too long: its records point at one another so many times that it was stopped.";

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Fmt {
    pub b: bool,
    pub i: bool,
    pub s: bool,
}

fn is_false(b: &bool) -> bool {
    !*b
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum Inline {
    Run {
        text: String,
        #[serde(skip_serializing_if = "is_false")]
        b: bool,
        #[serde(skip_serializing_if = "is_false")]
        i: bool,
        #[serde(skip_serializing_if = "is_false")]
        s: bool,
    },
    Link {
        href: String,
        kids: Vec<Inline>,
    },
    Br,
    Image {
        image: u32,
    },
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct SlideMark {
    pub n: u32,
    pub hidden: bool,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum Block {
    Heading {
        level: u8,
        kids: Vec<Inline>,
        #[serde(skip_serializing_if = "Option::is_none")]
        slide: Option<SlideMark>,
    },
    Para {
        kids: Vec<Inline>,
    },
    List {
        ordered: bool,
        start: u32,
        items: Vec<Vec<Block>>,
    },
    Table {
        rows: Vec<Vec<Vec<Inline>>>,
    },
    Aside {
        who: String,
        when: Option<String>,
        blocks: Vec<Block>,
    },
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct Image {
    /// `held picture` or `object`, as the office page names them.
    pub what: &'static str,
    pub alt: String,
}

#[derive(Debug, Serialize, Default, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Props {
    pub title: Option<String>,
    pub subject: Option<String>,
    pub creator: Option<String>,
    pub last_modified_by: Option<String>,
    pub created: Option<String>,
    pub modified: Option<String>,
    pub application: Option<String>,
    pub pages: Option<u32>,
}

/// The file as the office page reads it.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Reading {
    /// `doc` or `ppt`, from what the file holds, whatever its name says.
    pub format: &'static str,
    pub blocks: Vec<Block>,
    pub images: Vec<Image>,
    pub props: Props,
    pub slides: u32,
    pub hidden_slides: u32,
    pub speaker_notes: u32,
    /// What the file holds that the page does not show, as words for the account.
    pub left_out: Vec<String>,
    /// Where reading stopped short at a cap, as sentences.
    pub cut: Vec<String>,
}

/// What a reader collects as it goes: pictures named, what is left out and cut, the text and steps spent.
pub struct Out<'l> {
    pub limits: &'l Limits,
    pub images: Vec<Image>,
    pub left_out: Vec<String>,
    pub cut: Vec<String>,
    pub chars: usize,
    pub steps: u64,
    pub nodes: usize,
    /// Set once the text or paragraph cap is reached: nothing more is written.
    pub full: bool,
}

impl<'l> Out<'l> {
    fn new(limits: &'l Limits) -> Self {
        Out {
            limits,
            images: Vec::new(),
            left_out: Vec::new(),
            cut: Vec::new(),
            chars: 0,
            steps: 0,
            nodes: 0,
            full: false,
        }
    }

    pub fn step(&mut self, n: u64) -> Result<(), Fault> {
        self.steps = self.steps.saturating_add(n);
        if self.steps > self.limits.steps {
            return Err(Fault::TooBig(TOO_LONG.into()));
        }
        Ok(())
    }

    pub fn leave(&mut self, what: &str) {
        if !self.left_out.iter().any(|w| w == what) {
            self.left_out.push(what.into());
        }
    }

    pub fn cut(&mut self, why: String) {
        if !self.cut.contains(&why) {
            self.cut.push(why);
        }
    }

    /// Room for `n` more characters; past the cap, says so once and refuses.
    pub fn room(&mut self, n: usize) -> bool {
        if self.full {
            return false;
        }
        if self.chars + n > self.limits.chars {
            self.full = true;
            self.cut(format!(
                "The text runs past {} MB: the rest of it is not read.",
                self.limits.chars / (1024 * 1024)
            ));
            return false;
        }
        self.chars += n;
        true
    }

    /// Room for one more paragraph, list item, cell or line break; past the cap, says so once and refuses.
    pub fn node(&mut self) -> bool {
        if self.full {
            return false;
        }
        if self.nodes >= self.limits.nodes {
            self.full = true;
            self.cut(format!(
                "The file holds more than {} paragraphs, cells and line breaks: the rest of it is not read.",
                self.limits.nodes
            ));
            return false;
        }
        self.nodes += 1;
        true
    }

    /// A picture or object named where it stands; past the cap, nothing.
    pub fn image(&mut self, what: &'static str, alt: String) -> Option<Inline> {
        if self.images.len() >= self.limits.images {
            self.cut(format!(
                "The file holds more than {} pictures and objects: those past them are not named.",
                self.limits.images
            ));
            return None;
        }
        self.images.push(Image { what, alt });
        Some(Inline::Image {
            image: self.images.len() as u32 - 1,
        })
    }
}

pub fn u16_at(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(
        b.get(at..at.checked_add(2)?)?.try_into().ok()?,
    ))
}

pub fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        b.get(at..at.checked_add(4)?)?.try_into().ok()?,
    ))
}

const CFB_MAGIC: [u8; 8] = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/// The compound file's streams, each read once and charged to the chain budget before cfb walks its chain.
pub struct Store<'a> {
    cf: cfb::CompoundFile<Cursor<&'a [u8]>>,
    layout: Layout,
    limits: &'a Limits,
    chain_steps: u64,
}

impl<'a> Store<'a> {
    fn open(bytes: &'a [u8], limits: &'a Limits) -> Result<Store<'a>, Fault> {
        let budget = crate::outlook::Limits {
            entries: limits.entries,
            ..crate::outlook::Limits::DEFAULT
        };
        let layout = Layout::parse(bytes, &budget).map_err(|e| match e {
            crate::outlook::Fault::TooBig(_) => Fault::TooBig(format!(
                "The compound file holds more than {} directory entries, or streams that claim far more bytes than it holds: it is not read.",
                limits.entries
            )),
            _ => Fault::Damaged,
        })?;
        let cf = cfb::CompoundFile::open(Cursor::new(bytes)).map_err(|_| Fault::Damaged)?;
        Ok(Store {
            cf,
            layout,
            limits,
            chain_steps: 0,
        })
    }

    /// The names of the entries at the top of the file, and whether each is a stream.
    fn top(&self) -> Vec<(String, bool)> {
        self.layout
            .kids(0)
            .map(|n| (n.name.clone(), n.stream))
            .collect()
    }

    fn has(&self, name: &str) -> bool {
        self.layout.resolve(&format!("/{name}")).is_some()
    }

    /// The stream `name` at the top of the file, whole, or None when there is none.
    fn stream(&mut self, name: &str, cap: u64) -> Result<Option<Vec<u8>>, Fault> {
        let path = format!("/{name}");
        let Some((id, hops)) = self.layout.resolve(&path) else {
            return Ok(None);
        };
        let node = self.layout.node(id);
        if !node.stream {
            return Ok(None);
        }
        let len = node.len;
        if len > cap.min(self.limits.stream) {
            return Err(Fault::TooBig(format!(
                "Its {name} stream is {} MB, past the {} MB read.",
                len.div_ceil(1024 * 1024),
                cap.min(self.limits.stream) / (1024 * 1024)
            )));
        }
        self.chain_steps = self
            .chain_steps
            .saturating_add(hops)
            .saturating_add(self.layout.cost(id, len)?);
        if self.chain_steps > self.limits.chain_steps {
            return Err(Fault::TooBig(
                "The file's sector chains are so long, or so many streams share them, that reading it would take too long."
                    .into(),
            ));
        }
        let mut s = self.cf.open_stream(&path).map_err(|_| Fault::Damaged)?;
        let mut out = Vec::with_capacity(len as usize);
        s.by_ref()
            .take(len)
            .read_to_end(&mut out)
            .map_err(|_| Fault::Damaged)?;
        if (out.len() as u64) < len {
            return Err(Fault::Damaged);
        }
        Ok(Some(out))
    }
}

impl From<crate::outlook::Fault> for Fault {
    fn from(e: crate::outlook::Fault) -> Self {
        match e {
            crate::outlook::Fault::TooBig(why) => Fault::TooBig(why),
            _ => Fault::Damaged,
        }
    }
}

/// The document or deck `bytes` hold.
pub fn read(bytes: &[u8], limits: &Limits) -> Result<Reading, Fault> {
    read_counted(bytes, limits).map(|(r, _)| r)
}

/// The document or deck, and the steps reading it took.
fn read_counted(bytes: &[u8], limits: &Limits) -> Result<(Reading, u64), Fault> {
    if bytes.len() > limits.file {
        return Err(Fault::TooBig(format!(
            "The file is {} MB, past the {} MB read.",
            bytes.len().div_ceil(1024 * 1024),
            limits.file / (1024 * 1024)
        )));
    }
    if !bytes.starts_with(&CFB_MAGIC) {
        return Err(Fault::Not(
            "Its bytes are not a Word 97-2003 document or PowerPoint deck: it does not start as a compound file does, as every one of them does."
                .into(),
        ));
    }
    let mut store = Store::open(bytes, limits)?;
    // A password-protected .docx or .pptx is a compound file holding the package encrypted, under any name.
    if store.has("EncryptionInfo") && store.has("EncryptedPackage") {
        return Err(Fault::Encrypted(
            "It is locked with a password: the document inside it is encrypted, and Marxy does not unlock files."
                .into(),
        ));
    }
    let mut out = Out::new(limits);
    let top = store.top();
    let (format, blocks, counts) = if store.has("WordDocument") {
        ("doc", doc::read(&mut store, &mut out)?, (0, 0, 0))
    } else if store.has("PowerPoint Document") {
        let d = ppt::read(&mut store, &mut out)?;
        ("ppt", d.blocks, (d.slides, d.hidden, d.notes))
    } else {
        return Err(Fault::Not(
            "It is a compound file, but it holds no Word document or PowerPoint deck.".into(),
        ));
    };
    for (name, stream) in &top {
        match (name.as_str(), stream) {
            ("Macros" | "_VBA_PROJECT_CUR" | "VBA", false) => out.leave("macros"),
            ("ObjectPool", false) => out.leave("embedded objects"),
            _ => {}
        }
    }
    let props = match store.stream("\u{5}SummaryInformation", 1024 * 1024) {
        Ok(Some(b)) => props::read(&b),
        _ => Props::default(),
    };
    let steps = out.steps;
    let reading = Reading {
        format,
        blocks,
        images: out.images,
        props,
        slides: counts.0,
        hidden_slides: counts.1,
        speaker_notes: counts.2,
        left_out: out.left_out,
        cut: out.cut,
    };
    Ok((reading, steps))
}

/// The read, any panic in it said as a damaged file: the bytes are a stranger's.
pub fn convert(bytes: &[u8]) -> Result<Reading, ShellError> {
    let read = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        read(bytes, &Limits::DEFAULT)
    }))
    .unwrap_or(Err(Fault::Damaged));
    match read {
        Ok(r) => Ok(r),
        Err(e @ Fault::TooBig(_)) => Err(ShellError::refused("", e.say())),
        Err(e) => Err(ShellError::invalid("", e.say())),
    }
}

/// `office_from_ole`: a .doc or .ppt the page already read, as a raw body, back as the document it reads as. Nothing is
/// read from or written to disk.
#[tauri::command]
pub async fn office_from_ole(request: tauri::ipc::Request<'_>) -> Result<Reading, ShellError> {
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        _ => {
            return Err(ShellError::invalid(
                "",
                "office_from_ole: expected the bytes as a raw body",
            ))
        }
    };
    crate::commands::fs::off_main(move || convert(&bytes))
        .await
        .map_err(|e| ShellError::io("", e))?
}

/// The run of text a paragraph is being built from, joined to the run before when it looks the same.
#[derive(Default)]
pub struct Line {
    pub kids: Vec<Inline>,
    units: Vec<u16>,
    fmt: Fmt,
    /// Inlines before this are not joined to: a link's words start after it.
    sealed: usize,
}

impl Line {
    /// Where the next inline will start, kept apart from those before it.
    pub fn mark(&mut self) -> usize {
        self.flush();
        self.sealed = self.kids.len();
        self.sealed
    }

    /// The inlines from `start` on, as a link to `href`.
    pub fn wrap(&mut self, start: usize, href: String) {
        self.flush();
        if start > self.kids.len() {
            return;
        }
        let kids = self.kids.split_off(start);
        if !kids.is_empty() {
            self.kids.push(Inline::Link { href, kids });
        }
        self.sealed = self.kids.len();
    }

    pub fn push(&mut self, unit: u16, fmt: &Fmt) {
        if !self.units.is_empty() && self.fmt != *fmt {
            self.flush();
        }
        if self.units.is_empty() {
            self.fmt = fmt.clone();
        }
        self.units.push(unit);
    }

    pub fn flush(&mut self) {
        if self.units.is_empty() {
            return;
        }
        let text = String::from_utf16_lossy(&self.units);
        self.units.clear();
        if self.kids.len() > self.sealed {
            if let Some(Inline::Run { text: t, b, i, s }) = self.kids.last_mut() {
                if *b == self.fmt.b && *i == self.fmt.i && *s == self.fmt.s {
                    t.push_str(&text);
                    return;
                }
            }
        }
        self.kids.push(Inline::Run {
            text,
            b: self.fmt.b,
            i: self.fmt.i,
            s: self.fmt.s,
        });
    }

    pub fn inline(&mut self, i: Inline) {
        self.flush();
        self.kids.push(i);
    }

    /// The inlines so far, the line left empty.
    pub fn take(&mut self) -> Vec<Inline> {
        self.flush();
        self.sealed = 0;
        trim(std::mem::take(&mut self.kids))
    }
}

/// Inlines with no text in them but spaces drop out; spaces at either end are trimmed.
pub fn trim(mut kids: Vec<Inline>) -> Vec<Inline> {
    let blank = |k: &Inline| matches!(k, Inline::Run { text, .. } if text.trim().is_empty());
    let lead = kids
        .iter()
        .take_while(|k| blank(k) || matches!(k, Inline::Br))
        .count();
    kids.drain(..lead);
    while kids
        .last()
        .is_some_and(|k| blank(k) || matches!(k, Inline::Br))
    {
        kids.pop();
    }
    if let Some(Inline::Run { text, .. }) = kids.first_mut() {
        *text = text.trim_start().to_string();
    }
    if let Some(Inline::Run { text, .. }) = kids.last_mut() {
        *text = text.trim_end().to_string();
    }
    kids
}
