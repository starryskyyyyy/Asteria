import { useEffect, useRef, useState } from 'react';

/**
 * The model's chain of thought, shown above the answer.
 *
 * It opens itself while a turn is live so the reasoning is visible as it arrives, then folds down
 * to a one-line summary once the answer lands. A manual toggle wins from then on — `touched` makes
 * sure an auto-collapse never yanks the panel away while the reader is scrolling through it.
 */
export function ReasoningPanel({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(streaming);
  const [touched, setTouched] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!touched) setOpen(streaming); }, [streaming, touched]);

  useEffect(() => {
    if (!open || !streaming) return;
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [text, open, streaming]);

  if (!text) return null;

  return (
    <section className={`reasoning${open ? ' is-open' : ''}${streaming ? ' is-live' : ''}`}>
      <button
        type="button"
        className="reasoning-head"
        aria-expanded={open}
        onClick={() => { setTouched(true); setOpen((value) => !value); }}
      >
        <i className="reasoning-spark" aria-hidden="true">✦</i>
        <b>{streaming ? '思考中' : '思考过程'}</b>
        <span className="reasoning-hint">{streaming ? '' : `${text.length} 字`}</span>
        <i className="reasoning-caret" aria-hidden="true">›</i>
      </button>
      {open ? <div className="reasoning-body" ref={bodyRef}>{text}</div> : null}
    </section>
  );
}
