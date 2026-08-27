// opersona tray — the daemon's face. A menu-bar item that supervises the
// bridge (your persona's compute + learning on this machine), shows live
// status, and pairs the machine on first run. The bridge itself is the same
// `opersona` npm bundle, fetched once into ~/.opersona-bridge/bridge.js and
// run with this machine's node.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};

const SITE: &str = "https://opersona.me";

struct Daemon {
    child: Option<Child>,
    want_running: bool,
    spawning: bool,
    connected: bool,
    learned_today: u32,
    day: String,
    note: Option<String>,
}

struct UiItems {
    status: MenuItem<tauri::Wry>,
    learned: MenuItem<tauri::Wry>,
    toggle: MenuItem<tauri::Wry>,
    update: MenuItem<tauri::Wry>,
}

/// Set once an update is downloaded+installed; the "update" menu click then restarts.
static UPDATE_READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// Lets our ExitRequested guard wave a deliberate restart through.
static RESTARTING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

struct AppState {
    daemon: Arc<Mutex<Daemon>>,
    ui: Mutex<Option<UiItems>>,
}

fn cfg_dir() -> PathBuf {
    dirs::home_dir().expect("no home").join(".opersona-bridge")
}

/// Everything noteworthy lands in ~/.opersona-bridge/tray.log — GUI apps have no terminal.
fn tlog(msg: &str) {
    use std::io::Write;
    let _ = std::fs::create_dir_all(cfg_dir());
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(cfg_dir().join("tray.log"))
    {
        let _ = writeln!(f, "{msg}");
    }
}

fn has_token() -> bool {
    std::fs::read_to_string(cfg_dir().join("config.json"))
        .map(|s| s.contains("obr_"))
        .unwrap_or(false)
}

fn today() -> String {
    // good enough day-bucket without chrono: seconds → days since epoch
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{}", secs / 86_400)
}

/// Real install: `npm install opersona@latest` into ~/.opersona-bridge/app —
/// the bundle needs its deps (ws, the Claude SDK) installed next to it, and
/// this also keeps the tray's bridge always-latest. Runs once per tray launch.
static INSTALL_DONE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn ensure_bridge_installed(node: &str) -> Result<PathBuf, String> {
    let app_dir = cfg_dir().join("app");
    let entry = app_dir.join("node_modules/opersona/dist/index.js");
    let fresh_needed = !entry.exists();
    if fresh_needed || !INSTALL_DONE.load(std::sync::atomic::Ordering::SeqCst) {
        let node_dir = std::path::Path::new(node)
            .parent()
            .ok_or("bad node path")?
            .to_path_buf();
        let npm = node_dir.join("npm");
        if npm.exists() {
            std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
            let path_env = format!(
                "{}:{}",
                node_dir.display(),
                std::env::var("PATH").unwrap_or_default()
            );
            tlog("npm install opersona@latest …");
            let out = Command::new(&npm)
                .arg("install")
                .arg("--prefix")
                .arg(&app_dir)
                .args(["--no-fund", "--no-audit", "--loglevel=error", "--prefer-online", "opersona@latest"])
                .env("PATH", path_env)
                .output()
                .map_err(|e| e.to_string())?;
            if out.status.success() {
                let ver = std::fs::read_to_string(app_dir.join("node_modules/opersona/package.json"))
                    .ok()
                    .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                    .and_then(|v| v["version"].as_str().map(String::from))
                    .unwrap_or_else(|| "?".into());
                tlog(&format!("npm install ok — bridge v{ver}"));
            } else {
                tlog(&format!(
                    "npm install failed: {}",
                    String::from_utf8_lossy(&out.stderr).trim()
                ));
            }
        } else if fresh_needed {
            return Err(format!("npm not found next to node ({})", node_dir.display()));
        }
        INSTALL_DONE.store(true, std::sync::atomic::Ordering::SeqCst);
    }
    if entry.exists() {
        Ok(entry)
    } else {
        Err("install failed — see ~/.opersona-bridge/tray.log".into())
    }
}

/// Claude Code users always have node; GUI apps just don't inherit shell PATH,
/// and version managers (nvm/fnm/volta) hide it in dotfile-loaded dirs.
fn find_node() -> Option<String> {
    let mut cands: Vec<PathBuf> = vec![
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
        PathBuf::from("/usr/bin/node"),
    ];
    if let Some(h) = dirs::home_dir() {
        cands.push(h.join(".volta/bin/node"));
        for base in [
            h.join(".nvm/versions/node"),
            h.join(".fnm/node-versions"),
            h.join("Library/Application Support/fnm/node-versions"),
            h.join(".local/share/fnm/node-versions"),
        ] {
            if let Ok(rd) = std::fs::read_dir(&base) {
                let mut vers: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
                vers.sort();
                for v in vers.into_iter().rev() {
                    cands.push(v.join("bin/node"));
                    cands.push(v.join("installation/bin/node"));
                }
            }
        }
    }
    for c in &cands {
        if c.exists() {
            return Some(c.to_string_lossy().into_owned());
        }
    }
    // Last resort: ask real shells (interactive login loads .zshrc where nvm lives).
    for (sh, flag) in [("/bin/zsh", "-ilc"), ("/bin/zsh", "-lc"), ("/bin/bash", "-lc")] {
        if let Ok(out) = Command::new(sh).args([flag, "command -v node"]).output() {
            let raw = String::from_utf8_lossy(&out.stdout);
            let p = raw.trim().lines().last().unwrap_or("").trim().to_string();
            if !p.is_empty() && std::path::Path::new(&p).exists() {
                return Some(p);
            }
        }
    }
    None
}

fn set_note(app: &AppHandle, note: Option<String>) {
    {
        let state = app.state::<AppState>();
        state.daemon.lock().unwrap().note = note;
    }
    refresh_menu(app);
}

fn set_status(app: &AppHandle, text: String, learned: String, toggle: String) {
    let state = app.state::<AppState>();
    let ui_guard = state.ui.lock().unwrap();
    if let Some(ui) = ui_guard.as_ref() {
        let _ = ui.status.set_text(text);
        let _ = ui.learned.set_text(learned);
        let _ = ui.toggle.set_text(toggle);
    }
}

fn refresh_menu(app: &AppHandle) {
    let state = app.state::<AppState>();
    let (running, connected, learned, note) = {
        let d = state.daemon.lock().unwrap();
        (d.want_running, d.connected, d.learned_today, d.note.clone())
    };
    let status = if let Some(n) = note {
        format!("⚠ {n}")
    } else if !running {
        "○ Stopped".to_string()
    } else if connected {
        "● Online — this machine powers your persona".to_string()
    } else {
        "◌ Connecting…".to_string()
    };
    let learned_txt = format!(
        "Learned {} session{} today",
        learned,
        if learned == 1 { "" } else { "s" }
    );
    let toggle_txt = if running { "Stop" } else { "Start" }.to_string();
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || set_status(&app2, status, learned_txt, toggle_txt));
}

fn parse_line(app: &AppHandle, line: &str) {
    tlog(line);
    let state = app.state::<AppState>();
    let mut changed = false;
    {
        let mut d = state.daemon.lock().unwrap();
        let day = today();
        if d.day != day {
            d.day = day;
            d.learned_today = 0;
            changed = true;
        }
        if line.contains("[bridge] connected") {
            d.connected = true;
            changed = true;
        } else if line.contains("disconnected") || line.contains("retrying") {
            d.connected = false;
            changed = true;
        } else if line.contains("[watch] learned from session") {
            d.learned_today += 1;
            changed = true;
        } else if line.contains("token rejected") {
            d.connected = false;
            d.want_running = false;
            changed = true;
        }
    }
    if line.contains("token rejected") {
        if let Some(w) = app.get_webview_window("pair") {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
    if changed {
        refresh_menu(app);
    }
}

fn start_daemon(app: &AppHandle) {
    let state = app.state::<AppState>();
    {
        let mut d = state.daemon.lock().unwrap();
        d.want_running = true;
        if d.child.is_some() || d.spawning {
            return; // one supervisor thread is plenty
        }
        d.spawning = true;
    }
    let app = app.clone();
    std::thread::spawn(move || loop {
        {
            let state = app.state::<AppState>();
            let mut d = state.daemon.lock().unwrap();
            if !d.want_running {
                d.spawning = false;
                break;
            }
        }
        let Some(node) = find_node() else {
            tlog("node not found — install Node 20+ (Claude Code needs it too)");
            set_note(&app, Some("Node not found — install Node 20+ then Stop/Start".into()));
            std::thread::sleep(std::time::Duration::from_secs(30));
            continue;
        };
        let script = match ensure_bridge_installed(&node) {
            Ok(p) => p,
            Err(e) => {
                tlog(&format!("bridge install failed: {e}"));
                set_note(&app, Some(format!("Can't install the bridge: {e}")));
                std::thread::sleep(std::time::Duration::from_secs(15));
                continue;
            }
        };
        // Stop pressed while npm was installing? honour it — don't spawn anyway.
        {
            let state = app.state::<AppState>();
            let mut d = state.daemon.lock().unwrap();
            if !d.want_running {
                d.spawning = false;
                break;
            }
        }
        tlog(&format!("spawning {node} {}", script.display()));
        set_note(&app, None);
        let child = Command::new(&node)
            .arg(&script)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();
        let mut child = match child {
            Ok(c) => c,
            Err(e) => {
                tlog(&format!("spawn failed: {e}"));
                set_note(&app, Some(format!("Couldn't start the bridge: {e}")));
                std::thread::sleep(std::time::Duration::from_secs(10));
                continue;
            }
        };
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        {
            let state = app.state::<AppState>();
            state.daemon.lock().unwrap().child = Some(child);
        }
        refresh_menu(&app);
        let a2 = app.clone();
        let t_err = stderr.map(|se| {
            std::thread::spawn(move || {
                for line in BufReader::new(se).lines().map_while(Result::ok) {
                    parse_line(&a2, &line);
                }
            })
        });
        if let Some(so) = stdout {
            for line in BufReader::new(so).lines().map_while(Result::ok) {
                parse_line(&app, &line);
            }
        }
        if let Some(t) = t_err {
            let _ = t.join();
        }
        // process ended
        {
            let state = app.state::<AppState>();
            let mut d = state.daemon.lock().unwrap();
            if let Some(mut c) = d.child.take() {
                let _ = c.wait();
            }
            d.connected = false;
            if !d.want_running {
                // clear the latch or Start can never spawn a supervisor again
                d.spawning = false;
                break;
            }
        }
        refresh_menu(&app);
        std::thread::sleep(std::time::Duration::from_secs(5));
    });
}

fn stop_daemon(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut d = state.daemon.lock().unwrap();
    d.want_running = false;
    d.connected = false;
    if let Some(mut c) = d.child.take() {
        let _ = c.kill();
    }
    drop(d);
    refresh_menu(app);
}

/// The tray supersedes any `opersona install` launchd service — one supervisor.
fn takeover_launchd() {
    let plist = dirs::home_dir()
        .map(|h| h.join("Library/LaunchAgents/me.opersona.bridge.plist"))
        .filter(|p| p.exists());
    if let Some(p) = plist {
        let _ = Command::new("launchctl").arg("unload").arg(&p).output();
    }
}

fn read_config() -> serde_json::Value {
    std::fs::read_to_string(cfg_dir().join("config.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

fn write_config(cfg: &serde_json::Value) -> Result<(), String> {
    std::fs::create_dir_all(cfg_dir()).map_err(|e| e.to_string())?;
    let path = cfg_dir().join("config.json");
    std::fs::write(&path, serde_json::to_vec_pretty(cfg).unwrap()).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn apply_token(app: &AppHandle, token: &str) -> Result<(), String> {
    let t = token.trim();
    if !t.starts_with("obr_") {
        return Err("that does not look like a bridge token (it starts with obr_)".into());
    }
    if t.len() != 52 {
        return Err(format!(
            "that token looks incomplete ({} characters — a real one is 52). Mint a fresh one and use the Copy button.",
            t.len()
        ));
    }
    let mut cfg = read_config();
    cfg["url"] = serde_json::json!(SITE);
    cfg["token"] = serde_json::json!(t);
    write_config(&cfg)?;
    tlog("token saved — (re)starting daemon");
    {
        let state = app.state::<AppState>();
        let mut d = state.daemon.lock().unwrap();
        d.note = None;
        if let Some(mut c) = d.child.take() {
            let _ = c.kill(); // restart so the new token is used immediately
        }
    }
    if let Some(w) = app.get_webview_window("pair") {
        let _ = w.hide();
    }
    start_daemon(app);
    refresh_tray_icon(app);
    Ok(())
}

#[tauri::command]
fn save_token(app: AppHandle, token: String) -> Result<(), String> {
    apply_token(&app, &token)
}

fn url_param(url: &str, name: &str) -> Option<String> {
    let needle = format!("{name}=");
    url.split(['?', '&'])
        .find(|part| part.starts_with(&needle))
        .map(|part| part[needle.len()..].trim().to_string())
        .filter(|v| !v.is_empty())
}

/// URL-safe → standard base64 (the seal key rides the link URL-encoded-ish).
fn decode_key_param(v: &str) -> String {
    v.replace("%2B", "+").replace("%2F", "/").replace("%3D", "=").replace('-', "+").replace('_', "/")
}

fn save_seal_key(app: &AppHandle, key: &str) -> Result<(), String> {
    let k = decode_key_param(key);
    let mut cfg = read_config();
    cfg["sealKey"] = serde_json::json!(k);
    write_config(&cfg)?;
    tlog("seal key saved — sealed conversations active on this machine");
    // restart so the daemon picks it up
    {
        let state = app.state::<AppState>();
        let mut d = state.daemon.lock().unwrap();
        if let Some(mut c) = d.child.take() {
            let _ = c.kill();
        }
    }
    start_daemon(app);
    Ok(())
}

/// opersona://pair?token=obr_…[&seal=…] pairs (and keys) the app in one click;
/// opersona://seal?key=… updates only the seal key. The key never touches the
/// server — deep links are an OS-local browser→app hop.
fn handle_deep_link(app: &AppHandle, url: &str) {
    tlog(&format!("deep link: {}", url.split(['?']).next().unwrap_or(url)));
    if url.contains("://stop") {
        // web toggle: deactivate — stop the daemon (the tray stays in the menu bar)
        stop_daemon(app);
        return;
    }
    if url.contains("://open") {
        // "start my app" from the web: make sure the daemon runs (pairing already done)
        if has_token() {
            start_daemon(app);
        } else if let Some(w) = app.get_webview_window("pair") {
            let _ = w.show();
            let _ = w.set_focus();
        }
        return;
    }
    if url.contains("://seal") {
        if let Some(k) = url_param(url, "key") {
            if let Err(e) = save_seal_key(app, &k) {
                tlog(&format!("seal deep link failed: {e}"));
            }
        }
        return;
    }
    let Some(token) = url_param(url, "token") else { return };
    if let Some(k) = url_param(url, "seal") {
        let _ = save_seal_key(app, &k);
    }
    match apply_token(app, &token) {
        Ok(()) => tlog("deep-link pairing accepted"),
        Err(e) => {
            tlog(&format!("deep-link pairing failed: {e}"));
            set_note(app, Some(format!("Pairing link problem: {e}")));
            if let Some(w) = app.get_webview_window("pair") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
    }
}

#[tauri::command]
fn open_site() {
    let _ = open::that(format!("{SITE}/settings"));
}

/// Auto-update: check the manifest, download + install silently, then offer a
/// one-click restart from the menu (the new version also just takes effect on
/// the next natural launch). Runs at startup and every 6 hours.
fn check_for_updates(app: &AppHandle) {
    use tauri_plugin_updater::UpdaterExt;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let updater = match app.updater() { Ok(u) => u, Err(e) => { tlog(&format!("updater unavailable: {e}")); return; } };
        match updater.check().await {
            Ok(Some(update)) => {
                let ver = update.version.clone();
                tlog(&format!("update available: v{ver} — downloading"));
                match update.download_and_install(|_, _| {}, || {}).await {
                    Ok(()) => {
                        UPDATE_READY.store(true, std::sync::atomic::Ordering::SeqCst);
                        tlog(&format!("v{ver} installed — active after restart"));
                        {
                            let state = app.state::<AppState>();
                            let guard = state.ui.lock().unwrap();
                            if let Some(ui) = guard.as_ref() {
                                let _ = ui.update.set_text(format!("⬆ v{ver} ready — restart to finish"));
                                let _ = ui.update.set_enabled(true);
                            }
                        }
                    }
                    Err(e) => tlog(&format!("update install failed: {e}")),
                }
            }
            Ok(None) => tlog("up to date"),
            Err(e) => tlog(&format!("update check failed: {e}")),
        }
    });
}

/// Wear the user's pixie as the tray icon — the same head crop the web app
/// uses for its favicon and sidebar. Fetched with this machine's own bridge
/// token; falls back to the bundled icon when unpaired or offline.
fn refresh_tray_icon(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let cfg = read_config();
        let Some(token) = cfg["token"].as_str().map(String::from) else { return };
        let url = format!("{SITE}/bridge/avatar?s=4");
        match ureq::get(&url)
            .set("Authorization", &format!("Bearer {token}"))
            .timeout(std::time::Duration::from_secs(15))
            .call()
        {
            Ok(resp) => {
                use std::io::Read;
                let mut buf = Vec::new();
                if resp.into_reader().take(1_000_000).read_to_end(&mut buf).is_err() || buf.is_empty() {
                    tlog("pixie icon: empty response");
                    return;
                }
                let app2 = app.clone();
                let _ = app.run_on_main_thread(move || {
                    if let Some(tray) = app2.tray_by_id("main") {
                        match tauri::image::Image::from_bytes(&buf) {
                            Ok(img) => {
                                let _ = tray.set_icon_as_template(false);
                                let _ = tray.set_icon(Some(img));
                                tlog("tray icon: wearing your pixie");
                            }
                            Err(e) => tlog(&format!("pixie icon decode failed: {e}")),
                        }
                    }
                });
            }
            Err(e) => tlog(&format!("pixie icon fetch failed (keeping default): {e}")),
        }
    });
}

fn main() {
    tauri::Builder::default()
        // MUST be first: a second copy (launched e.g. right after a dmg update while the
        // old one still runs) hands its argv to the running instance and exits instead of
        // fighting it for the daemon.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            for a in args {
                if a.starts_with("opersona://") {
                    handle_deep_link(app, &a);
                }
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_deep_link::init())
        .manage(AppState {
            daemon: Arc::new(Mutex::new(Daemon {
                child: None,
                want_running: false,
                spawning: false,
                connected: false,
                learned_today: 0,
                day: today(),
                note: None,
            })),
            ui: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![save_token, open_site])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            takeover_launchd();

            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        handle_deep_link(&handle, url.as_str());
                    }
                });
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    let handle = app.handle().clone();
                    for url in urls {
                        handle_deep_link(&handle, url.as_str());
                    }
                }
            }

            let status = MenuItem::with_id(app, "status", "○ Starting…", false, None::<&str>)?;
            let learned = MenuItem::with_id(app, "learned", "Learned 0 sessions today", false, None::<&str>)?;
            let toggle = MenuItem::with_id(app, "toggle", "Start", true, None::<&str>)?;
            let pair = MenuItem::with_id(app, "pair", "Pair this machine…", true, None::<&str>)?;
            let site = MenuItem::with_id(app, "site", "Open opersona.me", true, None::<&str>)?;
            let autostart = MenuItem::with_id(app, "autostart", "Start at login", true, None::<&str>)?;
            let update = MenuItem::with_id(app, "update", concat!("Version ", env!("CARGO_PKG_VERSION"), " — up to date"), false, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &status,
                    &learned,
                    &PredefinedMenuItem::separator(app)?,
                    &toggle,
                    &site,
                    &pair,
                    &autostart,
                    &PredefinedMenuItem::separator(app)?,
                    &update,
                    &quit,
                ],
            )?;

            let state = app.state::<AppState>();
            *state.ui.lock().unwrap() = Some(UiItems { status, learned, toggle, update });

            let icon = app.default_window_icon().cloned();
            let mut tray = TrayIconBuilder::with_id("main")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .tooltip("opersona");
            if let Some(ic) = icon {
                tray = tray.icon(ic);
            }
            tray.on_menu_event(|app, ev| match ev.id().as_ref() {
                "toggle" => {
                    let running = app
                        .state::<AppState>()
                        .daemon
                        .lock()
                        .unwrap()
                        .want_running;
                    if running {
                        stop_daemon(app);
                    } else {
                        start_daemon(app);
                    }
                }
                "site" => {
                    let _ = open::that(SITE);
                }
                "pair" => {
                    if let Some(w) = app.get_webview_window("pair") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
                "autostart" => {
                    use tauri_plugin_autostart::ManagerExt;
                    let al = app.autolaunch();
                    if al.is_enabled().unwrap_or(false) {
                        let _ = al.disable();
                    } else {
                        let _ = al.enable();
                    }
                }
                "update" => {
                    if UPDATE_READY.load(std::sync::atomic::Ordering::SeqCst) {
                        RESTARTING.store(true, std::sync::atomic::Ordering::SeqCst);
                        stop_daemon(app);
                        app.restart();
                    }
                }
                "quit" => {
                    stop_daemon(app);
                    app.exit(0);
                }
                _ => {}
            })
            .build(app)?;

            if has_token() {
                start_daemon(app.handle());
            } else if let Some(w) = app.get_webview_window("pair") {
                let _ = w.show();
            }
            refresh_menu(app.handle());
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || loop {
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    refresh_tray_icon(&handle);
                    check_for_updates(&handle);
                    std::thread::sleep(std::time::Duration::from_secs(6 * 60 * 60));
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // closing the pairing window must not quit the tray app
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building opersona tray")
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() && !RESTARTING.load(std::sync::atomic::Ordering::SeqCst) {
                    api.prevent_exit();
                }
            }
        });
}
