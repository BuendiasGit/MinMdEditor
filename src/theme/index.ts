// src/theme/index.ts —— 全局主题的 TS 侧定义
//
// 整体架构位置：
//   src/theme/ 是“黑白主题”的数据源头：
//     - theme.css 定义全部 CSS 变量（:root 浅色 + .theme-dark 深色）；
//     - index.ts  定义主题类型、本地持久化等纯 TS 逻辑。
//   应用根元素（App.tsx 的 .app）持有 theme-light / theme-dark 类，
//   编辑器、侧边栏、标题栏、状态栏全部从同一套 CSS 变量取色。

export type ThemeName = "light" | "dark";

/** 本地存储 key：主题选择（应用退出后记住） */
export const THEME_STORAGE_KEY = "minmd.theme";

/** 本地存储 key：上次打开的文件夹（应用重启后自动恢复文件树） */
export const ROOT_DIR_STORAGE_KEY = "minmd.rootDir";

/** 本地存储 key：上次打开的文件（应用重启后自动恢复编辑内容） */
export const LAST_FILE_STORAGE_KEY = "minmd.lastFile";

/** 读取持久化的主题，非法值回退到浅色 */
export function loadTheme(): ThemeName {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  return saved === "dark" ? "dark" : "light";
}

/** 持久化主题选择 */
export function saveTheme(theme: ThemeName): void {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

/** 读取上次打开的文件夹，不存在则返回 null */
export function loadRootDir(): string | null {
  return localStorage.getItem(ROOT_DIR_STORAGE_KEY);
}

/** 持久化上次打开的文件夹 */
export function saveRootDir(dir: string): void {
  localStorage.setItem(ROOT_DIR_STORAGE_KEY, dir);
}

/** 读取上次打开的文件路径，不存在则返回 null */
export function loadLastFile(): string | null {
  return localStorage.getItem(LAST_FILE_STORAGE_KEY);
}

/** 持久化上次打开的文件路径 */
export function saveLastFile(path: string): void {
  localStorage.setItem(LAST_FILE_STORAGE_KEY, path);
}
