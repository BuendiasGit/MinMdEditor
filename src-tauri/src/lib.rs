// 学习更多 Tauri 命令写法: https://tauri.app/develop/calling-rust/

mod commands;

// 整体架构位置：
//   src-tauri/src/lib.rs —— Tauri 应用入口，注册插件与全部命令。
//   Rust 侧结构：lib.rs（入口） + commands/（文件读写命令），
//   前端通过 @tauri-apps/api 的 invoke() 调用这里注册的命令。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // dialog 插件：提供原生“选择文件夹”对话框（打开文件夹功能）
        .plugin(tauri_plugin_dialog::init())
        // 注册本项目自研的文件系统命令（文件树 / 读取 / 写入）
        .invoke_handler(tauri::generate_handler![
            commands::list_dir,
            commands::read_file,
            commands::write_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
