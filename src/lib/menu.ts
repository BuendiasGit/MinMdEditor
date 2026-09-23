// src/lib/menu.ts —— 屏幕顶层菜单的前端桥
//
// 整体架构位置：
//   src/lib/ 放与 Tauri 交互的轻量封装（fs.ts 调 Rust 命令）。
//   菜单本体在 Rust 侧（src-tauri/src/menu.rs），点击后通过
//   "menu-command" 事件把命令 id 广播到前端；本文件负责：
//     1. 监听该事件并分发（onMenuCommand）；
//     2. 把前端状态回写为菜单勾选状态（setMenuItemChecked）。
//
// 浏览器调试（?demo=1）下没有 Tauri 菜单：监听一个同名的自定义
// DOM 事件 "minmd-menu-command"，便于在页面里手动模拟菜单点击。

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

/** 菜单命令 id（与 src-tauri/src/menu.rs 的 ID_* 常量一一对应） */
export type MenuCommand =
  | "open-folder"
  | "open-file"
  | "heading-0"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "heading-4"
  | "heading-5"
  | "heading-6"
  | "toggle-typewriter"
  | "open-settings"
  | "toggle-sidebar";

/** 是否运行在 Tauri 环境（浏览器 demo 为 false） */
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * 订阅菜单命令。返回取消订阅函数。
 * 真实环境监听 Tauri 事件；demo 环境监听同名 DOM 事件。
 */
export function onMenuCommand(handler: (cmd: MenuCommand) => void): () => void {
  if (isTauri) {
    let unlisten: UnlistenFn | undefined;
    void listen<string>("menu-command", (e) => {
      handler(e.payload as MenuCommand);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }
  // 浏览器调试：window.dispatchEvent(new CustomEvent("minmd-menu-command", { detail: "open-settings" }))
  const domHandler = (e: Event) =>
    handler((e as CustomEvent<MenuCommand>).detail);
  window.addEventListener("minmd-menu-command", domHandler);
  return () => window.removeEventListener("minmd-menu-command", domHandler);
}

/**
 * 回写勾选菜单项（打字机模式 / 显示文件侧边栏）的勾选状态。
 * 状态以应用内为准（可能被设置持久化覆盖），菜单跟随应用。
 */
export function setMenuItemChecked(id: string, checked: boolean): void {
  if (isTauri) void invoke("set_menu_checked", { id, checked });
}

/** demo 调试辅助：模拟一次菜单点击 */
export function simulateMenuCommand(cmd: MenuCommand): void {
  window.dispatchEvent(
    new CustomEvent<MenuCommand>("minmd-menu-command", { detail: cmd }),
  );
}
