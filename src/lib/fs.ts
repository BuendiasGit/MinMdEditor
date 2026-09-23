// src/lib/fs.ts —— 前端调 Rust 文件命令的封装层
//
// 整体架构位置：
//   src/lib/fs.ts 是前端唯一调用 Tauri 命令的地方，
//   对应 Rust 侧 src-tauri/src/commands/mod.rs 的三个命令：
//     list_dir  → listDir()   （文件树按需展开）
//     read_file → readFile()  （点击文件时读取内容）
//     write_file→ writeFile() （⌘S 保存回原文件）
//   App 与文件树组件都从这里 import，不直接写 invoke 字符串。

import { invoke } from "@tauri-apps/api/core";

/** 与 Rust 侧 FileEntry 序列化结构一一对应 */
export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

/** 列出目录下可展示的子项（目录 + .md/.markdown 文件，已过滤噪音目录） */
export function listDir(path: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("list_dir", { path });
}

/** 读取 Markdown 文件完整内容（纯文本字符串） */
export function readFile(path: string): Promise<string> {
  return invoke<string>("read_file", { path });
}

/** 读取文件修改时间（Unix 毫秒），用于外部修改检测轮询 */
export function statFile(path: string): Promise<number> {
  return invoke<number>("stat_file", { path });
}

/** 把内容写回原文件 */
export function writeFile(path: string, content: string): Promise<void> {
  return invoke<void>("write_file", { path, content });
}

/** 在指定目录下新建空 Markdown 文件（名称可带/不带 .md） */
export function createFile(parentDir: string, name: string): Promise<void> {
  return invoke<void>("create_file", { parentDir, name });
}

/** 在指定目录下新建文件夹 */
export function createFolder(parentDir: string, name: string): Promise<void> {
  return invoke<void>("create_folder", { parentDir, name });
}

/** 重命名文件或文件夹（保持原目录） */
export function renamePath(path: string, newName: string): Promise<void> {
  return invoke<void>("rename_path", { path, newName });
}

/** 删除文件或文件夹（文件夹递归删除） */
export function deletePath(path: string): Promise<void> {
  return invoke<void>("delete_path", { path });
}
