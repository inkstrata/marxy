use super::*;
use crate::commands::fs::{
    image_size_in, read_dir_in, read_file_in, read_head_in, real_path_in, stat_in,
};
use std::fs;
use std::path::PathBuf;

/// A scratch tree: `inside/` (made a root by each test that wants one) and `outside/` beside it.
struct Tree(PathBuf);

impl Tree {
    fn new(name: &str) -> Tree {
        let base = std::env::temp_dir().join(format!("marxy-scope-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("inside/sub")).unwrap();
        fs::create_dir_all(base.join("outside")).unwrap();
        fs::write(base.join("inside/a.md"), b"# a\n").unwrap();
        fs::write(base.join("inside/sub/b.md"), b"# b\n").unwrap();
        fs::write(base.join("inside/.env"), b"KEY=1\n").unwrap();
        fs::write(base.join("outside/secret.md"), b"# secret\n").unwrap();
        Tree(dunce::canonicalize(&base).unwrap())
    }

    fn s(&self, rel: &str) -> String {
        self.0.join(rel).to_string_lossy().into_owned()
    }
}

impl Drop for Tree {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn rooted(t: &Tree) -> RwLock<OpenedSet> {
    let set = RwLock::new(OpenedSet::default());
    open_root(&set, &t.s("inside")).unwrap();
    set
}

fn code<T: std::fmt::Debug>(r: Result<T, ShellError>) -> String {
    r.map(|_| ()).map_err(|e| e.code).err().unwrap_or_default()
}

#[test]
fn a_root_the_index_lets_go_of_is_no_longer_read() {
    let t = Tree::new("forgotten");
    let set = RwLock::new(OpenedSet::default());
    open_index_root(&set, &t.s("inside")).unwrap();
    assert!(read_file_in(&set, &t.s("inside/a.md")).is_ok());
    drop_root(&set, &t.s("inside"));
    assert_eq!(code(read_file_in(&set, &t.s("inside/a.md"))), "outside");
    assert_eq!(
        code(read_head_in(&set, &t.s("inside/sub/b.md"), 3)),
        "outside"
    );
}

#[test]
fn a_root_the_reader_also_chose_stays_when_the_index_lets_go_of_it() {
    let t = Tree::new("kept");
    let set = RwLock::new(OpenedSet::default());
    open_index_root(&set, &t.s("inside")).unwrap();
    open_root(&set, &t.s("inside")).unwrap();
    drop_root(&set, &t.s("inside"));
    assert!(read_file_in(&set, &t.s("inside/a.md")).is_ok());
    let held_by_index = RwLock::new(OpenedSet::default());
    open_index_root(&held_by_index, &t.s("inside")).unwrap();
    drop_root(&held_by_index, &t.s("inside"));
    assert_eq!(
        code(read_file_in(&held_by_index, &t.s("inside/a.md"))),
        "outside"
    );
}

#[test]
fn a_file_under_a_chosen_root_is_read_and_one_beside_it_is_refused() {
    let t = Tree::new("inside");
    let set = rooted(&t);
    assert_eq!(
        read_file_in(&set, &t.s("inside/sub/b.md")).unwrap(),
        b"# b\n"
    );
    // A dot file under the root is the reader's to read; serving it to a document is another matter.
    assert_eq!(read_head_in(&set, &t.s("inside/.env"), 3).unwrap(), b"KEY");
    assert_eq!(
        code(read_file_in(&set, &t.s("outside/secret.md"))),
        "outside"
    );
    assert_eq!(
        code(read_head_in(&set, &t.s("outside/secret.md"), 4)),
        "outside"
    );
}

#[test]
fn nothing_is_in_scope_before_the_reader_opens_or_chooses_it() {
    let t = Tree::new("empty");
    let set = RwLock::new(OpenedSet::default());
    let a = t.s("inside/a.md");
    assert_eq!(code(read_file_in(&set, &a)), "outside");
    assert_eq!(code(read_head_in(&set, &a, 4)), "outside");
    assert_eq!(code(read_dir_in(&set, t.s("inside"))), "outside");
    assert_eq!(code(stat_in(&set, a.clone())), "outside");
    assert_eq!(code(real_path_in(&set, a.clone())), "outside");
    assert_eq!(code(image_size_in(&set, a.clone())), "outside");
    for need in [
        Need::Read,
        Need::List,
        Need::Folder,
        Need::Write,
        Need::Create,
    ] {
        assert_eq!(code(check(&set, &a, need)), "outside", "{need:?}");
    }
}

#[test]
fn a_file_the_reader_opened_is_read_but_its_neighbours_are_not() {
    let t = Tree::new("opened");
    let set = RwLock::new(OpenedSet::default());
    open_file(&set, &t.s("outside/secret.md"));
    assert_eq!(
        read_file_in(&set, &t.s("outside/secret.md")).unwrap(),
        b"# secret\n"
    );
    fs::write(t.0.join("outside/other.md"), b"x").unwrap();
    assert_eq!(
        code(read_file_in(&set, &t.s("outside/other.md"))),
        "outside"
    );
    // Its folder may be listed (the breadcrumbs, its neighbours' names) and a new file made there (Fork) ...
    assert!(read_dir_in(&set, t.s("outside")).is_ok());
    assert!(check(&set, &t.s("outside/secret (fork).md"), Need::Create).is_ok());
    // ... but not an existing neighbour replaced.
    assert_eq!(
        code(check(&set, &t.s("outside/other.md"), Need::Write)),
        "outside"
    );
    assert!(check(&set, &t.s("outside/secret.md"), Need::Write).is_ok());
}

#[test]
fn reading_a_head_never_makes_a_file_servable() {
    let t = Tree::new("index");
    let set = rooted(&t);
    read_head_in(&set, &t.s("inside/.env"), 8).unwrap();
    read_file_in(&set, &t.s("inside/a.md")).unwrap();
    // A root is the commands' only: `marxy-file://` serves neither, since no folder was scoped for a document.
    let served = |rel: &str| file_scheme::resolve(&set, Path::new(&t.s(rel)));
    assert_eq!(served("inside/.env"), Err(Refusal::Outside));
    assert_eq!(served("inside/a.md"), Err(Refusal::Outside));
    open_file(&set, &t.s("inside/a.md"));
    assert!(
        served("inside/a.md").is_ok(),
        "once the reader opens it, it is served"
    );
}

#[test]
fn a_dot_dot_is_refused_even_when_it_lands_inside() {
    let t = Tree::new("dotdot");
    let set = rooted(&t);
    let sep = std::path::MAIN_SEPARATOR;
    let back_in = format!("{}{sep}sub{sep}..{sep}a.md", t.s("inside"));
    assert_eq!(code(read_file_in(&set, &back_in)), "outside");
    let out = format!("{}{sep}..{sep}outside{sep}secret.md", t.s("inside"));
    assert_eq!(code(read_file_in(&set, &out)), "outside");
    assert_eq!(
        code(read_dir_in(&set, format!("{}{sep}..", t.s("inside")))),
        "outside"
    );
}

/// A directory link: a symlink where the platform allows one, else (Windows without Developer Mode) a junction.
fn link_dir(target: &Path, link: &Path) -> bool {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link).is_ok()
    }
    #[cfg(windows)]
    {
        if std::os::windows::fs::symlink_dir(target, link).is_ok() {
            return true;
        }
        std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .output()
            .is_ok_and(|o| o.status.success())
    }
}

#[test]
fn a_link_inside_a_root_that_leads_out_is_refused() {
    let t = Tree::new("link");
    let set = rooted(&t);
    let link = t.0.join("inside").join("escape");
    assert!(
        link_dir(&t.0.join("outside"), &link),
        "could not make a link or a junction"
    );
    let through = link.join("secret.md").to_string_lossy().into_owned();
    assert_eq!(code(read_file_in(&set, &through)), "outside");
    assert_eq!(
        code(read_dir_in(&set, link.to_string_lossy().into_owned())),
        "outside"
    );
    assert_eq!(code(check(&set, &through, Need::Write)), "outside");
    assert_eq!(
        code(check(
            &set,
            &link.join("new.md").to_string_lossy(),
            Need::Create
        )),
        "outside",
        "a new name through the link is judged by its real folder"
    );
}

#[test]
fn a_root_reached_through_a_link_is_held_by_both_spellings() {
    let t = Tree::new("link-root");
    let link = t.0.join("outside").join("to-inside");
    assert!(
        link_dir(&t.0.join("inside"), &link),
        "could not make a link or a junction"
    );
    let set = RwLock::new(OpenedSet::default());
    open_root(&set, &link.to_string_lossy()).unwrap();
    assert!(read_file_in(&set, &link.join("a.md").to_string_lossy()).is_ok());
    assert!(read_file_in(&set, &t.s("inside/a.md")).is_ok());
    assert_eq!(
        code(read_file_in(&set, &t.s("outside/secret.md"))),
        "outside"
    );
}

#[test]
fn the_repository_marker_above_an_opened_file_may_be_probed_and_nothing_else_there() {
    let t = Tree::new("git");
    fs::create_dir_all(t.0.join(".git")).unwrap();
    fs::write(t.0.join(".git/HEAD"), b"ref: refs/heads/main\n").unwrap();
    fs::write(t.0.join("README.md"), b"top\n").unwrap();
    let set = RwLock::new(OpenedSet::default());
    open_file(&set, &t.s("inside/a.md"));
    let sep = std::path::MAIN_SEPARATOR;
    assert!(read_head_in(&set, &t.s(&format!(".git{sep}HEAD")), 64).is_ok());
    assert_eq!(code(read_file_in(&set, &t.s("README.md"))), "outside");
    assert_eq!(
        code(read_file_in(&set, &t.s(&format!(".git{sep}config")))),
        "outside"
    );
    // A folder above may be statted (the breadcrumbs), never listed or read.
    assert!(stat_in(&set, t.0.to_string_lossy().into_owned()).is_ok());
    assert_eq!(
        code(read_dir_in(&set, t.0.to_string_lossy().into_owned())),
        "outside"
    );
    // `.git` is a denied name: in scope, and still said to be no file, as `read_dir` omits it.
    assert!(stat_in(&set, t.s(".git")).unwrap().is_none());
}

#[test]
fn a_missing_file_the_reader_opened_says_not_found_and_a_missing_one_outside_says_outside() {
    let t = Tree::new("missing");
    let set = RwLock::new(OpenedSet::default());
    open_file(&set, &t.s("inside/gone.md"));
    assert_eq!(
        code(read_file_in(&set, &t.s("inside/gone.md"))),
        "not-found"
    );
    assert_eq!(
        code(read_head_in(&set, &t.s("inside/gone.md"), 1)),
        "not-found"
    );
    assert_eq!(code(read_file_in(&set, &t.s("outside/gone.md"))), "outside");
    // A Save as name is the reader's to write before any file is there.
    assert!(check(&set, &t.s("inside/gone.md"), Need::Write).is_ok());
    let root = rooted(&t);
    assert_eq!(
        stat_in(&root, t.s("inside/gone.md"))
            .unwrap()
            .map(|s| s.path),
        None
    );
}

#[test]
fn marxys_own_folders_are_always_in_scope() {
    let t = Tree::new("app");
    let set = RwLock::new(OpenedSet::default());
    open_app_folder(&set, &t.0.join("outside"));
    assert!(read_file_in(&set, &t.s("outside/secret.md")).is_ok());
    assert!(check(&set, &t.s("outside/history.json"), Need::Write).is_ok());
    assert_eq!(code(read_file_in(&set, &t.s("inside/a.md"))), "outside");
}

#[test]
fn a_drive_or_share_root_is_never_a_root_and_a_file_is_not_one() {
    let temp = dunce::canonicalize(std::env::temp_dir()).unwrap();
    let top = temp
        .ancestors()
        .last()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let set = RwLock::new(OpenedSet::default());
    assert_eq!(code(open_root(&set, &top)), "outside");
    let t = Tree::new("root-file");
    assert_eq!(code(open_root(&set, &t.s("inside/a.md"))), "outside");
    assert_eq!(code(open_root(&set, "relative/dir")), "invalid");
}

#[test]
fn a_relative_path_is_invalid_before_scope_is_asked() {
    let set = RwLock::new(OpenedSet::default());
    for need in [
        Need::Read,
        Need::List,
        Need::Folder,
        Need::Write,
        Need::Create,
    ] {
        assert_eq!(code(check(&set, "archive-entry:4/notes", need)), "invalid");
    }
}

#[cfg(windows)]
#[test]
fn on_windows_a_path_is_held_in_any_case_and_by_its_verbatim_spelling() {
    let t = Tree::new("case");
    let set = rooted(&t);
    let upper = t.s("inside/sub/b.md").to_uppercase();
    assert_eq!(read_file_in(&set, &upper).unwrap(), b"# b\n");
    let verbatim = format!(r"\\?\{}", t.s(r"inside\a.md"));
    assert!(read_file_in(&set, &verbatim).is_ok());
    let opened = RwLock::new(OpenedSet::default());
    open_file(&opened, &t.s(r"outside\secret.md"));
    assert!(read_file_in(&opened, &t.s(r"OUTSIDE\SECRET.MD")).is_ok());
}

#[cfg(windows)]
#[test]
fn on_windows_a_share_or_device_path_outside_is_refused_without_asking_the_disk() {
    let t = Tree::new("unc");
    let set = rooted(&t);
    let started = std::time::Instant::now();
    for raw in [
        r"\\marxy-no-such-host.invalid\share\a.md",
        r"\\?\UNC\marxy-no-such-host.invalid\share\a.md",
        r"\\.\PhysicalDrive0",
        r"\\?\GLOBALROOT\Device\HarddiskVolume1\x",
    ] {
        assert_eq!(code(read_file_in(&set, raw)), "outside", "{raw}");
        assert_eq!(code(read_dir_in(&set, raw.into())), "outside", "{raw}");
    }
    // A host lookup would take seconds; a refusal by spelling takes none.
    assert!(started.elapsed() < std::time::Duration::from_secs(2));
}

#[test]
fn a_root_is_read_only_and_a_picked_folder_is_written() {
    let t = Tree::new("write");
    let set = rooted(&t);
    assert!(read_file_in(&set, &t.s("inside/a.md")).is_ok());
    assert_eq!(
        code(check(&set, &t.s("inside/a.md"), Need::Write)),
        "outside"
    );
    assert_eq!(
        code(check(&set, &t.s("inside/new.md"), Need::Create)),
        "outside"
    );
    // A folder scoped for a document (its images) is read-only too.
    set.write()
        .unwrap()
        .add_folder(Path::new(&t.s("inside")), t.0.join("inside"));
    assert_eq!(
        code(check(&set, &t.s("inside/a.md"), Need::Write)),
        "outside"
    );
    // The file the reader opened there is theirs to save.
    open_file(&set, &t.s("inside/a.md"));
    assert!(check(&set, &t.s("inside/a.md"), Need::Write).is_ok());
    assert_eq!(
        code(check(&set, &t.s("inside/sub/b.md"), Need::Write)),
        "outside"
    );
    let picked = RwLock::new(OpenedSet::default());
    open_picked_folder(&picked, &t.s("outside")).unwrap();
    let at = check(&picked, &t.s("outside/new.md"), Need::Create).unwrap();
    let held = hold_parent(&picked, &at, Need::Create).unwrap();
    crate::atomic_write::write_new(&at, b"made").unwrap();
    drop(held);
    assert_eq!(
        fs::read(t.0.join("outside").join("new.md")).unwrap(),
        b"made"
    );
    assert_eq!(
        code(open_picked_folder(&picked, &t.s("inside/a.md"))),
        "outside"
    );
}

#[test]
fn a_folder_swapped_for_a_link_after_the_check_is_refused_by_the_write_hold() {
    let t = Tree::new("swap");
    let set = RwLock::new(OpenedSet::default());
    open_picked_folder(&set, &t.s("inside")).unwrap();
    let target = t.0.join("inside").join("sub").join("new.md");
    let at = check(&set, &target.to_string_lossy(), Need::Create).unwrap();
    // Between the check and the write, `sub` becomes a link to a folder outside.
    fs::remove_dir_all(t.0.join("inside").join("sub")).unwrap();
    assert!(
        link_dir(&t.0.join("outside"), &t.0.join("inside").join("sub")),
        "could not make a link or a junction"
    );
    assert_eq!(code(hold_parent(&set, &at, Need::Create)), "outside");
    assert!(!t.0.join("outside").join("new.md").exists());
}

#[cfg(windows)]
#[test]
fn on_windows_a_held_folder_cannot_be_renamed_away_while_the_write_runs() {
    let t = Tree::new("hold");
    let set = RwLock::new(OpenedSet::default());
    open_picked_folder(&set, &t.s("inside")).unwrap();
    let at = check(
        &set,
        &t.0.join("inside")
            .join("sub")
            .join("new.md")
            .to_string_lossy(),
        Need::Create,
    )
    .unwrap();
    let held = hold_parent(&set, &at, Need::Create).unwrap();
    assert!(
        fs::rename(t.0.join("inside").join("sub"), t.0.join("moved")).is_err(),
        "the folder moved while held"
    );
    // A write inside the held folder still renames into place.
    crate::atomic_write::write_new(&at, b"x").unwrap();
    drop(held);
    assert!(fs::rename(t.0.join("inside").join("sub"), t.0.join("moved")).is_ok());
}

#[test]
fn a_repository_probe_stops_at_the_nearest_repository() {
    let t = Tree::new("nearest");
    for dir in [t.0.join(".git"), t.0.join("inside").join(".git")] {
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("HEAD"),
            b"ref: refs/heads/main
",
        )
        .unwrap();
    }
    let set = RwLock::new(OpenedSet::default());
    open_file(&set, &t.s("inside/sub/b.md"));
    let sep = std::path::MAIN_SEPARATOR;
    assert!(read_head_in(&set, &t.s(&format!("inside{sep}.git{sep}HEAD")), 8).is_ok());
    assert_eq!(
        code(read_head_in(&set, &t.s(&format!(".git{sep}HEAD")), 8)),
        "outside"
    );
}

/// Everything the set holds, to show a read added nothing.
fn holding(set: &RwLock<OpenedSet>) -> String {
    format!("{:?}", set.read().unwrap())
}

#[test]
fn a_head_read_in_scope_or_refused_adds_nothing_to_the_set() {
    let t = Tree::new("head-adds-nothing");
    fs::create_dir_all(t.0.join(".git")).unwrap();
    fs::write(t.0.join(".git/HEAD"), b"ref: refs/heads/main\n").unwrap();
    let set = rooted(&t);
    let before = holding(&set);
    let sep = std::path::MAIN_SEPARATOR;
    read_head_in(&set, &t.s("inside/a.md"), 8).unwrap();
    read_head_in(&set, &t.s(&format!(".git{sep}HEAD")), 8).unwrap();
    assert_eq!(
        code(read_head_in(&set, &t.s("outside/secret.md"), 8)),
        "outside"
    );
    assert_eq!(
        crate::detect::detect_in(&set, &t.s("outside/secret.md")),
        None
    );
    assert!(crate::detect::detect_in(&set, &t.s("inside/a.md")).is_some());
    assert_eq!(holding(&set), before);
    // The probe above the root did not make the folder it probed readable.
    fs::write(t.0.join("README.md"), b"top\n").unwrap();
    assert_eq!(code(read_head_in(&set, &t.s("README.md"), 8)), "outside");
}

#[test]
fn a_head_through_a_link_inside_a_root_that_leads_out_is_refused() {
    let t = Tree::new("head-link");
    let set = rooted(&t);
    let link = t.0.join("inside").join("escape");
    assert!(
        link_dir(&t.0.join("outside"), &link),
        "could not make a link or a junction"
    );
    let through = link.join("secret.md").to_string_lossy().into_owned();
    assert_eq!(code(read_head_in(&set, &through, 8)), "outside");
    assert_eq!(crate::detect::detect_in(&set, &through), None);
}

#[test]
fn a_repository_marker_that_is_a_link_out_is_not_probed() {
    let t = Tree::new("head-git-link");
    fs::write(t.0.join("outside/HEAD"), b"not a repository\n").unwrap();
    assert!(
        link_dir(&t.0.join("outside"), &t.0.join(".git")),
        "could not make a link or a junction"
    );
    let set = RwLock::new(OpenedSet::default());
    open_file(&set, &t.s("inside/a.md"));
    let sep = std::path::MAIN_SEPARATOR;
    assert_eq!(
        code(read_head_in(&set, &t.s(&format!(".git{sep}HEAD")), 8)),
        "outside"
    );
}

#[test]
fn a_folder_swapped_for_a_link_after_the_check_is_refused_by_the_head_read() {
    let t = Tree::new("head-swap");
    fs::write(t.0.join("outside/b.md"), b"# secret b\n").unwrap();
    let set = rooted(&t);
    let path = t.s("inside/sub/b.md");
    let canonical = check(&set, &path, Need::Read).unwrap();
    // Between the check and the open, `sub` becomes a link to a folder outside holding a `b.md`.
    fs::remove_dir_all(t.0.join("inside").join("sub")).unwrap();
    assert!(
        link_dir(&t.0.join("outside"), &t.0.join("inside").join("sub")),
        "could not make a link or a junction"
    );
    assert_eq!(
        crate::commands::fs::read_head_bytes(&path, 64).unwrap(),
        b"# secret b\n",
        "an open by the path alone reads the file outside"
    );
    assert_eq!(
        code(crate::commands::fs::read_head_judged(&path, &canonical, 64)),
        "outside"
    );
    // Asked again, the check itself sees where the path now leads.
    assert_eq!(code(read_head_in(&set, &path, 64)), "outside");
}

/// A PNG header saying the image is `w` by `h`.
fn png(w: u32, h: u32) -> Vec<u8> {
    let mut b = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
    b.extend_from_slice(&w.to_be_bytes());
    b.extend_from_slice(&h.to_be_bytes());
    b.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
    b
}

/// Turns `inside/sub` into a link to `outside`, as a folder swapped between the check and the open would be.
fn swap_sub_out(t: &Tree) {
    fs::remove_dir_all(t.0.join("inside").join("sub")).unwrap();
    assert!(
        link_dir(&t.0.join("outside"), &t.0.join("inside").join("sub")),
        "could not make a link or a junction"
    );
}

#[test]
fn a_folder_swapped_for_a_link_after_the_check_is_refused_by_the_image_measure() {
    use crate::commands::fs::{image_size_blocking, image_size_judged};
    let t = Tree::new("image-swap");
    fs::write(t.0.join("inside/sub/p.png"), png(1, 1)).unwrap();
    fs::write(t.0.join("outside/p.png"), png(77, 55)).unwrap();
    let set = rooted(&t);
    let path = t.s("inside/sub/p.png");
    let canonical = check(&set, &path, Need::Read).unwrap();
    assert_eq!(
        image_size_judged(path.clone(), &canonical)
            .unwrap()
            .unwrap()
            .width,
        1
    );
    swap_sub_out(&t);
    assert_eq!(
        image_size_blocking(path.clone()).unwrap().unwrap().width,
        77,
        "a measure by the path alone reads the header outside"
    );
    assert_eq!(code(image_size_judged(path.clone(), &canonical)), "outside");
    assert_eq!(code(image_size_in(&set, path)), "outside");
}

#[test]
fn a_folder_swapped_for_a_link_after_the_check_is_refused_by_the_stat() {
    use crate::commands::fs::{stat_file_blocking, stat_judged};
    let t = Tree::new("stat-swap");
    fs::write(t.0.join("outside/b.md"), b"# a longer secret b\n").unwrap();
    let set = rooted(&t);
    let path = t.s("inside/sub/b.md");
    let canonical = check(&set, &path, Need::List).unwrap();
    assert_eq!(
        stat_judged(path.clone(), &canonical).unwrap().unwrap().size,
        4
    );
    swap_sub_out(&t);
    assert_eq!(
        stat_file_blocking(path.clone()).unwrap().unwrap().size,
        20,
        "a stat by the path alone reports the file outside"
    );
    assert_eq!(code(stat_judged(path.clone(), &canonical)), "outside");
}

#[test]
fn a_folder_swapped_for_a_link_after_the_check_is_refused_by_the_listing() {
    use crate::commands::fs::{read_dir_blocking, read_dir_judged};
    let t = Tree::new("dir-swap");
    let set = rooted(&t);
    let dir = t.s("inside/sub");
    let canonical = check(&set, &dir, Need::Folder).unwrap();
    assert_eq!(read_dir_judged(&dir, &canonical).unwrap().len(), 1);
    swap_sub_out(&t);
    assert!(
        read_dir_blocking(dir.clone())
            .unwrap()
            .iter()
            .any(|f| f.path.ends_with("secret.md")),
        "a listing by the path alone lists the folder outside"
    );
    assert_eq!(code(read_dir_judged(&dir, &canonical)), "outside");
}

#[cfg(windows)]
#[test]
fn on_windows_other_spellings_of_a_file_beside_the_opened_one_are_refused() {
    let t = Tree::new("head-spell");
    let set = RwLock::new(OpenedSet::default());
    open_file(&set, &t.s(r"inside\a.md"));
    fs::write(t.0.join(r"inside\b.md"), b"# b\n").unwrap();
    let a = t.s(r"inside\a.md");
    let outside = t.s(r"outside\secret.md");
    for raw in [
        // The opened file's streams, and its name with what Win32 strips from the end.
        format!("{a}:hidden"),
        format!("{a}::$DATA"),
        format!("{a}."),
        format!("{a} "),
        // A neighbour or a file outside, in another case, verbatim, as a device path, or by a share.
        t.s(r"inside\b.md"),
        outside.to_uppercase(),
        format!(r"\\?\{outside}"),
        format!(r"\\.\{outside}"),
        format!(r"\\?\GLOBALROOT\??\{outside}"),
        r"\\marxy-no-such-host.invalid\c$\secret.md".to_string(),
    ] {
        assert_eq!(code(read_head_in(&set, &raw, 8)), "outside", "{raw}");
    }
    assert_eq!(read_head_in(&set, &a.to_uppercase(), 3).unwrap(), b"# a");
}

#[cfg(windows)]
#[test]
fn on_windows_a_stream_or_trailing_dot_under_a_root_stays_under_it() {
    let t = Tree::new("head-ads");
    let set = rooted(&t);
    let a = t.s(r"inside\a.md");
    fs::write(format!("{a}:hidden"), b"stream").unwrap();
    // A stream of a file under the root is under the root, as the file is.
    assert_eq!(
        read_head_in(&set, &format!("{a}:hidden"), 6).unwrap(),
        b"stream"
    );
    let outside = t.s(r"outside\secret.md");
    for raw in [
        format!("{outside}:x"),
        format!("{outside}."),
        format!("{outside} "),
    ] {
        assert_eq!(code(read_head_in(&set, &raw, 8)), "outside", "{raw}");
    }
}

/// The 8.3 name of `path`, when the volume keeps one.
#[cfg(windows)]
fn short_name(path: &Path) -> Option<String> {
    let out = std::process::Command::new("cmd")
        .arg("/C")
        .arg(format!("for %I in (\"{}\") do @echo %~sI", path.display()))
        .output()
        .ok()?;
    let s = String::from_utf8(out.stdout).ok()?.trim().to_string();
    (s.contains('~') && s.to_lowercase() != path.to_string_lossy().to_lowercase()).then_some(s)
}

#[cfg(windows)]
#[test]
fn on_windows_a_short_name_outside_is_refused() {
    let t = Tree::new("head-short-name-folder");
    fs::create_dir_all(t.0.join("outside-with-a-long-name")).unwrap();
    fs::write(t.0.join("outside-with-a-long-name/secret.md"), b"# s\n").unwrap();
    let set = rooted(&t);
    let Some(short) = short_name(&t.0.join("outside-with-a-long-name")) else {
        eprintln!("no 8.3 names on this volume; skipped");
        return;
    };
    assert_eq!(
        code(read_head_in(&set, &format!(r"{short}\secret.md"), 8)),
        "outside"
    );
}
