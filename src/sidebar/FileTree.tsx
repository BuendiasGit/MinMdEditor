// src/sidebar/FileTree.tsx —— 文件树（侧边栏）
//
// 整体架构位置：
//   src/sidebar/ 存放侧边栏文件树组件，只做 UI 与交互；
//   数据来自 src/lib/fs.ts 的 listDir()（Rust 侧过滤了噪音目录与
//   非 Markdown 文件），文件/文件夹的增删改通过 fs.ts 封装的
//   Tauri 命令（create_file / create_folder / rename_path / delete_path）完成。
//
// 行为设计：
//   - 目录节点：点击展开/折叠，首次展开时懒加载子项；
//   - 文件节点：点击通知 App 打开（onOpenFile）；
//   - 右键菜单（自绘，非原生）：
//       · 空白处右键 → 新建文件 / 新建文件夹
//       · 文件右键   → 重命名 / 删除
//       · 文件夹右键 → 新建子文件 / 重命名 / 删除
//     「新建 / 重命名」用菜单内嵌输入框（Tauri 的 WKWebView 不支持
//     window.prompt，必须自绘）；删除用 confirm 二次确认。
//   - 操作成功后只刷新“操作所在目录”的子项（DirRefresher 注册表），
//     避免整棵树重建丢失展开状态；
//   - 目录递归渲染（TreeNode 自己调自己），缩进由 depth 控制。

import { useCallback, useEffect, useRef, useState } from "react";
import {
  listDir,
  createFile,
  createFolder,
  renamePath,
  deletePath,
  type FileEntry,
} from "../lib/fs";

interface FileTreeProps {
  /** 已打开的根目录绝对路径 */
  rootDir: string;
  /** 点击文件时的回调（App 负责读取并载入编辑器） */
  onOpenFile: (path: string) => void;
  /** 当前打开的文件（用于高亮） */
  activeFile: string | null;
}

/** 右键菜单的类型：空白处 / 文件 / 文件夹 */
type MenuKind = "blank" | "file" | "dir";

/** 右键菜单状态 */
interface ContextMenu {
  x: number;
  y: number;
  kind: MenuKind;
  /** 右键目标的条目（file/dir 时存在） */
  target?: FileEntry;
}

/** 输入态：新建文件 / 新建文件夹 / 重命名 */
interface PromptState {
  mode: "createFile" | "createFolder" | "rename";
  /** 操作发生的目录（新建文件/文件夹在此目录；重命名的父目录） */
  dir: string;
  /** 输入框初始值（重命名时为原名） */
  initial: string;
  /** 重命名目标路径（mode === rename 时存在） */
  targetPath?: string;
}

/** 取路径的父目录（去掉最后一段） */
function parentDir(path: string): string {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : path;
}

/** 单个节点（目录或文件），自包含展开状态 */
function TreeNode({
  entry,
  depth,
  onOpenFile,
  activeFile,
  onOpenMenu,
  dirRefreshers,
}: {
  entry: FileEntry;
  depth: number;
  onOpenFile: (path: string) => void;
  activeFile: string | null;
  /** 右键 → 通知 FileTree 弹出菜单 */
  onOpenMenu: (e: React.MouseEvent, kind: MenuKind, target: FileEntry) => void;
  /** 目录刷新注册表（FileTree 持有，操作成功后按目录刷新） */
  dirRefreshers: React.MutableRefObject<Map<string, () => void>>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  /** 重拉本目录子项（操作成功后的刷新入口） */
  const reloadChildren = useCallback(async () => {
    if (!entry.is_dir) return;
    try {
      setChildren(await listDir(entry.path));
    } catch (err) {
      console.error(`读取目录失败: ${entry.path}`, err);
      setChildren([]);
    }
  }, [entry.path, entry.is_dir]);

  /** 点击行：目录切换展开（懒加载子项），文件通知打开 */
  const handleClick = useCallback(async () => {
    if (!entry.is_dir) {
      onOpenFile(entry.path);
      return;
    }
    const next = !expanded;
    setExpanded(next);
    if (next) {
      setLoading(true);
      try {
        setChildren(await listDir(entry.path));
      } catch (err) {
        console.error(`读取目录失败: ${entry.path}`, err);
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
  }, [entry, expanded, onOpenFile]);

  // 目录展开后把自己的刷新函数注册到全局表，
  // 右键新建子文件等操作成功后由 FileTree 直接调用（不用重建整棵树）
  useEffect(() => {
    if (!entry.is_dir || !expanded) return;
    dirRefreshers.current.set(entry.path, reloadChildren);
    return () => {
      if (dirRefreshers.current.get(entry.path) === reloadChildren) {
        dirRefreshers.current.delete(entry.path);
      }
    };
  }, [entry.is_dir, entry.path, expanded, reloadChildren, dirRefreshers]);

  const isActive = !entry.is_dir && entry.path === activeFile;

  return (
    <div>
      <div
        className={`tree-row ${isActive ? "tree-row-active" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={handleClick}
        onContextMenu={(e) => onOpenMenu(e, entry.is_dir ? "dir" : "file", entry)}
        title={entry.path}
      >
        {/* 展开箭头：目录显示 ▸/▾，文件占位保持对齐 */}
        <span className="tree-arrow">
          {entry.is_dir ? (expanded ? "▾" : "▸") : ""}
        </span>
        {/* 图标：目录用文件夹符号，文件用圆点 */}
        <span className="tree-icon">{entry.is_dir ? "▤" : "·"}</span>
        {/* 文件名：允许选中复制（侧边栏其余区域禁止复制） */}
        <span className="tree-name">{entry.name}</span>
      </div>
      {/* 目录展开后的子节点（懒加载） */}
      {entry.is_dir && expanded && (
        <div className="tree-children">
          {loading ? (
            <div className="tree-hint" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
              加载中…
            </div>
          ) : (
            children?.map((child) => (
              <TreeNode
                key={child.path}
                entry={child}
                depth={depth + 1}
                onOpenFile={onOpenFile}
                activeFile={activeFile}
                onOpenMenu={onOpenMenu}
                dirRefreshers={dirRefreshers}
              />
            ))
          )}
          {!loading && children?.length === 0 && (
            <div className="tree-hint" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
              空
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 文件树根：渲染根目录的直接子项 + 全局右键菜单 */
export function FileTree({ rootDir, onOpenFile, activeFile }: FileTreeProps) {
  const [rootChildren, setRootChildren] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  /** 右键菜单状态（null = 关闭） */
  const [menu, setMenu] = useState<ContextMenu | null>(null);
  /** 新建/重命名输入态（null = 无） */
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  /** 操作错误提示（显示在菜单内） */
  const [error, setError] = useState<string | null>(null);
  /** 目录刷新注册表：path → 该目录子项的刷新函数 */
  const dirRefreshers = useRef(new Map<string, () => void>());

  // rootDir 变化（或切换到新文件夹）时重新加载
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setRootChildren(await listDir(rootDir));
    } catch (err) {
      console.error(`读取根目录失败: ${rootDir}`, err);
      setRootChildren([]);
    } finally {
      setLoading(false);
    }
  }, [rootDir]);

  // 首次挂载与 rootDir 变化时加载
  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * 操作成功后刷新“指定目录”的子项：
   *   该目录已展开（注册表有）→ 调它的刷新函数；
   *   未展开或就是根目录 → 整体重拉根（根目录只在这里维护）。
   */
  const refreshDir = useCallback(
    (dir: string) => {
      const fn = dirRefreshers.current.get(dir);
      if (fn) void fn();
      else void reload();
    },
    [reload],
  );

  /** 关闭菜单（含输入态） */
  const closeMenu = useCallback(() => {
    setMenu(null);
    setPrompt(null);
    setError(null);
  }, []);

  /** 空白处右键：弹出新建菜单 */
  const handleBlankContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setPrompt(null);
    setError(null);
    setMenu({ x: e.clientX, y: e.clientY, kind: "blank" });
  }, []);

  /** 节点右键：弹出文件/文件夹菜单 */
  const handleOpenMenu = useCallback(
    (e: React.MouseEvent, kind: MenuKind, target: FileEntry) => {
      e.preventDefault();
      e.stopPropagation();
      setPrompt(null);
      setError(null);
      setMenu({ x: e.clientX, y: e.clientY, kind, target });
    },
    [],
  );

  /** 点击空白处 / Esc 关闭菜单 */
  useEffect(() => {
    if (!menu) return;
    const close = () => closeMenu();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu, closeMenu]);

  /** 打开输入态：新建文件/文件夹/重命名共用 */
  const startPrompt = useCallback(
    (mode: PromptState["mode"], dir: string, initial = "", targetPath?: string) => {
      setPrompt({ mode, dir, initial, targetPath });
      setError(null);
    },
    [],
  );

  /** 执行新建/重命名，成功后刷新并关菜单 */
  const submitPrompt = useCallback(
    async (name: string) => {
      if (!prompt) return;
      const value = name.trim();
      if (!value) {
        setError("名称不能为空");
        return;
      }
      try {
        if (prompt.mode === "createFile") {
          // 文件名没有 .md/.markdown 后缀时自动补齐（否则文件树里看不到）
          const finalName = /\.(md|markdown)$/i.test(value) ? value : `${value}.md`;
          await createFile(prompt.dir, finalName);
          refreshDir(prompt.dir);
        } else if (prompt.mode === "createFolder") {
          await createFolder(prompt.dir, value);
          refreshDir(prompt.dir);
        } else if (prompt.mode === "rename" && prompt.targetPath) {
          await renamePath(prompt.targetPath, value);
          refreshDir(prompt.dir);
        }
        closeMenu();
      } catch (err) {
        setError(String(err));
      }
    },
    [prompt, refreshDir, closeMenu],
  );

  /** 删除文件/文件夹（二次确认后执行） */
  const handleDelete = useCallback(
    async (target: FileEntry) => {
      const ok = window.confirm(
        `确定删除「${target.name}」？${target.is_dir ? "（文件夹及其全部内容）" : ""}`,
      );
      if (!ok) return;
      try {
        await deletePath(target.path);
        refreshDir(parentDir(target.path));
        closeMenu();
      } catch (err) {
        setError(String(err));
      }
    },
    [refreshDir, closeMenu],
  );

  // 菜单项配置：kind → 可执行的操作
  const items =
    menu?.kind === "blank"
      ? [
          { label: "新建文件", run: () => startPrompt("createFile", rootDir) },
          { label: "新建文件夹", run: () => startPrompt("createFolder", rootDir) },
        ]
      : menu?.kind === "file" && menu.target
        ? [
            {
              label: "重命名",
              run: () =>
                startPrompt("rename", parentDir(menu.target!.path), menu.target!.name, menu.target!.path),
            },
            { label: "删除", run: () => void handleDelete(menu.target!) },
          ]
        : menu?.kind === "dir" && menu.target
          ? [
              {
                label: "新建子文件",
                run: () => startPrompt("createFile", menu.target!.path),
              },
              {
                label: "重命名",
                run: () =>
                  startPrompt("rename", parentDir(menu.target!.path), menu.target!.name, menu.target!.path),
              },
              { label: "删除", run: () => void handleDelete(menu.target!) },
            ]
          : [];

  return (
    <div className="file-tree" onContextMenu={handleBlankContextMenu}>
      {loading && rootChildren === null ? (
        <div className="tree-hint">加载中…</div>
      ) : (
        rootChildren?.map((child) => (
          <TreeNode
            key={child.path}
            entry={child}
            depth={0}
            onOpenFile={onOpenFile}
            activeFile={activeFile}
            onOpenMenu={handleOpenMenu}
            dirRefreshers={dirRefreshers}
          />
        ))
      )}
      {!loading && rootChildren?.length === 0 && (
        <div className="tree-hint">此文件夹内没有 Markdown 文件</div>
      )}

      {/* 右键菜单（自绘）：普通菜单项，或输入态（新建/重命名） */}
      {menu && (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {prompt ? (
            // 输入态：新建文件/文件夹/重命名共用一个输入框
            <div className="context-prompt">
              <div className="context-prompt-title">
                {prompt.mode === "createFile" && "新建文件"}
                {prompt.mode === "createFolder" && "新建文件夹"}
                {prompt.mode === "rename" && "重命名"}
              </div>
              <input
                className="context-prompt-input"
                autoFocus
                defaultValue={prompt.initial}
                placeholder={
                  prompt.mode === "createFile" ? "未命名.md" : "输入名称"
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void submitPrompt((e.target as HTMLInputElement).value);
                  } else if (e.key === "Escape") {
                    closeMenu();
                  }
                }}
              />
              {error && <div className="context-error">{error}</div>}
              <div className="context-prompt-actions">
                <button
                  className="context-btn"
                  onClick={() => {
                    const input = document.querySelector(
                      ".context-prompt-input",
                    ) as HTMLInputElement | null;
                    void submitPrompt(input?.value ?? "");
                  }}
                >
                  确定
                </button>
                <button className="context-btn" onClick={closeMenu}>
                  取消
                </button>
              </div>
            </div>
          ) : (
            // 普通菜单项列表
            items.map((item) => (
              <div key={item.label} className="context-item" onClick={item.run}>
                {item.label}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
