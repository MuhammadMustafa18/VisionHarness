// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::{TcpStream, ToSocketAddrs};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// The frontend talks to the Python backend on this fixed port.
const BACKEND_PORT: u16 = 8000;

struct BackendProcess(Mutex<Option<CommandChild>>);

fn backend_port_open() -> bool {
    let addr = format!("127.0.0.1:{BACKEND_PORT}");
    match addr.to_socket_addrs() {
        Ok(mut addrs) => addrs
            .next()
            .map(|a| TcpStream::connect_timeout(&a, Duration::from_millis(300)).is_ok())
            .unwrap_or(false),
        Err(_) => false,
    }
}

/// Starts the bundled backend unless one is already listening (e.g. `tauri dev`
/// next to a running `uvicorn`).
fn start_backend(app: &tauri::AppHandle) {
    if backend_port_open() {
        println!("[visionharness] reusing backend already listening on {BACKEND_PORT}");
        return;
    }

    let data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    if let Err(e) = std::fs::create_dir_all(&data_dir) {
        eprintln!("[visionharness] could not create data dir {data_dir:?}: {e}");
    }

    let sidecar = match app.shell().sidecar("visionharness-server") {
        Ok(cmd) => cmd,
        Err(e) => {
            eprintln!("[visionharness] backend sidecar unavailable: {e}");
            return;
        }
    };

    let spawned = sidecar
        .current_dir(data_dir.clone())
        .env("VISIONHARNESS_DATA_DIR", data_dir)
        .env("VISIONHARNESS_PORT", BACKEND_PORT.to_string())
        .env("VISIONHARNESS_HOST", "127.0.0.1")
        .spawn();

    match spawned {
        Ok((mut rx, child)) => {
            app.manage(BackendProcess(Mutex::new(Some(child))));
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                            print!("[backend] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Terminated(payload) => {
                            eprintln!("[visionharness] backend exited: {payload:?}");
                            break;
                        }
                        _ => {}
                    }
                }
            });
        }
        Err(e) => eprintln!("[visionharness] failed to start backend: {e}"),
    }
}

fn stop_backend(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<BackendProcess>() {
        if let Some(child) = state.0.lock().ok().and_then(|mut c| c.take()) {
            let _ = child.kill();
        }
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            start_backend(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running VisionHarness application");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            stop_backend(handle);
        }
    });
}
