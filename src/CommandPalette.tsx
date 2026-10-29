// Command palette (Ctrl/Cmd+K): jump to any page or run a quick action without leaving the keyboard.
import { useEffect, useMemo, useRef, useState } from 'react';
import { matchItems, type PaletteItem } from './palette.ts';
import { Icon } from './ui.tsx';

export function CommandPalette(props: { items: PaletteItem[]; onRun: (id: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useMemo(() => matchItems(props.items, query), [props.items, query]);

  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => setActive(0), [query]);

  const choose = (id: string) => {
    props.onRun(id);
    props.onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      props.onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!list.length) return;
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = list[active] ?? list[0];
      if (pick) choose(pick.id);
    }
  };

  return (
    <div
      className="modal-backdrop palette-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Jump to a page or action">
        <div className="palette-input">
          <Icon name="search" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a page or run an action…"
            aria-label="Search pages and actions"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-autocomplete="list"
            aria-activedescendant={list[active] ? `palette-${list[active].id}` : undefined}
          />
          <kbd>esc</kbd>
        </div>
        <ul id="palette-list" role="listbox" aria-label="Results" className="palette-list">
          {list.map((item, i) => (
            <li
              key={item.id}
              id={`palette-${item.id}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'palette-option on' : 'palette-option'}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(item.id);
              }}
            >
              <Icon name={item.icon} />
              <span className="palette-label">{item.label}</span>
              <span className="palette-group">{item.group}</span>
            </li>
          ))}
          {!list.length && <li className="palette-empty">Nothing matches “{query}”.</li>}
        </ul>
      </div>
    </div>
  );
}
