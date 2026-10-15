export default function WorkspaceLoading() {
  return <section className="workspace-view loading-view" aria-busy="true" aria-label="正在加载工作区">
    <header className="workspace-toolbar"><div><h1 role="status">正在加载</h1><span className="skeleton short loading-subtitle" aria-hidden="true" /></div></header>
    <div className="workspace-split" aria-hidden="true"><div className="list-workspace">
      <div className="filterbar"><span className="skeleton short" /><span className="skeleton short" /><span className="skeleton short" /></div>
      <div className="data-list">
        <div className="list-heading"><span className="skeleton short" /><span className="skeleton short" /><span /><span className="skeleton short" /></div>
        {Array.from({ length: 7 }, (_, index) => <div className="loading-row" key={index}>
          <span className="content-primary"><span className="skeleton icon" /><span className="skeleton title" /></span><span className="skeleton tag" /><span className="skeleton tag" />
        </div>)}
      </div>
    </div></div>
  </section>;
}
