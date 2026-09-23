// 学习更多 Tauri 命令写法: https://tauri.app/develop/calling-rust/

mod commands;
mod menu;

// 整体架构位置：
//   src-tauri/src/lib.rs —— Tauri 应用入口，注册插件与全部命令。
//   Rust 侧结构：lib.rs（入口） + commands/（文件读写命令）+ menu/（菜单系统），
//   前端通过 @tauri-apps/api 的 invoke() 调用这里注册的命令。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // dialog 插件：提供原生“选择文件夹 / 选择文件”对话框
        .plugin(tauri_plugin_dialog::init())
        // 应用启动后构建屏幕顶层菜单（About / 文件 / 编辑 / 设置）
        .setup(|app| {
            menu::setup(app)?;
            Ok(())
        })
        // 注册全部命令：文件系统 + 菜单勾选回写
        .invoke_handler(tauri::generate_handler![
            commands::list_dir,
            commands::read_file,
            commands::write_file, stat_file,
            commands::create_file,
            commands::create_folder,
            commands::rename_path,
            commands::delete_path,
            menu::set_menu_checked,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
