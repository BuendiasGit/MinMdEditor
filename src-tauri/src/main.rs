// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// 整体架构位置：
//   src-tauri/src/main.rs —— 桌面二进制的唯一入口，直接转发到 lib.rs 的 run()。
//   注意：这里的 minmdeditor_lib 必须与 Cargo.toml 中 [lib] name 保持一致。
fn main() {
    minmdeditor_lib::run()
}
