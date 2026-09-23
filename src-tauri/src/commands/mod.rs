//! 文件系统命令模块。
//!
//! 整体架构位置：
//!   src-tauri/src/commands/mod.rs —— 前端通过 `invoke()` 调用的全部 Tauri 命令。
//!   这是 Rust（文件系统）与前端（UI）之间的唯一数据通道：
//!     - 前端「打开文件夹」后，用 list_dir 逐层拉取目录内容，渲染文件树；
//!     - 前端点击文件时用 read_file 读取纯文本；
//!     - 前端保存时用 write_file 把编辑器内存中的纯 Markdown 写回原文件。
//!
//! 设计约束（遵循用户方案）：
//!   1. 只暴露 .md / .markdown 文件，其它类型一律不进文件树；
//!   2. 默认忽略 .git、node_modules、target 等噪音目录；
//!   3. 不引入任何目录遍历插件，全部用 std::fs 实现，保持最小依赖。

use serde::Serialize;

/// 文件树中的一个节点，直接作为 list_dir 的返回值序列化给前端。
#[derive(Debug, Serialize)]
pub struct FileEntry {
    /// 显示名（文件名或目录名）
    pub name: String,
    /// 绝对路径，前端点击/展开时原样传回给 read_file / list_dir
    pub path: String,
    /// 是否为目录（目录在前端可展开）
    pub is_dir: bool,
}

/// 需要从文件树中忽略的目录名（“等”表示常见工程噪音目录一并忽略）。
const IGNORED_DIRS: &[&str] = &[
    ".git",
    ".svn",
    ".hg",
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    "coverage",
    "__pycache__",
    ".venv",
    "venv",
    ".idea",
    ".vscode",
    ".DS_Store",
];

/// 判断一个条目名是否应被忽略：
///   以 `.` 开头的隐藏文件/目录（覆盖 .git、.DS_Store、.obsidian 等）；
///   命中 IGNORED_DIRS 的常见噪音目录。
fn should_ignore(name: &str) -> bool {
    if name.starts_with('.') {
        return true;
    }
    IGNORED_DIRS.contains(&name)
}

/// 判断文件名是否是需要展示的 Markdown 文件。
fn is_markdown(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

/// 列出指定目录下“可展示”的直接子项（一层，不递归）。
///
/// 前端文件树按需展开时逐层调用本命令，避免一次性递归整棵目录树。
/// 排序规则：目录在前、文件在后，同类型按名称字典序（不区分大小写）。
#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<FileEntry>, String> {
    let dir = std::path::Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("不是有效目录: {path}"));
    }

    let mut entries: Vec<FileEntry> = Vec::new();
    let read_dir = std::fs::read_dir(dir).map_err(|e| format!("读取目录失败: {e}"))?;

    for entry in read_dir {
        let entry = entry.map_err(|e| format!("读取目录条目失败: {e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();

        if should_ignore(&name) {
            continue;
        }

        let is_dir = entry
            .file_type()
            .map(|t| t.is_dir())
            .map_err(|e| format!("读取文件类型失败: {e}"))?;

        // 只保留目录与 Markdown 文件，其余类型不进入文件树
        if !is_dir && !is_markdown(&name) {
            continue;
        }

        entries.push(FileEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir,
        });
    }

    // 目录在前、文件在后，各自按名称字典序排列
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

/// 读取一个 Markdown 文件的完整文本内容。
///
/// 文件在内存中始终是纯 Markdown 字符串（CodeMirror 6 的 document），
/// 本命令只负责把磁盘内容交给前端。
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    let p = std::path::Path::new(&path);
    if !p.is_file() {
        return Err(format!("不是有效文件: {path}"));
    }
    std::fs::read_to_string(p).map_err(|e| format!("读取文件失败: {e}"))
}

/// 把编辑器内容写回原文件。
///
/// 调用方（前端）负责传入“当前打开文件”的路径，本命令不做路径改写，
/// 保证“编辑后保存回原文件”的行为与文件树一致。
#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(std::path::Path::new(&path), content).map_err(|e| format!("写入文件失败: {e}"))
}

/// 在指定目录下新建一个空 Markdown 文件。
///
/// 右键菜单「新建文件」调用；名称由前端提供（可带 .md 后缀，
/// 不带时自动补 .md）。同目录重名直接报错，避免静默覆盖。
#[tauri::command]
pub fn create_file(parent_dir: String, name: String) -> Result<(), String> {
    let mut name = name.trim().to_string();
    if name.is_empty() {
        return Err("文件名不能为空".into());
    }
    if name.contains('/') {
        return Err("文件名不能包含 /".into());
    }
    if !is_markdown(&name) {
        name.push_str(".md");
    }
    let path = std::path::Path::new(&parent_dir).join(&name);
    if path.exists() {
        return Err(format!("已存在同名文件: {name}"));
    }
    std::fs::write(&path, "").map_err(|e| format!("创建文件失败: {e}"))
}

/// 在指定目录下新建一个文件夹。
///
/// 右键菜单「新建文件夹」调用；同目录重名报错。
#[tauri::command]
pub fn create_folder(parent_dir: String, name: String) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("文件夹名不能为空".into());
    }
    if name.contains('/') {
        return Err("文件夹名不能包含 /".into());
    }
    let path = std::path::Path::new(&parent_dir).join(&name);
    if path.exists() {
        return Err(format!("已存在同名文件夹: {name}"));
    }
    std::fs::create_dir(&path).map_err(|e| format!("创建文件夹失败: {e}"))
}

/// 重命名文件或文件夹（只改名字，保持在原目录）。
///
/// 右键菜单「重命名」调用；同目录重名报错。
#[tauri::command]
pub fn rename_path(path: String, new_name: String) -> Result<(), String> {
    let new_name = new_name.trim().to_string();
    if new_name.is_empty() {
        return Err("名称不能为空".into());
    }
    if new_name.contains('/') {
        return Err("名称不能包含 /".into());
    }
    let old = std::path::Path::new(&path);
    let parent = old.parent().ok_or("无法确定父目录")?;
    let new_path = parent.join(&new_name);
    if new_path.exists() {
        return Err(format!("已存在同名条目: {new_name}"));
    }
    std::fs::rename(old, &new_path).map_err(|e| format!("重命名失败: {e}"))
}

/// 删除文件或文件夹（文件夹递归删除）。
///
/// 右键菜单「删除」调用；前端已用确认框二次确认，这里直接执行。
#[tauri::command]
pub fn delete_path(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("条目不存在: {path}"));
    }
    if p.is_dir() {
        std::fs::remove_dir_all(p).map_err(|e| format!("删除文件夹失败: {e}"))
    } else {
        std::fs::remove_file(p).map_err(|e| format!("删除文件失败: {e}"))
    }
}
