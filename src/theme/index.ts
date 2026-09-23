// src/theme/index.ts —— 全局主题与用户设置的 TS 侧定义
//
// 整体架构位置：
//   src/theme/ 是“外观/偏好”的数据源头：
//     - theme.css 定义全部 CSS 变量（:root 浅色 + .theme-dark 深色）；
//     - index.ts  定义主题类型、字体设置、本地持久化等纯 TS 逻辑。
//   应用根元素（App.tsx 的 .app）持有 theme-light / theme-dark 类；
//   字体/字号由 App 写入根元素 style 的 CSS 变量（--editor-font 等），
//   编辑器主题（EditorView.theme）通过 var() 引用，一处生效。

export type ThemeName = "light" | "dark";

/** 用户偏好设置（字体 / 字号 / 侧边栏折叠 / 打字机模式） */
export interface AppSettings {
  /** 编辑器正文字体（CSS font-family 字符串；空 = 跟随系统） */
  editorFont: string;
  /** 编辑器字号（px） */
  editorFontSize: number;
  /** 文件侧边栏是否展开 */
  sidebarCollapsed: boolean;
  /** 打字机模式是否开启 */
  typewriterEnabled: boolean;
}

/** 设置默认值 */
export const DEFAULT_SETTINGS: AppSettings = {
  editorFont: "",
  editorFontSize: 15,
  sidebarCollapsed: false,
  typewriterEnabled: true,
};

/** 本地存储 key：主题选择（应用退出后记住） */
export const THEME_STORAGE_KEY = "minmd.theme";

/** 本地存储 key：用户偏好设置（字体 / 字号 / 侧边栏 / 打字机） */
export const SETTINGS_STORAGE_KEY = "minmd.settings";

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

/** 读取持久化的设置，缺失字段回退默认值 */
export function loadSettings(): AppSettings {
  const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!saved) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(saved) as Partial<AppSettings>;
    return {
      editorFont:
        typeof parsed.editorFont === "string"
          ? parsed.editorFont
          : DEFAULT_SETTINGS.editorFont,
      editorFontSize:
        typeof parsed.editorFontSize === "number" &&
        parsed.editorFontSize > 0
          ? parsed.editorFontSize
          : DEFAULT_SETTINGS.editorFontSize,
      sidebarCollapsed:
        typeof parsed.sidebarCollapsed === "boolean"
          ? parsed.sidebarCollapsed
          : DEFAULT_SETTINGS.sidebarCollapsed,
      typewriterEnabled:
        typeof parsed.typewriterEnabled === "boolean"
          ? parsed.typewriterEnabled
          : DEFAULT_SETTINGS.typewriterEnabled,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** 持久化用户设置 */
export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
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
