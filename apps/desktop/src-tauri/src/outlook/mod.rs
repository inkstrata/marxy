//! An Outlook message (`.msg`): a compound file of MAPI properties (MS-OXMSG), read into the message it would be as it
//! travels, so the mail page reads it with the one MIME parser and the one sanitiser `.eml` goes through. Everything
//! is read from bytes held in memory and nothing is written anywhere. Bounded: the message, each stream, the bytes read
//! in all (a compound file can point many streams at the same sectors), the properties, recipients and attachments of
//! each object, the depth of messages attached to messages, the RTF unpacked and the message written. A cap that cuts
//! says so in a note; a file that is not a compound file, or one that is damaged, says that instead.
//!
//! The sector chains and the directory are read from the bytes first (`layout`): every lookup is a hash lookup by
//! (parent, name), and the chain cfb would walk for a stream is charged before it opens it.

pub mod commands;
pub(crate) mod layout;
mod lzfu;
mod mime;
mod rtf;
#[cfg(test)]
mod tests;

use std::collections::{HashMap, HashSet};
use std::io::{Cursor, Read};

use encoding_rs::Encoding;
use serde::Serialize;

use mime::{Body, Part};

/// What one message may cost.
pub struct Limits {
    /// The file: past it, the message is not read (the mail page's own cap).
    pub message: usize,
    /// One stream (a property, an attachment's bytes).
    pub stream: usize,
    /// Bytes read from streams in all.
    pub read: u64,
    /// Streams opened in all; each also costs `OPEN_CHARGE` of `read`.
    pub opens: usize,
    /// Directory entries in the compound file.
    pub entries: usize,
    /// Sector-chain steps cfb is let take in all (see `layout::Layout::cost`).
    pub steps: u64,
    /// Properties of one object.
    pub properties: usize,
    pub recipients: usize,
    /// Attachments of one message.
    pub attachments: usize,
    /// Messages attached to messages.
    pub depth: usize,
    /// An RTF body, unpacked.
    pub rtf: usize,
    /// The message as written, under the mail page's cap with room for its headers.
    pub written: usize,
}

impl Limits {
    pub const DEFAULT: Limits = Limits {
        message: 64 * 1024 * 1024,
        stream: 16 * 1024 * 1024,
        read: 128 * 1024 * 1024,
        opens: 20_000,
        entries: 50_000,
        steps: 200_000_000,
        properties: 4_096,
        recipients: 1_000,
        attachments: 256,
        depth: 8,
        rtf: 16 * 1024 * 1024,
        written: 60 * 1024 * 1024,
    };
}

/// What opening a stream costs of the read budget at least: cfb walks the stream's whole sector chain (and a short
/// stream's share of the root's) on every open and refill, so a one-byte read is not cheap. Outlook's own files keep
/// about fifteen streams an object, so 20,000 opens at 4 KB is 80 MB of the 128 MB budget: a mailbox export of a
/// thousand recipients and a few hundred attachments stays under both.
const OPEN_CHARGE: u64 = 4 * 1024;

/// Of the message as written, what bodies and attachments leave for headers.
const HEADER_ROOM: usize = 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub enum Fault {
    /// Not an Outlook message at all; the reason in a sentence.
    Not(String),
    /// A compound file the reader cannot walk, or a message whose own properties do not read.
    Damaged,
    /// Past a cap that stops the whole read; the reason in a sentence.
    TooBig(String),
}

impl Fault {
    pub fn say(&self) -> String {
        match self {
            Fault::Not(why) | Fault::TooBig(why) => why.clone(),
            Fault::Damaged => "The message could not be read: the file is damaged.".into(),
        }
    }
}

/// What the page says of the message beside what the MIME carries.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Facts {
    /// `IPM.Note`, `IPM.Appointment`, …
    pub class: String,
    /// Where the body came from: `html`, `rtf-html`, `text`, `rtf-text` or `none`.
    pub body: &'static str,
    /// The code page 8-bit strings were read in, when the message names one.
    pub code_page: Option<u32>,
    /// When it arrived, written as a mail date.
    pub received: Option<String>,
    /// Whether the headers are the ones it travelled with.
    pub transport: bool,
    pub recipients: u32,
    pub attachments: u32,
    /// What a cap or a damaged part left out, a sentence each.
    pub notes: Vec<String>,
}

pub struct Converted {
    pub mime: Vec<u8>,
    pub facts: Facts,
}

#[cfg(test)]
thread_local! {
    /// The chain steps charged so far by the last read on this thread.
    static STEPS: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

const CFB_MAGIC: [u8; 8] = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

type Cf<'a> = cfb::CompoundFile<Cursor<&'a [u8]>>;

/// Property ids (MS-OXPROPS).
mod id {
    pub const MESSAGE_CLASS: u16 = 0x001A;
    pub const IMPORTANCE: u16 = 0x0017;
    pub const SUBJECT: u16 = 0x0037;
    pub const CLIENT_SUBMIT_TIME: u16 = 0x0039;
    pub const SENT_REPRESENTING_NAME: u16 = 0x0042;
    pub const SENT_REPRESENTING_ADDRTYPE: u16 = 0x0064;
    pub const SENT_REPRESENTING_EMAIL: u16 = 0x0065;
    pub const TRANSPORT_HEADERS: u16 = 0x007D;
    pub const RECIPIENT_TYPE: u16 = 0x0C15;
    pub const SENDER_NAME: u16 = 0x0C1A;
    pub const SENDER_ADDRTYPE: u16 = 0x0C1E;
    pub const SENDER_EMAIL: u16 = 0x0C1F;
    pub const DISPLAY_BCC: u16 = 0x0E02;
    pub const DISPLAY_CC: u16 = 0x0E03;
    pub const DISPLAY_TO: u16 = 0x0E04;
    pub const DELIVERY_TIME: u16 = 0x0E06;
    pub const BODY: u16 = 0x1000;
    pub const RTF_COMPRESSED: u16 = 0x1009;
    pub const HTML: u16 = 0x1013;
    pub const MESSAGE_ID: u16 = 0x1035;
    pub const REFERENCES: u16 = 0x1039;
    pub const IN_REPLY_TO: u16 = 0x1042;
    pub const DISPLAY_NAME: u16 = 0x3001;
    pub const ADDRTYPE: u16 = 0x3002;
    pub const EMAIL_ADDRESS: u16 = 0x3003;
    pub const CREATION_TIME: u16 = 0x3007;
    pub const ATTACH_DATA: u16 = 0x3701;
    pub const ATTACH_FILENAME: u16 = 0x3704;
    pub const ATTACH_METHOD: u16 = 0x3705;
    pub const ATTACH_LONG_FILENAME: u16 = 0x3707;
    pub const ATTACH_MIME_TAG: u16 = 0x370E;
    pub const ATTACH_CONTENT_ID: u16 = 0x3712;
    pub const SMTP_ADDRESS: u16 = 0x39FE;
    pub const INTERNET_CPID: u16 = 0x3FDE;
    pub const MESSAGE_CODEPAGE: u16 = 0x3FFD;
    pub const SENDER_SMTP: u16 = 0x5D01;
    pub const SENT_REPRESENTING_SMTP: u16 = 0x5D02;
    pub const RECIPIENT_DISPLAY_NAME: u16 = 0x5FF6;
}

/// The bytes `msg` is, as a message that travels, and what the page says beside it.
pub fn read(msg: &[u8], limits: &Limits) -> Result<Converted, Fault> {
    if msg.len() > limits.message {
        return Err(Fault::TooBig(format!(
            "The message is {} MB, past the {} MB read as a message.",
            msg.len().div_ceil(1024 * 1024),
            limits.message / (1024 * 1024)
        )));
    }
    if !msg.starts_with(&CFB_MAGIC) {
        return Err(Fault::Not(
            "Its bytes are not an Outlook message: it does not start as a compound file does."
                .into(),
        ));
    }
    // Before cfb sees the file: it follows chains without noticing a cycle that does not return to its start.
    let layout = layout::Layout::parse(msg, limits)?;
    let cf = cfb::CompoundFile::open(Cursor::new(msg)).map_err(|_| Fault::Damaged)?;
    #[cfg(test)]
    STEPS.with(|c| c.set(0));
    let mut r = Reader {
        cf,
        layout,
        limits,
        read: 0,
        opens: 0,
        steps: 0,
        written: 0,
        notes: Vec::new(),
        within: Vec::new(),
        recipients: 0,
        attachments: 0,
    };
    if !r.is_stream("/__properties_version1.0") {
        return Err(Fault::Not(
            "It is a compound file, but not an Outlook message: it holds no message properties."
                .into(),
        ));
    }
    let top = r.message("", 32, 0, encoding_rs::WINDOWS_1252)?;
    let mut n = 0;
    let mime = mime::write(&top.part, &mut n).ok_or(Fault::Damaged)?;
    Ok(Converted {
        mime,
        facts: Facts {
            class: top.class,
            body: top.body,
            code_page: top.code_page,
            received: top.received,
            transport: top.transport,
            recipients: r.recipients,
            attachments: r.attachments,
            notes: dedupe(r.notes),
        },
    })
}

fn dedupe(notes: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    notes
        .into_iter()
        .filter(|n| seen.insert(n.clone()))
        .collect()
}

struct Reader<'a, 'l> {
    cf: Cf<'a>,
    layout: layout::Layout,
    limits: &'l Limits,
    read: u64,
    opens: usize,
    steps: u64,
    written: usize,
    notes: Vec<String>,
    /// The attached messages being read, outermost first, so a note says which one it is about.
    within: Vec<String>,
    recipients: u32,
    attachments: u32,
}

/// One object's properties: where its streams are, the fixed-size values of its property stream, its code page.
struct Props {
    base: String,
    fixed: HashMap<u32, [u8; 8]>,
    cp: &'static Encoding,
}

impl Props {
    fn fixed(&self, id: u16, ty: u16) -> Option<[u8; 8]> {
        self.fixed.get(&(((id as u32) << 16) | ty as u32)).copied()
    }
    fn long(&self, id: u16) -> Option<u32> {
        self.fixed(id, 0x0003)
            .map(|v| u32::from_le_bytes([v[0], v[1], v[2], v[3]]))
    }
    fn time(&self, id: u16) -> Option<u64> {
        self.fixed(id, 0x0040).map(u64::from_le_bytes)
    }
    fn path(&self, id: u16, ty: u16) -> String {
        format!("{}/__substg1.0_{id:04X}{ty:04X}", self.base)
    }
}

/// What reading one message made.
struct Made {
    part: Part,
    subject: String,
    class: String,
    body: &'static str,
    code_page: Option<u32>,
    received: Option<String>,
    transport: bool,
}

enum Got {
    Missing,
    Bytes(Vec<u8>),
    Over(u64),
}

/// UTF-16LE, cut at its first NUL.
fn utf16(b: &[u8]) -> String {
    let units = b
        .as_chunks::<2>()
        .0
        .iter()
        .map(|c| u16::from_le_bytes(*c))
        .take_while(|&u| u != 0);
    char::decode_utf16(units)
        .map(|c| c.unwrap_or('\u{FFFD}'))
        .collect()
}

/// 8-bit text in `cp`, cut at its first NUL.
fn eight_bit(b: &[u8], cp: &'static Encoding) -> String {
    let end = b.iter().position(|&x| x == 0).unwrap_or(b.len());
    cp.decode(&b[..end]).0.into_owned()
}

fn mb(n: u64) -> String {
    format!("{} MB", n.div_ceil(1024 * 1024))
}

impl Reader<'_, '_> {
    fn is_stream(&self, path: &str) -> bool {
        self.layout
            .resolve(path)
            .is_some_and(|(id, _)| self.layout.node(id).stream)
    }

    fn is_storage(&self, path: &str) -> bool {
        self.layout
            .resolve(path)
            .is_some_and(|(id, _)| !self.layout.node(id).stream)
    }

    fn note(&mut self, s: String) {
        let s = match self.within.last() {
            Some(name) => format!("In the attached message {name}: {s}"),
            None => s,
        };
        self.notes.push(s);
    }

    /// The stream at `path` when it is at most `cap` bytes.
    fn stream(&mut self, path: &str, cap: usize) -> Result<Got, Fault> {
        match self.prefix(path, cap, true)? {
            Some((b, len)) if len > b.len() as u64 => Ok(Got::Over(len)),
            Some((b, _)) => Ok(Got::Bytes(b)),
            None => Ok(Got::Missing),
        }
    }

    /// The first `cap` bytes of the stream at `path` and its length; with `whole`, nothing is read of a longer one.
    fn prefix(
        &mut self,
        path: &str,
        cap: usize,
        whole: bool,
    ) -> Result<Option<(Vec<u8>, u64)>, Fault> {
        let Some((id, hops)) = self.layout.resolve(path) else {
            return Ok(None);
        };
        let node = self.layout.node(id);
        if !node.stream {
            return Ok(None);
        }
        let len = node.len;
        if whole && len > cap as u64 {
            return Ok(Some((Vec::new(), len)));
        }
        self.opens += 1;
        if self.opens > self.limits.opens {
            return Err(Fault::TooBig(format!(
                "The message opens more than {} streams, past what a message is read with.",
                self.limits.opens
            )));
        }
        let take = len.min(cap as u64);
        // cfb fills its buffer (up to 1 MB) from the whole stream whatever the caller wants of it.
        self.read += take.max(len.min(1 << 20)).max(OPEN_CHARGE);
        if self.read > self.limits.read {
            return Err(Fault::TooBig(format!(
                "The message's streams come to more than {} in all, past what a message is read with.",
                mb(self.limits.read)
            )));
        }
        self.steps = self
            .steps
            .saturating_add(hops)
            .saturating_add(self.layout.cost(id, take)?);
        #[cfg(test)]
        STEPS.with(|c| c.set(self.steps));
        if self.steps > self.limits.steps {
            return Err(Fault::TooBig(
                "The message's sector chains are so long, or so many streams share them, that reading it would take too long."
                    .into(),
            ));
        }
        let mut s = match self.cf.open_stream(path) {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                self.note(
                    "A stream the directory lists could not be found and is left out.".into(),
                );
                return Ok(None);
            }
            Err(_) => return Err(Fault::Damaged),
        };
        let mut out = Vec::with_capacity(take as usize);
        s.by_ref()
            .take(take)
            .read_to_end(&mut out)
            .map_err(|_| Fault::Damaged)?;
        if (out.len() as u64) < take {
            return Err(Fault::Damaged);
        }
        Ok(Some((out, len)))
    }

    fn bytes(&mut self, path: &str, what: &str) -> Result<Option<Vec<u8>>, Fault> {
        match self.stream(path, self.limits.stream)? {
            Got::Missing => Ok(None),
            Got::Bytes(b) => Ok(Some(b)),
            Got::Over(len) => {
                self.note(format!(
                    "{what} is {}, past the {} a part is read with, and is left out.",
                    mb(len),
                    mb(self.limits.stream as u64)
                ));
                Ok(None)
            }
        }
    }

    /// The object at `base` (the root is ""), its property stream's header `head` bytes long.
    fn props(&mut self, base: &str, head: usize, cp: &'static Encoding) -> Result<Props, Fault> {
        let path = format!("{base}/__properties_version1.0");
        let cap = head + 16 * self.limits.properties;
        let (raw, len) = self.prefix(&path, cap, false)?.unwrap_or_default();
        if len > cap as u64 {
            self.note(format!(
                "Only the first {} properties of an object are read.",
                self.limits.properties
            ));
        }
        let mut fixed = HashMap::new();
        for e in raw
            .get(head..cap.min(raw.len()))
            .unwrap_or(&[])
            .as_chunks::<16>()
            .0
        {
            let tag = u32::from_le_bytes([e[0], e[1], e[2], e[3]]);
            let mut v = [0u8; 8];
            v.copy_from_slice(&e[8..16]);
            fixed.insert(tag, v);
        }
        let mut p = Props {
            base: base.to_string(),
            fixed,
            cp,
        };
        let own = p
            .long(id::MESSAGE_CODEPAGE)
            .or_else(|| p.long(id::INTERNET_CPID))
            .and_then(crate::encoding::of_code_page);
        if let Some(e) = own {
            p.cp = e;
        }
        Ok(p)
    }

    /// A string property, held as UTF-16 (`001F`) or in the object's code page (`001E`).
    fn string(&mut self, p: &Props, id: u16) -> Result<Option<String>, Fault> {
        let what = "A text property";
        if let Some(b) = self.bytes(&p.path(id, 0x001F), what)? {
            return Ok(Some(utf16(&b)));
        }
        if let Some(b) = self.bytes(&p.path(id, 0x001E), what)? {
            return Ok(Some(eight_bit(&b, p.cp)));
        }
        Ok(None)
    }

    fn text(&mut self, p: &Props, id: u16) -> Result<String, Fault> {
        Ok(self
            .string(p, id)?
            .map(|s| mime::one_line(mime::clip(&s, mime::VALUE_MAX)))
            .unwrap_or_default())
    }

    /// A name and an address, the SMTP address before one an EX address (an Exchange directory name) stands in for.
    fn address(
        &mut self,
        p: &Props,
        name: &[u16],
        smtp: &[u16],
        email: &[(u16, u16)],
    ) -> Result<(String, String), Fault> {
        let mut n = String::new();
        for &i in name {
            n = self.text(p, i)?;
            if !n.is_empty() {
                break;
            }
        }
        for &i in smtp {
            let a = self.text(p, i)?;
            if !a.is_empty() {
                return Ok((n, a));
            }
        }
        let mut ex = String::new();
        for &(addr, kind) in email {
            let a = self.text(p, addr)?;
            if a.is_empty() {
                continue;
            }
            if self.text(p, kind)?.eq_ignore_ascii_case("EX") {
                if ex.is_empty() {
                    ex = a;
                }
                continue;
            }
            return Ok((n, a));
        }
        Ok((n, ex))
    }

    /// The storages under `base` whose names start `prefix`, in their numbers' order, at most `cap`.
    fn children(&mut self, base: &str, prefix: &str, cap: usize, what: &str) -> Vec<String> {
        let mut names: Vec<String> = match self.layout.resolve(base) {
            Some((id, _)) => self
                .layout
                .kids(id)
                .filter(|n| {
                    !n.stream
                        && n.name.starts_with(prefix)
                        && !n.name.contains(['/', char::from(92)])
                })
                .map(|n| n.name.clone())
                .collect(),
            None => Vec::new(),
        };
        names.sort();
        if names.len() > cap {
            self.note(format!("Only the first {cap} {what} are read."));
            names.truncate(cap);
        }
        names.into_iter().map(|n| format!("{base}/{n}")).collect()
    }

    fn message(
        &mut self,
        base: &str,
        head: usize,
        depth: usize,
        cp: &'static Encoding,
    ) -> Result<Made, Fault> {
        let p = self.props(base, head, cp)?;
        let own_cp = p
            .long(id::MESSAGE_CODEPAGE)
            .or_else(|| p.long(id::INTERNET_CPID));
        let class = self.text(&p, id::MESSAGE_CLASS)?;
        let subject = self.text(&p, id::SUBJECT)?;

        // Recipients.
        let mut to = Vec::new();
        let mut cc = Vec::new();
        let mut bcc = Vec::new();
        let recips = self.children(
            base,
            "__recip_version1.0_#",
            self.limits.recipients,
            "recipients",
        );
        for r in recips {
            let rp = self.props(&r, 8, p.cp)?;
            let kind = rp.long(id::RECIPIENT_TYPE).unwrap_or(1);
            // A P1 recipient is one a resend added for transport, not one the message names.
            if kind & 0x1000_0000 != 0 {
                continue;
            }
            let who = self.address(
                &rp,
                &[id::DISPLAY_NAME, id::RECIPIENT_DISPLAY_NAME],
                &[id::SMTP_ADDRESS],
                &[(id::EMAIL_ADDRESS, id::ADDRTYPE)],
            )?;
            if who.0.is_empty() && who.1.is_empty() {
                continue;
            }
            if depth == 0 {
                self.recipients += 1;
            }
            match kind & 0xF {
                2 => cc.push(who),
                3 => bcc.push(who),
                _ => to.push(who),
            }
        }
        // A message saved without recipient storages still names them for display.
        for (list, shown) in [
            (&mut to, id::DISPLAY_TO),
            (&mut cc, id::DISPLAY_CC),
            (&mut bcc, id::DISPLAY_BCC),
        ] {
            if list.is_empty() {
                let names = self.text(&p, shown)?;
                list.extend(
                    names
                        .split(';')
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .take(self.limits.recipients)
                        .map(|s| (s.to_string(), String::new())),
                );
            }
        }

        // The body: HTML as Outlook kept it, else HTML its RTF wraps, else plain text.
        let mut body = "none";
        let text = self.string(&p, id::BODY)?.filter(|t| !t.is_empty());
        let mut html = None;
        if let Some(b) = self.bytes(&p.path(id::HTML, 0x0102), "The HTML body")? {
            html = Some(html_text(&b, p.long(id::INTERNET_CPID), p.cp));
        } else if let Some(s) = self.string(&p, id::HTML)? {
            html = Some(s);
        }
        let mut text = text;
        if html.as_ref().is_some_and(|h| !h.trim().is_empty()) {
            body = "html";
        } else {
            html = None;
            if let Some(packed) = self.bytes(&p.path(id::RTF_COMPRESSED, 0x0102), "The RTF body")? {
                match lzfu::unpack(&packed, self.limits.rtf) {
                    Ok(r) => match rtf::wraps(&r) {
                        Some(rtf::Wrapped::Html) => {
                            html = Some(rtf::unwrap(&r, p.cp));
                            body = "rtf-html";
                        }
                        Some(rtf::Wrapped::Text) if text.is_none() => {
                            text = Some(rtf::unwrap(&r, p.cp));
                            body = "rtf-text";
                        }
                        _ => {}
                    },
                    Err(lzfu::Unpacked::Check) => self.note(
                        "Its compressed RTF body does not match its check (CRC): the body is not read from it."
                            .into(),
                    ),
                    Err(lzfu::Unpacked::Damaged) => self.note(
                        "Its compressed RTF body is damaged: the body is not read from it.".into(),
                    ),
                    Err(lzfu::Unpacked::TooBig(n)) => self.note(format!(
                        "Its RTF body unpacks to {}, past the {} it is read with: the body is not read from it.",
                        mb(n as u64),
                        mb(self.limits.rtf as u64)
                    )),
                }
            }
        }
        if body == "none" && text.is_some() {
            body = "text";
        }
        // The body is charged first: the attachments go before it does.
        if text
            .as_ref()
            .is_some_and(|t| !self.charge(mime::encoded_len(t.len()), "The text body"))
        {
            text = None;
        }
        if html
            .as_ref()
            .is_some_and(|h| !self.charge(mime::encoded_len(h.len()), "The HTML body"))
        {
            html = None;
        }

        // Attachments.
        let mut inline = Vec::new();
        let mut attached = Vec::new();
        let atts = self.children(
            base,
            "__attach_version1.0_#",
            self.limits.attachments,
            "attachments",
        );
        let html_lower = html.as_deref().map(str::to_ascii_lowercase);
        for (i, a) in atts.iter().enumerate() {
            let ap = self.props(a, 8, p.cp)?;
            let method = ap.long(id::ATTACH_METHOD).unwrap_or(1);
            let mut name = String::new();
            for k in [
                id::ATTACH_LONG_FILENAME,
                id::ATTACH_FILENAME,
                id::DISPLAY_NAME,
            ] {
                name = self.text(&ap, k)?;
                if !name.is_empty() {
                    break;
                }
            }
            let name = mime::clip(&name, mime::NAME_MAX).trim().to_string();
            let fallback = format!("attachment {}", i + 1);
            let shown = if name.is_empty() {
                fallback.clone()
            } else {
                name.clone()
            };
            match method {
                5 => {
                    let inner = format!("{a}/__substg1.0_3701000D");
                    if !self.is_storage(&inner) {
                        self.note(format!(
                            "{shown}, an attached message, holds no message and is left out."
                        ));
                        continue;
                    }
                    if depth + 1 > self.limits.depth {
                        self.note(format!(
                            "{shown} is a message attached {} levels deep, past the {} read, and is left out.",
                            depth + 1,
                            self.limits.depth
                        ));
                        continue;
                    }
                    self.within.push(shown.clone());
                    let before = self.written;
                    let got = self.message(&inner, 24, depth + 1, p.cp);
                    self.within.pop();
                    let got = match got {
                        Ok(g) => g,
                        Err(Fault::Damaged) => {
                            self.written = before;
                            self.note(format!(
                                "{shown}, an attached message, is damaged and is left out."
                            ));
                            continue;
                        }
                        Err(e) => return Err(e),
                    };
                    let mut n = 0;
                    let Some(bytes) = mime::write(&got.part, &mut n) else {
                        self.written = before;
                        self.note(format!(
                            "{shown}, an attached message, could not be written safely and is left out."
                        ));
                        continue;
                    };
                    // What the message charged for itself is its cost; the framing it was written with is the rest.
                    let inner_cost = self.written - before;
                    self.written = before;
                    if !self.charge(bytes.len().max(inner_cost), &shown) {
                        continue;
                    }
                    let base_name = if !name.is_empty() {
                        name.clone()
                    } else if !got.subject.is_empty() {
                        got.subject.clone()
                    } else {
                        fallback
                    };
                    // The page opens an attachment by its name: `.eml` makes this one open as a message.
                    let file = if base_name.to_ascii_lowercase().ends_with(".eml") {
                        base_name
                    } else {
                        format!("{}.eml", base_name.trim_end_matches(".msg"))
                    };
                    if depth == 0 {
                        self.attachments += 1;
                    }
                    let content_type = format!("message/rfc822; {}", mime::param("name", &file));
                    let disposition = format!("attachment; {}", mime::param("filename", &file));
                    if !self.charge_head(content_type.len() + disposition.len(), &shown) {
                        continue;
                    }
                    attached.push(Part {
                        headers: Vec::new(),
                        content_type,
                        disposition: Some(disposition),
                        cid: None,
                        body: Body::Message(bytes),
                    });
                }
                0 | 1 => {
                    let Some(data) = self.bytes(&ap.path(id::ATTACH_DATA, 0x0102), &shown)? else {
                        continue;
                    };
                    if !self.charge(mime::encoded_len(data.len()), &shown) {
                        continue;
                    }
                    let tag = self.text(&ap, id::ATTACH_MIME_TAG)?;
                    let ty = mime_type(&tag, &shown);
                    let cid = self.text(&ap, id::ATTACH_CONTENT_ID)?;
                    let cid = cid.trim_matches(['<', '>']).to_string();
                    let drawn = !cid.is_empty()
                        && html_lower.as_ref().is_some_and(|h| {
                            h.contains(&format!("cid:{}", cid.to_ascii_lowercase()))
                        });
                    if depth == 0 && !drawn {
                        self.attachments += 1;
                    }
                    let mut part =
                        Part::leaf(format!("{ty}; {}", mime::param("name", &shown)), data);
                    part.disposition = Some(format!(
                        "{}; {}",
                        if drawn { "inline" } else { "attachment" },
                        mime::param("filename", &shown)
                    ));
                    if !cid.is_empty() {
                        part.cid = Some(mime::one_line(&cid).replace(['<', '>'], ""));
                    }
                    let head = part.content_type.len()
                        + part.disposition.as_ref().map_or(0, String::len)
                        + part.cid.as_ref().map_or(0, String::len);
                    if !self.charge_head(head, &shown) {
                        continue;
                    }
                    if drawn {
                        inline.push(part);
                    } else {
                        attached.push(part);
                    }
                }
                6 => self.note(format!(
                    "{shown} is an embedded OLE object, which is not read."
                )),
                _ => self.note(format!(
                    "{shown} is a link to a file kept outside the message, which is not followed."
                )),
            }
        }

        // The parts, as a mail client would send them.
        let html_part = html.map(|h| {
            let leaf = Part::leaf("text/html; charset=utf-8".into(), h.into_bytes());
            if inline.is_empty() {
                leaf
            } else {
                let mut parts = vec![leaf];
                parts.append(&mut inline);
                Part::multi("related", parts)
            }
        });
        let text_part =
            text.map(|t| Part::leaf("text/plain; charset=utf-8".into(), t.into_bytes()));
        let shown = match (text_part, html_part) {
            (Some(t), Some(h)) => Some(Part::multi("alternative", vec![t, h])),
            (t, h) => t.or(h),
        };
        let mut root = if attached.is_empty() {
            shown.unwrap_or_else(|| Part::leaf("text/plain; charset=utf-8".into(), Vec::new()))
        } else {
            let mut parts: Vec<Part> = shown.into_iter().collect();
            parts.append(&mut attached);
            Part::multi("mixed", parts)
        };

        // The headers: the ones it travelled with when it kept them, the rest from its properties.
        let sent = p
            .time(id::CLIENT_SUBMIT_TIME)
            .or_else(|| p.time(id::CREATION_TIME))
            .and_then(mail_date);
        let received = p.time(id::DELIVERY_TIME).and_then(mail_date);
        let from = self.address(
            &p,
            &[id::SENT_REPRESENTING_NAME, id::SENDER_NAME],
            &[id::SENT_REPRESENTING_SMTP, id::SENDER_SMTP],
            &[
                (id::SENT_REPRESENTING_EMAIL, id::SENT_REPRESENTING_ADDRTYPE),
                (id::SENDER_EMAIL, id::SENDER_ADDRTYPE),
            ],
        )?;
        let sender = self.address(
            &p,
            &[id::SENDER_NAME],
            &[id::SENDER_SMTP],
            &[(id::SENDER_EMAIL, id::SENDER_ADDRTYPE)],
        )?;
        let mut ours: Vec<(&str, String)> = Vec::new();
        if let Some(d) = &sent {
            ours.push(("Date", d.clone()));
        }
        if !from.0.is_empty() || !from.1.is_empty() {
            ours.push(("From", mime::mailbox(&from.0, &from.1)));
        }
        if !sender.1.is_empty() && !sender.1.eq_ignore_ascii_case(&from.1) {
            ours.push(("Sender", mime::mailbox(&sender.0, &sender.1)));
        }
        for (name, list) in [("To", &to), ("Cc", &cc), ("Bcc", &bcc)] {
            if !list.is_empty() {
                ours.push((name, mime::mailboxes(list)));
            }
        }
        if !subject.is_empty() {
            ours.push(("Subject", mime::words(&subject)));
        }
        for (name, i) in [
            ("Message-ID", id::MESSAGE_ID),
            ("In-Reply-To", id::IN_REPLY_TO),
            ("References", id::REFERENCES),
        ] {
            let v = self.text(&p, i)?;
            if !v.is_empty() && v.is_ascii() {
                ours.push((name, v));
            }
        }
        match p.long(id::IMPORTANCE) {
            Some(0) => ours.push(("Importance", "low".into())),
            Some(2) => ours.push(("Importance", "high".into())),
            _ => {}
        }
        let travelled = self
            .string(&p, id::TRANSPORT_HEADERS)?
            .map(|t| transport_fields(&t))
            .filter(|f| !f.is_empty());
        let transport = travelled.is_some();
        let mut lines = Vec::new();
        let mut have = HashSet::new();
        for (name, field) in travelled.unwrap_or_default() {
            let bytes = field.iter().map(|l| l.len() + 2).sum();
            if self.charge_head(bytes, &name) {
                have.insert(name.to_ascii_lowercase());
                lines.extend(field);
            }
        }
        for (name, value) in ours {
            if !have.contains(&name.to_ascii_lowercase())
                && self.charge_head(name.len() + value.len() + 4, name)
            {
                lines.push(format!("{name}: {value}"));
            }
        }
        lines.push("MIME-Version: 1.0".into());
        lines.append(&mut root.headers);
        root.headers = lines;

        Ok(Made {
            part: root,
            subject,
            class: if class.is_empty() {
                "IPM.Note".into()
            } else {
                class
            },
            body,
            code_page: own_cp,
            received,
            transport,
        })
    }

    /// Whether `n` more bytes fit in the message as written; a part that does not is left out, said in a note.
    fn charge(&mut self, n: usize, what: &str) -> bool {
        self.spend(n, what, self.limits.written.saturating_sub(HEADER_ROOM))
    }

    /// The same for a header or a part's header lines, which may use the room bodies leave.
    fn charge_head(&mut self, n: usize, what: &str) -> bool {
        self.spend(n, what, self.limits.written)
    }

    fn spend(&mut self, n: usize, what: &str, cap: usize) -> bool {
        if self.written + n > cap {
            self.note(format!(
                "{what} is left out: the message would pass the {} it is read with.",
                mb(self.limits.written as u64)
            ));
            return false;
        }
        self.written += n;
        true
    }
}

/// HTML kept as bytes, in the code page the message says it travelled in, else one its own `charset` names, else the
/// message's; a byte-order mark decides first.
fn html_text(b: &[u8], cpid: Option<u32>, cp: &'static Encoding) -> String {
    let named = cpid.and_then(crate::encoding::of_code_page).or_else(|| {
        let head = String::from_utf8_lossy(&b[..b.len().min(2048)]).to_ascii_lowercase();
        let at = head.find("charset=")? + 8;
        let label: String = head[at..]
            .trim_start_matches(['"', '\''])
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
            .collect();
        Encoding::for_label(label.as_bytes())
    });
    let end = b.iter().rposition(|&x| x != 0).map_or(0, |i| i + 1);
    named.unwrap_or(cp).decode(&b[..end]).0.into_owned()
}

/// The fields of a transport header block, each its name and its lines (folds kept), up to its first empty line;
/// lines that are no header are dropped, and the fields that describe a body this message no longer has go.
fn transport_fields(t: &str) -> Vec<(String, Vec<String>)> {
    const BODY: &[&str] = &[
        "content-type",
        "content-transfer-encoding",
        "content-disposition",
        "content-id",
        "content-description",
        "mime-version",
    ];
    let mut out: Vec<(String, Vec<String>)> = Vec::new();
    let mut size = 0usize;
    for line in t.split('\n') {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            if out.is_empty() {
                continue;
            }
            break;
        }
        size += line.len();
        if size > 128 * 1024 {
            break;
        }
        let line: String = line
            .chars()
            .map(|c| if c.is_control() && c != '\t' { ' ' } else { c })
            .collect();
        if line.starts_with([' ', '\t']) {
            if let Some(last) = out.last_mut() {
                if !line.trim().is_empty() {
                    last.1.push(line);
                }
            }
            continue;
        }
        let Some(colon) = line.find(':') else {
            continue;
        };
        let name = &line[..colon];
        if name.is_empty() || !name.bytes().all(|b| (0x21..0x7f).contains(&b) && b != b':') {
            continue;
        }
        out.push((name.to_string(), vec![line.clone()]));
    }
    out.retain(|(n, _)| !BODY.contains(&n.to_ascii_lowercase().as_str()));
    out
}

const DAYS: [&str; 7] = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"];
const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// A FILETIME (100 ns since 1601) as a mail date in UTC; None for zero or a time outside the years 1970 to 9999.
fn mail_date(ft: u64) -> Option<String> {
    let secs = (ft / 10_000_000).checked_sub(11_644_473_600)? as i64;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    // Civil from days (H. Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    if year > 9999 {
        return None;
    }
    Some(format!(
        "{}, {day:02} {} {year} {:02}:{:02}:{:02} +0000",
        DAYS[days.rem_euclid(7) as usize],
        MONTHS[(month - 1) as usize],
        rem / 3600,
        rem / 60 % 60,
        rem % 60
    ))
}

/// The attachment's own type when it says one, else one its name's extension names, else bytes.
fn mime_type(tag: &str, name: &str) -> String {
    let tag = tag.trim().to_ascii_lowercase();
    let ok = |s: &str| {
        s.split_once('/').is_some_and(|(a, b)| {
            [a, b].iter().all(|x| {
                !x.is_empty()
                    && x.bytes()
                        .all(|c| c.is_ascii_alphanumeric() || b"!#$&^_.+-".contains(&c))
            })
        })
    };
    if ok(&tag) {
        return tag;
    }
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase());
    match ext.as_deref() {
        Some("pdf") => "application/pdf",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("txt") => "text/plain",
        Some("csv") => "text/csv",
        Some("htm" | "html") => "text/html",
        Some("ics") => "text/calendar",
        Some("zip") => "application/zip",
        Some("eml") => "message/rfc822",
        Some("docx") => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        Some("xlsx") => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        Some("pptx") => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        Some("msg") => "application/vnd.ms-outlook",
        _ => "application/octet-stream",
    }
    .to_string()
}
