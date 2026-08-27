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
}

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
                .args(["--no-fund", "--no-audit", "--loglevel=error", "opersona@latest"])
                .env("PATH", path_env)
                .output()
                .map_err(|e| e.to_string())?;
            if out.status.success() {
                tlog("npm install ok");
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

#[tauri::command]
fn save_token(app: AppHandle, token: String) -> Result<(), String> {
    let t = token.trim();
    if !t.starts_with("obr_") || t.len() < 20 {
        return Err("that does not look like a bridge token".into());
    }
    std::fs::create_dir_all(cfg_dir()).map_err(|e| e.to_string())?;
    let cfg = serde_json::json!({ "url": SITE, "token": t });
    let path = cfg_dir().join("config.json");
    std::fs::write(&path, serde_json::to_vec_pretty(&cfg).unwrap()).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
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
    start_daemon(&app);
    Ok(())
}

#[tauri::command]
fn open_site() {
    let _ = open::that(format!("{SITE}/settings"));
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
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

            let status = MenuItem::with_id(app, "status", "○ Starting…", false, None::<&str>)?;
            let learned = MenuItem::with_id(app, "learned", "Learned 0 sessions today", false, None::<&str>)?;
            let toggle = MenuItem::with_id(app, "toggle", "Start", true, None::<&str>)?;
            let pair = MenuItem::with_id(app, "pair", "Pair this machine…", true, None::<&str>)?;
            let site = MenuItem::with_id(app, "site", "Open opersona.me", true, None::<&str>)?;
            let autostart = MenuItem::with_id(app, "autostart", "Start at login", true, None::<&str>)?;
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
                    &quit,
                ],
            )?;

            let state = app.state::<AppState>();
            *state.ui.lock().unwrap() = Some(UiItems { status, learned, toggle });

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
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
