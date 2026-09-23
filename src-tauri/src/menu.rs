// src-tauri/src/menu.rs —— 应用菜单（macOS 屏幕顶层菜单栏）
//
// 整体架构位置：
//   Rust 侧模块之一（lib.rs 入口 / commands 文件读写 / menu 菜单系统）。
//   菜单在 Rust 侧用 Tauri 2 原生 Menu API 构建并挂在窗口上，
//   点击事件通过 "menu-command" 事件广播给前端（src/lib/menu.ts 监听）。
//
// 菜单结构（用户方案）：
//   MinMdEditor（应用菜单）
//     ├─ About MinMdEditor
//     ├─ ────
//     └─ 退出 MinMdEditor
//   文件
//     ├─ 打开文件夹
//     └─ 打开文件
//   编辑
//     ├─ 正文（还原为段落）
//     ├─ 一级标题 ~ 六级标题
//     ├─ ────
//     └─ 打字机模式（勾选项，前端开关）
//   设置
//     ├─ 设置…（打开右侧设置面板）
//     ├─ ────
//     └─ 显示文件侧边栏（勾选项，前端开关）
//
// 勾选状态由前端持有（可能被用户设置覆盖），因此点击后前端会通过
// set_menu_checked 命令回写勾选状态，保证菜单与真实状态一致。
// 菜单项不设 accelerator：⌘O / ⌘S / ⌘1~6 已由编辑器 keymap 处理，
// 避免系统菜单与 webview 按键双重触发。

use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

/// 菜单命令 id（同时也是 emit 到前端的事件载荷，见 src/lib/menu.ts）
pub const ID_OPEN_FOLDER: &str = "open-folder";
pub const ID_OPEN_FILE: &str = "open-file";
/** 正文（还原为段落）：heading-0 */
pub const ID_HEADING_BODY: &str = "heading-0";
/** 标题 1~6 级：heading-1 .. heading-6 */
pub const ID_HEADING_BASE: &str = "heading-";
pub const ID_TYPEWRITER: &str = "toggle-typewriter";
pub const ID_OPEN_SETTINGS: &str = "open-settings";
pub const ID_TOGGLE_SIDEBAR: &str = "toggle-sidebar";

/// 在应用启动时构建菜单并挂在主窗口上。
pub fn setup(app: &mut tauri::App) -> tauri::Result<()> {
  // ---- MinMdEditor（macOS 第一个菜单即应用菜单）----
  let app_menu = Submenu::with_items(
    app,
    "MinMdEditor",
    true,
    &[
      &PredefinedMenuItem::about(app, Some("About MinMdEditor"), None)?,
      &PredefinedMenuItem::separator(app)?,
      &PredefinedMenuItem::quit(app, Some("退出 MinMdEditor"))?,
    ],
  )?;

  // ---- 文件 ----
  let file_menu = Submenu::with_items(
    app,
    "文件",
    true,
    &[
      &MenuItem::with_id(app, ID_OPEN_FOLDER, "打开文件夹", true, None::<&str>)?,
      &MenuItem::with_id(app, ID_OPEN_FILE, "打开文件", true, None::<&str>)?,
    ],
  )?;

  // ---- 编辑：正文 → 各级标题 → 打字机模式 ----
  let mut edit_items: Vec<Box<dyn IsMenuItem<tauri::Wry>>> = vec![
    Box::new(MenuItem::with_id(app, ID_HEADING_BODY, "正文", true, None::<&str>)?),
  ];
  for level in 1..=6 {
    edit_items.push(Box::new(MenuItem::with_id(
      app,
      &format!("{ID_HEADING_BASE}{level}"),
      &format!("{level} 级标题"),
      true,
      None::<&str>,
    )?));
  }
  edit_items.push(Box::new(PredefinedMenuItem::separator(app)?));
  // 打字机模式：默认勾选（前端加载后会按持久化设置校正）
  edit_items.push(Box::new(CheckMenuItem::with_id(
    app,
    ID_TYPEWRITER,
    "打字机模式",
    true,
    true,
    None::<&str>,
  )?));
  let edit_refs: Vec<&dyn IsMenuItem<tauri::Wry>> =
    edit_items.iter().map(|b| b.as_ref()).collect();
  let edit_menu = Submenu::with_items(app, "编辑", true, &edit_refs)?;

  // ---- 设置 ----
  let settings_menu = Submenu::with_items(
    app,
    "设置",
    true,
    &[
      &MenuItem::with_id(app, ID_OPEN_SETTINGS, "设置…", true, None::<&str>)?,
      &PredefinedMenuItem::separator(app)?,
      // 文件侧边栏开关：默认勾选（前端校正）
      &CheckMenuItem::with_id(app, ID_TOGGLE_SIDEBAR, "显示文件侧边栏", true, true, None::<&str>)?,
    ],
  )?;

  let menu = Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &settings_menu])?;

  // 点击事件 → 广播给前端（About / 退出等预定义项由系统处理，不转发）。
  // AppHandle::on_menu_event 注册的是应用级全局菜单事件。
  app.on_menu_event(|app, event| {
    let id = event.id().0.as_str();
    let is_ours = id.starts_with(ID_HEADING_BASE)
      || [ID_OPEN_FOLDER, ID_OPEN_FILE, ID_TYPEWRITER, ID_OPEN_SETTINGS, ID_TOGGLE_SIDEBAR]
        .contains(&id);
    if is_ours {
      let _ = app.emit("menu-command", id);
    }
  });

  app.set_menu(menu)?;
  Ok(())
}

/// 供前端回写勾选菜单项的状态（打字机模式 / 显示文件侧边栏）。
#[tauri::command]
pub fn set_menu_checked<R: Runtime>(
  app: AppHandle<R>,
  id: String,
  checked: bool,
) -> Result<(), String> {
  let menu = app.menu().ok_or_else(|| "应用菜单不可用".to_string())?;
  let item = menu.get(&id).ok_or_else(|| format!("菜单项 {id} 不存在"))?;
  let check = item
    .as_check_menuitem()
    .ok_or_else(|| format!("菜单项 {id} 不是勾选项"))?;
  check.set_checked(checked).map_err(|e| e.to_string())
}
