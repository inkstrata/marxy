//! One image from the network, fetched by the shell only after the reader asked (a message's "Load them for this
//! message"; the narrow fetch), and served to the page from memory through `marxy-remote://`. The webview
//! itself never reaches the network: its CSP names no `http(s)` source, only this scheme.
//!
//! The fetch: `https:` only, to a host on the network (never this machine or a private address); `GET` with no
//! cookies, no `Referer`, no `Origin` and a fixed `User-Agent`; same-host redirects only, at most 3; 10 s in all; at
//! most 10 MB; a `Content-Type` of `image/*` and bytes that are an image. Held in memory for the session, keyed by the
//! address, never written to disk; what is held is bounded and the oldest goes first. TLS is the system's own, its
//! trust store the system's.

use std::collections::{HashMap, VecDeque};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use tauri::http::{header, Method, Request, Response, StatusCode, Uri};

use crate::error::ShellError;

pub const SCHEME: &str = "marxy-remote";
pub const MAX_BYTES: u64 = 10 * 1024 * 1024;
pub const TIMEOUT: Duration = Duration::from_secs(10);
pub const MAX_REDIRECTS: usize = 3;
/// What is held at once; past either, the oldest image goes (the page asks again only when the reader does).
const HELD_IMAGES: usize = 256;
const HELD_BYTES: usize = 128 * 1024 * 1024;

struct Held {
    url: String,
    mime: String,
    bytes: Arc<Vec<u8>>,
}

#[derive(Default)]
struct Store {
    by_id: HashMap<u64, Held>,
    by_url: HashMap<String, u64>,
    order: VecDeque<u64>,
    next: u64,
    total: usize,
}

impl Store {
    fn put(&mut self, url: &str, mime: String, bytes: Vec<u8>) -> u64 {
        if let Some(id) = self.by_url.get(url) {
            return *id;
        }
        self.next += 1;
        let id = self.next;
        self.total += bytes.len();
        self.by_url.insert(url.to_string(), id);
        self.by_id.insert(
            id,
            Held {
                url: url.to_string(),
                mime,
                bytes: Arc::new(bytes),
            },
        );
        self.order.push_back(id);
        while self.order.len() > HELD_IMAGES || (self.total > HELD_BYTES && self.order.len() > 1) {
            let Some(old) = self.order.pop_front() else {
                break;
            };
            if let Some(gone) = self.by_id.remove(&old) {
                self.total -= gone.bytes.len();
                self.by_url.remove(&gone.url);
            }
        }
        id
    }
}

fn store() -> &'static Mutex<Store> {
    static STORE: OnceLock<Mutex<Store>> = OnceLock::new();
    STORE.get_or_init(Mutex::default)
}

/// The IPv4 address an IPv6 one carries: mapped (`::ffff:a.b.c.d`), compatible (`::a.b.c.d`), NAT64 (`64:ff9b::/96`)
/// or 6to4 (`2002:aabb:ccdd::/48`). Each reaches that IPv4 host through a gateway or a tunnel.
fn embedded_v4(v6: Ipv6Addr) -> Option<Ipv4Addr> {
    let s = v6.segments();
    let tail = |hi: u16, lo: u16| {
        let [a, b] = hi.to_be_bytes();
        let [c, d] = lo.to_be_bytes();
        Ipv4Addr::new(a, b, c, d)
    };
    let mapped_or_compatible = s[..5] == [0; 5] && (s[5] == 0xffff || s[5] == 0);
    let nat64 = s[0] == 0x64 && s[1] == 0xff9b && s[2..6] == [0; 4];
    if mapped_or_compatible || nat64 {
        Some(tail(s[6], s[7]))
    } else if s[0] == 0x2002 {
        Some(tail(s[1], s[2]))
    } else {
        None
    }
}

/// Whether an address names this machine or a network of its own: a message must not make the reader's machine ask
/// its router, a printer or a local service for anything.
fn private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_documentation()
                || v4.is_multicast()
                || v4.octets()[0] == 0
                || v4.octets()[0] >= 240
                || v4.octets()[0] == 100 && (64..128).contains(&v4.octets()[1])
                || v4.octets()[0] == 198 && (v4.octets()[1] & 0xfe) == 18
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || (v6.segments()[0] & 0xfe00) == 0xfc00
                || (v6.segments()[0] & 0xffc0) == 0xfe80
                || v6.is_multicast()
                || embedded_v4(v6).is_some_and(|v4| private_ip(IpAddr::V4(v4)))
                || v6 == Ipv6Addr::LOCALHOST
        }
    }
}

/// The address's host when it may be fetched: `https:`, no user or password, a host that is on the network.
pub fn check_url(raw: &str) -> Result<String, ShellError> {
    let refuse = |why: &str| Err(ShellError::unsupported(raw, why.to_string()));
    let Ok(uri) = raw.parse::<Uri>() else {
        return refuse("not an address the app can read");
    };
    if uri.scheme_str() != Some("https") {
        return refuse(
            "only https is fetched: a plain request is readable by anyone on the network",
        );
    }
    let Some(authority) = uri.authority() else {
        return refuse("the address names no host");
    };
    if authority.as_str().contains('@') {
        return refuse("an address with a user or password in it is not fetched");
    }
    let host = authority
        .host()
        .trim_start_matches('[')
        .trim_end_matches(']');
    // `localhost.` and `localhost` are one name.
    let lower = host.to_ascii_lowercase().trim_end_matches('.').to_string();
    let ip = match ip_literal(&lower) {
        Ok(ip) => ip,
        Err(()) => return refuse(HOST_REFUSED),
    };
    if lower.is_empty()
        || lower == "localhost"
        || lower.ends_with(".localhost")
        || lower.ends_with(".local")
        || ip.is_none() && !lower.contains('.')
        || ip.is_some_and(private_ip)
    {
        return refuse(HOST_REFUSED);
    }
    Ok(lower)
}

/// One answer for every host refusal, so a refusal does not say which test the host failed.
const HOST_REFUSED: &str = "the host is this machine or a local name, not the network";

/// The address a host spells when it is one: IPv6, or IPv4 as the system's resolver reads it (`127.1`, `0x7f.0.0.1`, a
/// bare integer, octal parts). A host whose last label is a number but which is no address is Err.
fn ip_literal(host: &str) -> Result<Option<IpAddr>, ()> {
    if let Ok(ip) = host.parse::<IpAddr>() {
        return Ok(Some(ip));
    }
    let numeric = |p: &str| {
        p.strip_prefix("0x")
            .map(|h| !h.is_empty() && h.bytes().all(|b| b.is_ascii_hexdigit()))
            .unwrap_or(!p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
    };
    let parts: Vec<&str> = host.split('.').collect();
    if !parts.last().is_some_and(|p| numeric(p)) {
        return Ok(None);
    }
    let value = |p: &str| -> Option<u64> {
        if let Some(h) = p.strip_prefix("0x") {
            u64::from_str_radix(h, 16).ok()
        } else if p.len() > 1 && p.starts_with('0') {
            u64::from_str_radix(&p[1..], 8).ok()
        } else {
            p.parse().ok()
        }
    };
    if parts.len() > 4 || !parts.iter().all(|p| numeric(p)) {
        return Err(());
    }
    let nums: Option<Vec<u64>> = parts.iter().map(|p| value(p)).collect();
    let nums = nums.ok_or(())?;
    let (last, lead) = nums.split_last().ok_or(())?;
    if lead.iter().any(|&n| n > 255) || *last >= 1u64 << (8 * (4 - lead.len())) {
        return Err(());
    }
    let mut v = *last;
    for (i, n) in lead.iter().enumerate() {
        v |= n << (8 * (3 - i));
    }
    Ok(Some(IpAddr::V4(Ipv4Addr::from(v as u32))))
}

/// A redirect is followed only to the same host, over https.
pub fn same_host(from_host: &str, location: &str) -> bool {
    check_url(location).is_ok_and(|h| h == from_host)
}

/// The image's type when the answer is one: `image/*`, and bytes an image reader knows (SVG by its text, and served as
/// `image/svg+xml`, which an `<img>` never runs).
pub fn accept_image(content_type: &str, bytes: &[u8]) -> Option<String> {
    let mime = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if !mime.starts_with("image/") {
        return None;
    }
    if mime == "image/svg+xml" {
        let head = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]).to_ascii_lowercase();
        return head.contains("<svg").then_some(mime);
    }
    imagesize::blob_size(bytes).ok().map(|_| mime)
}

/// Resolves as ureq does, then refuses when any address is private, and connects to the addresses it checked: a name
/// that points at this machine or the LAN cannot pass, and a rebinding name cannot answer differently at connect time.
#[derive(Debug)]
struct PublicOnly(Arc<AtomicBool>);

impl ureq::unversioned::resolver::Resolver for PublicOnly {
    fn resolve(
        &self,
        uri: &Uri,
        config: &ureq::config::Config,
        timeout: ureq::unversioned::transport::NextTimeout,
    ) -> Result<ureq::unversioned::resolver::ResolvedSocketAddrs, ureq::Error> {
        let addrs = ureq::unversioned::resolver::DefaultResolver::default()
            .resolve(uri, config, timeout)?;
        if addrs.iter().any(|a| private_ip(a.ip())) {
            self.0.store(true, Ordering::Relaxed);
            return Err(ureq::Error::Io(std::io::ErrorKind::PermissionDenied.into()));
        }
        Ok(addrs)
    }
}

/// The agent's settings. No proxy, whatever the environment says: with one, the resolver below would resolve only
/// the proxy and the private-address check would never see the address the image comes from.
fn agent_config() -> ureq::config::Config {
    let tls = ureq::tls::TlsConfig::builder()
        .provider(ureq::tls::TlsProvider::NativeTls)
        .root_certs(ureq::tls::RootCerts::PlatformVerifier)
        .build();
    ureq::Agent::config_builder()
        .tls_config(tls)
        .timeout_global(Some(TIMEOUT))
        .max_redirects(0)
        .proxy(None)
        .https_only(true)
        .http_status_as_error(false)
        .user_agent("marxy")
        .build()
}

fn agent(blocked: &Arc<AtomicBool>) -> ureq::Agent {
    ureq::Agent::with_parts(
        agent_config(),
        ureq::unversioned::transport::DefaultConnector::new(),
        PublicOnly(blocked.clone()),
    )
}

/// Fetches `url` (or finds it held) and gives its id under `marxy-remote://`.
pub fn fetch(url: &str) -> Result<u64, ShellError> {
    if let Some(id) = store().lock().ok().and_then(|s| s.by_url.get(url).copied()) {
        return Ok(id);
    }
    let host = check_url(url)?;
    let blocked = Arc::new(AtomicBool::new(false));
    let agent = agent(&blocked);
    let mut at = url.to_string();
    for _ in 0..=MAX_REDIRECTS {
        let mut response = agent
            .get(&at)
            .header(
                "Accept",
                "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8",
            )
            .call()
            .map_err(|e| {
                if blocked.load(Ordering::Relaxed) {
                    return ShellError::unsupported(url, HOST_REFUSED);
                }
                ShellError::io(url, format!("the image could not be fetched: {e}"))
            })?;
        let status = response.status();
        if status.is_redirection() {
            let location = response
                .headers()
                .get(header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_string();
            let next = if location.starts_with('/') {
                format!("https://{host}{location}")
            } else {
                location
            };
            if !same_host(&host, &next) {
                return Err(ShellError::refused(
                    url,
                    "it sends the request on to another host, which is not followed",
                ));
            }
            at = next;
            continue;
        }
        if status != StatusCode::OK {
            return Err(ShellError::io(
                url,
                format!("the host answered {}", status.as_u16()),
            ));
        }
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        let bytes = response
            .body_mut()
            .with_config()
            .limit(MAX_BYTES)
            .read_to_vec()
            .map_err(|e| {
                ShellError::io(
                    url,
                    format!("past {} MB, or cut short: {e}", MAX_BYTES / 1048576),
                )
            })?;
        let Some(mime) = accept_image(&content_type, &bytes) else {
            return Err(ShellError::invalid(url, "the answer is not an image"));
        };
        let mut s = store()
            .lock()
            .map_err(|_| ShellError::io(url, "the images held are unreadable"))?;
        return Ok(s.put(url, mime, bytes));
    }
    Err(ShellError::refused(url, "more than three redirects"))
}

fn status(code: StatusCode) -> Response<Vec<u8>> {
    let mut response = Response::new(Vec::new());
    *response.status_mut() = code;
    response
}

/// The answer for one `marxy-remote://` request: the image held under the id its path names, else 404.
pub fn respond(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let mut response = if request.method() != Method::GET && request.method() != Method::HEAD {
        status(StatusCode::METHOD_NOT_ALLOWED)
    } else {
        let id = request
            .uri()
            .path()
            .trim_start_matches('/')
            .parse::<u64>()
            .ok();
        let held = id.and_then(|id| {
            store().lock().ok().and_then(|s| {
                s.by_id
                    .get(&id)
                    .map(|h| (h.mime.clone(), Arc::clone(&h.bytes)))
            })
        });
        match held {
            Some((mime, bytes)) => {
                let mut r = Response::new(if request.method() == Method::HEAD {
                    Vec::new()
                } else {
                    bytes.to_vec()
                });
                if let Ok(v) = mime.parse() {
                    r.headers_mut().insert(header::CONTENT_TYPE, v);
                }
                r
            }
            None => status(StatusCode::NOT_FOUND),
        }
    };
    let headers = response.headers_mut();
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        header::HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        header::HeaderValue::from_static("default-src 'none'; sandbox"),
    );
    headers.insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    response
}

pub fn handle<R: tauri::Runtime>(
    _ctx: tauri::UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    responder.respond(respond(&request));
}

#[tauri::command]
pub async fn fetch_remote_image(url: String) -> Result<String, ShellError> {
    let shown = url.clone();
    crate::commands::fs::off_main(move || fetch(&url))
        .await
        .map_err(|e| ShellError::io(&shown, e))?
        .map(|id| id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_agent_never_uses_a_proxy_from_the_environment() {
        let saved: Vec<_> = ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY"]
            .iter()
            .map(|k| (*k, std::env::var_os(k)))
            .collect();
        for (k, _) in &saved {
            std::env::set_var(k, "http://127.0.0.1:3128");
        }
        let proxy_is_none = agent_config().proxy().is_none();
        for (k, v) in saved {
            match v {
                Some(v) => std::env::set_var(k, v),
                None => std::env::remove_var(k),
            }
        }
        assert!(proxy_is_none);
    }

    #[test]
    fn addresses_that_are_not_the_public_internet_are_private() {
        let private = [
            "198.18.0.1",
            "198.19.255.255",
            "240.0.0.1",
            "255.255.255.254",
            "255.255.255.255",
            "0.1.2.3",
            "0.255.255.255",
            "224.0.0.1",
            "239.255.255.250",
            "ff02::1",
            "64:ff9b::7f00:1",
            "64:ff9b::a00:1",
            "2002:7f00:1::",
            "2002:c0a8:101::1",
            "::127.0.0.1",
            "::10.0.0.1",
            "::ffff:192.168.0.1",
        ];
        for a in private {
            assert!(private_ip(a.parse().unwrap()), "{a}");
        }
        let public = [
            "198.17.255.255",
            "198.20.0.0",
            "223.255.255.255",
            "8.8.8.8",
            "64:ff9b::808:808",
            "2002:808:808::1",
            "::ffff:8.8.8.8",
            "2606:4700::1111",
        ];
        for a in public {
            assert!(!private_ip(a.parse().unwrap()), "{a}");
        }
    }

    #[test]
    fn only_https_to_a_host_on_the_network_is_fetched() {
        assert_eq!(
            check_url("https://news.harbour.example/i/banner.png").unwrap(),
            "news.harbour.example"
        );
        for refused in [
            "http://news.harbour.example/a.png",
            "ftp://x.example/a.png",
            "https://user:pw@x.example/a.png",
            "https://localhost/a.png",
            "https://printer.local/a.png",
            "https://intranet/a.png",
            "https://127.0.0.1/a.png",
            "https://10.0.0.8/a.png",
            "https://192.168.1.1/a.png",
            "https://169.254.169.254/latest/meta-data",
            "https://[::1]/a.png",
            "https://[fd00::1]/a.png",
            "https://[::ffff:127.0.0.1]/a.png",
            "https://localhost./a.png",
            "https://printer.local./a.png",
            "https://127.1/a.png",
            "https://0x7f.0.0.1/a.png",
            "https://2130706433/a.png",
            "https://017700000001/a.png",
            "https://10.1/a.png",
            "https://127.0.0.1./a.png",
            "https://[::ffff:7f00:1]/a.png",
            "https://[::]/a.png",
            "https://0.0.0.0/a.png",
            "https://999.1.1.1.1/a.png",
            "not a url",
        ] {
            assert!(check_url(refused).is_err(), "{refused} must be refused");
        }
        assert!(check_url("https://93.184.215.14/a.png").is_ok());
        assert_eq!(
            check_url("https://example.org./a.png").unwrap(),
            "example.org"
        );
    }

    #[test]
    fn a_name_that_resolves_to_this_machine_is_refused_at_connect() {
        use ureq::unversioned::resolver::Resolver;
        let blocked = Arc::new(AtomicBool::new(false));
        let uri: Uri = "https://localhost/a.png".parse().unwrap();
        let r = PublicOnly(blocked.clone()).resolve(
            &uri,
            &ureq::config::Config::default(),
            Default::default(),
        );
        assert!(r.is_err());
        assert!(blocked.load(Ordering::Relaxed));
    }

    #[test]
    fn every_host_refusal_says_the_same_thing() {
        let say = |u: &str| check_url(u).unwrap_err().message;
        assert_eq!(say("https://localhost./a"), say("https://10.1/a"));
        assert_eq!(say("https://127.0.0.1/a"), say("https://intranet/a"));
    }

    #[test]
    fn a_redirect_is_followed_only_to_the_same_host_over_https() {
        assert!(same_host(
            "t.harbour.example",
            "https://t.harbour.example/o/2.gif"
        ));
        assert!(!same_host(
            "t.harbour.example",
            "https://tracker.example/o.gif"
        ));
        assert!(!same_host(
            "t.harbour.example",
            "http://t.harbour.example/o.gif"
        ));
    }

    #[test]
    fn only_an_image_is_accepted() {
        let png = [
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, b'I', b'H', b'D', b'R', 0,
            0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0,
        ];
        assert_eq!(
            accept_image("image/png", &png).as_deref(),
            Some("image/png")
        );
        assert_eq!(accept_image("text/html", &png), None);
        assert_eq!(
            accept_image("image/png", b"<html>not an image</html>"),
            None
        );
        assert_eq!(
            accept_image(
                "image/svg+xml; charset=utf-8",
                b"<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"/>"
            )
            .as_deref(),
            Some("image/svg+xml")
        );
        assert_eq!(
            accept_image("image/svg+xml", b"<script>alert(1)</script>"),
            None
        );
    }

    #[test]
    fn the_scheme_serves_what_is_held_and_nothing_else() {
        let id = store().lock().unwrap().put(
            "https://x.example/held.png",
            "image/png".into(),
            vec![1, 2, 3],
        );
        let ok = respond(
            &Request::builder()
                .uri(format!("http://marxy-remote.localhost/{id}"))
                .body(Vec::new())
                .unwrap(),
        );
        assert_eq!(ok.status(), StatusCode::OK);
        assert_eq!(ok.body(), &vec![1, 2, 3]);
        assert_eq!(ok.headers()[header::CONTENT_TYPE], "image/png");
        assert_eq!(ok.headers()[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
        let missing = respond(
            &Request::builder()
                .uri("http://marxy-remote.localhost/999999")
                .body(Vec::new())
                .unwrap(),
        );
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
        let post = respond(
            &Request::builder()
                .method(Method::POST)
                .uri(format!("http://marxy-remote.localhost/{id}"))
                .body(Vec::new())
                .unwrap(),
        );
        assert_eq!(post.status(), StatusCode::METHOD_NOT_ALLOWED);
        // Asked again for the same address, the held image is given back, not fetched again.
        assert_eq!(fetch("https://x.example/held.png").unwrap(), id);
    }

    #[test]
    fn what_is_held_is_bounded() {
        let mut s = Store::default();
        for i in 0..(HELD_IMAGES + 10) {
            s.put(
                &format!("https://x.example/{i}.png"),
                "image/png".into(),
                vec![0; 4],
            );
        }
        assert_eq!(s.by_id.len(), HELD_IMAGES);
        assert!(!s.by_url.contains_key("https://x.example/0.png"));
        let mut big = Store::default();
        big.put(
            "https://x.example/a",
            "image/png".into(),
            vec![0; HELD_BYTES],
        );
        big.put("https://x.example/b", "image/png".into(), vec![0; 16]);
        assert_eq!(big.by_id.len(), 1);
        assert!(big.by_url.contains_key("https://x.example/b"));
    }
}
