// src/sidebar/FileTree.tsx —— 文件树（侧边栏）
//
// 整体架构位置：
//   src/sidebar/ 存放侧边栏文件树组件，只做 UI 与交互；
//   数据来自 src/lib/fs.ts 的 listDir()（Rust 侧过滤了噪音目录与
//   非 Markdown 文件）。
//
// 行为设计：
//   - 目录节点：点击展开/折叠，首次展开时懒加载子项；
//   - 文件节点：点击通知 App 打开（onOpenFile）；
//   - 目录递归渲染（TreeNode 自己调自己）；
//   - 缩进由 depth 控制。

import { useCallback, useEffect, useState } from "react";
import { listDir, type FileEntry } from "../lib/fs";

interface FileTreeProps {
  /** 已打开的根目录绝对路径 */
  rootDir: string;
  /** 点击文件时的回调（App 负责读取并载入编辑器） */
  onOpenFile: (path: string) => void;
  /** 当前打开的文件（用于高亮） */
  activeFile: string | null;
}

/** 单个节点（目录或文件），自包含展开状态 */
function TreeNode({
  entry,
  depth,
  onOpenFile,
  activeFile,
}: {
  entry: FileEntry;
  depth: number;
  onOpenFile: (path: string) => void;
  activeFile: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

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

  const isActive = !entry.is_dir && entry.path === activeFile;

  return (
    <div>
      <div
        className={`tree-row ${isActive ? "tree-row-active" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={handleClick}
        title={entry.path}
      >
        {/* 展开箭头：目录显示 ▸/▾，文件占位保持对齐 */}
        <span className="tree-arrow">
          {entry.is_dir ? (expanded ? "▾" : "▸") : ""}
        </span>
        {/* 图标：目录用文件夹符号，文件用圆点 */}
        <span className="tree-icon">{entry.is_dir ? "▤" : "·"}</span>
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

/** 文件树根：渲染根目录的直接子项 */
export function FileTree({ rootDir, onOpenFile, activeFile }: FileTreeProps) {
  const [rootChildren, setRootChildren] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

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

  return (
    <div className="file-tree">
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
          />
        ))
      )}
      {!loading && rootChildren?.length === 0 && (
        <div className="tree-hint">此文件夹内没有 Markdown 文件</div>
      )}
    </div>
  );
}
