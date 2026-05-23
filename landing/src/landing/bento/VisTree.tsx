import { Folder, File } from "lucide-react";

export function VisTree() {
  return (
    <div className="lr-tree">
      <div className="lr-tree-folder">
        <Folder size={11} strokeWidth={1.7} /> Biology
      </div>
      <div className="lr-tree-row is-active">
        <span className="l-i"><File size={11} strokeWidth={1.7} /></span> Photosynthesis
      </div>
      <div className="lr-tree-row">
        <span className="l-i"><File size={11} strokeWidth={1.7} /></span> Cell Structure
      </div>
      <div className="lr-tree-row">
        <span className="l-i"><File size={11} strokeWidth={1.7} /></span> Chloroplast
      </div>
      <div className="lr-tree-folder">
        <Folder size={11} strokeWidth={1.7} /> AI Lecture Notes
      </div>
      <div className="lr-tree-row">
        <span className="l-i"><File size={11} strokeWidth={1.7} /></span> Biology Lecture — May 13
      </div>
    </div>
  );
}
