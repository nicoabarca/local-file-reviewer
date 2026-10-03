import { useEffect, useRef } from 'react';

const SHORTCUTS = [
  ['C', 'Comment on the selected text'],
  ['T / R', 'Text tool / region tool'],
  ['Enter', 'Region tool: place a box on the focused page, Enter again to comment'],
  ['Arrows', 'Region box: move · Shift resize · Alt fine steps'],
  ['N / P', 'Next / previous page'],
  ['G', 'Go to page number'],
  ['] / [', 'Next / previous comment'],
  ['+ / − / 0', 'Zoom in / out / fit width'],
  ['E', 'Export feedback'],
  ['⌘/Ctrl+Enter', 'Save the comment being edited'],
  ['Esc', 'Cancel draft, leave region tool, close dialogs'],
];

export default function ShortcutsDialog({ open, onClose, storage }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog narrow" onClose={onClose} aria-labelledby="keys-title">
      <header className="dialogHead">
        <h2 id="keys-title">Keyboard</h2>
        <button type="button" className="btn ghost" onClick={onClose} autoFocus>
          Esc
        </button>
      </header>
      <table className="keys">
        <tbody>
          {SHORTCUTS.map(([k, v]) => (
            <tr key={k}>
              <th scope="row">
                <kbd>{k}</kbd>
              </th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        Text can also be selected with the keyboard using caret browsing (F7 in most browsers). Reviews autosave to{' '}
        {storage}. Nothing is uploaded.
      </p>
    </dialog>
  );
}
