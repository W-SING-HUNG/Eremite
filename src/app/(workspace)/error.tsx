"use client";

export default function WorkspaceError({ reset }: { reset: () => void }) {
  return <section className="workspace-view error-view"><h1>无法加载此工作区</h1><p>请重新尝试。若问题持续存在，请检查本地数据和备份。</p><button className="primary-button" type="button" onClick={reset}>重新尝试</button></section>;
}
