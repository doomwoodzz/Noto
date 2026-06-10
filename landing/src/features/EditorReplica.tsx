// A static replica of Noto's native Markdown editor pane, matching the
// inline-formatting + wiki-link + checklist syntax the real NSTextView renders.

export function EditorReplica() {
  return (
    <div className="f-editor">
      <div className="f-editor-gutter">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i}>{i + 1}</span>
        ))}
      </div>
      <div className="f-editor-body">
        <div className="f-ed-line"><span className="f-ed-h1"># Photosynthesis</span></div>
        <div className="f-ed-line f-ed-blank" />
        <div className="f-ed-line">
          The process by which <span className="f-ed-bold">chloroplasts</span> convert
        </div>
        <div className="f-ed-line">
          light into <span className="f-ed-italic">chemical energy</span> stored as{" "}
          <span className="f-ed-link">[[Glucose]]</span>.
        </div>
        <div className="f-ed-line f-ed-blank" />
        <div className="f-ed-line"><span className="f-ed-h2">## Key ideas</span></div>
        <div className="f-ed-line"><span className="f-ed-task done">- [x]</span> Light-dependent reactions</div>
        <div className="f-ed-line"><span className="f-ed-task">- [ ]</span> Calvin cycle <span className="f-ed-tag">#review</span></div>
        <div className="f-ed-line">
          - See also <span className="f-ed-link">[[Cell Structure]]</span>
          <span className="f-ed-caret" />
        </div>
      </div>
    </div>
  );
}
