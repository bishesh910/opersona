// opersona tray — the daemon's face. A menu-bar item that supervises the
// bridge (your persona's compute + learning on this machine), shows live
// status, and pairs the machine on first run. The bridge itself is the same
// `opersona` npm bundle, fetched once into ~/.opersona-bridge/bridge.js and
// run with this machine's node.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader, Read};
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
    connected: bool,
    learned_today: u32,
    day: String,
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

/// Fetch the published bridge bundle into ~/.opersona-bridge/bridge.js (once).
fn ensure_bridge_js() -> Result<PathBuf, String> {
    let dest = cfg_dir().join("bridge.js");
    if dest.exists() {
        return Ok(dest);
    }
    std::fs::create_dir_all(cfg_dir()).map_err(|e| e.to_string())?;
    let meta: serde_json::Value = ureq::get("https://registry.npmjs.org/opersona/latest")
        .call()
        .map_err(|e| format!("registry unreachable: {e}"))?
        .into_json()
        .map_err(|e| e.to_string())?;
    let url = meta["dist"]["tarball"]
        .as_str()
        .ok_or("no tarball url")?
        .to_string();
    let mut raw: Vec<u8> = Vec::new();
    ureq::get(&url)
        .call()
        .map_err(|e| format!("tarball fetch failed: {e}"))?
        .into_reader()
        .read_to_end(&mut raw)
        .map_err(|e| e.to_string())?;
    let tar = flate2::read::GzDecoder::new(raw.as_slice());
    let mut ar = tar::Archive::new(tar);
    for entry in ar.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?.into_owned();
        if path.to_string_lossy() == "package/dist/index.js" {
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            std::fs::write(&dest, buf).map_err(|e| e.to_string())?;
            return Ok(dest);
        }
    }
    Err("bridge bundle not found in package".into())
}

/// Claude Code users always have node; GUI apps just don't inherit shell PATH.
fn find_node() -> Option<String> {
    for c in [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ] {
        if std::path::Path::new(c).exists() {
            return Some(c.to_string());
        }
    }
    let out = Command::new("/bin/zsh")
        .args(["-lc", "command -v node"])
        .output()
        .ok()?;
    let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if p.is_empty() {
        None
    } else {
        Some(p)
    }
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
    let (running, connected, learned) = {
        let d = state.daemon.lock().unwrap();
        (d.want_running, d.connected, d.learned_today)
    };
    let status = if !running {
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
        if d.child.is_some() {
            d.want_running = true;
            return;
        }
        d.want_running = true;
    }
    let app = app.clone();
    std::thread::spawn(move || loop {
        {
            let state = app.state::<AppState>();
            if !state.daemon.lock().unwrap().want_running {
                break;
            }
        }
        let script = match ensure_bridge_js() {
            Ok(p) => p,
            Err(e) => {
                eprintln!("bridge fetch failed: {e}");
                std::thread::sleep(std::time::Duration::from_secs(15));
                continue;
            }
        };
        let Some(node) = find_node() else {
            eprintln!("node not found — install Node 20+ (Claude Code needs it too)");
            std::thread::sleep(std::time::Duration::from_secs(30));
            continue;
        };
        let child = Command::new(&node)
            .arg(&script)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();
        let mut child = match child {
            Ok(c) => c,
            Err(e) => {
                eprintln!("spawn failed: {e}");
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
                connected: false,
                learned_today: 0,
                day: today(),
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
