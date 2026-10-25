import { useRef, useState, type KeyboardEvent } from 'react';
import { Spinner } from './Spinner';

export function Composer({
  draft,
  busy,
  anyActive,
  thisActive,
  bottomHint,
  onDraftChange,
  onSend,
  onStop,
}: {
  draft: string;
  busy: boolean;
  anyActive: boolean;
  thisActive: boolean;
  bottomHint: string;
  onDraftChange(value: string): void;
  onSend(): void;
  onStop(): void;
}) {
  const [composing, setComposing] = useState(false);
  const composingRef = useRef(false);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (composing || composingRef.current || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (anyActive || busy) return;
    onSend();
  }

  return (
    <footer className="composer-wrap">
      <div className="composer-box">
        <textarea
          rows={2}
          value={draft}
          placeholder={thisActive ? '生成中…（可停止）' : '给模型发送消息…（Enter 发送，Shift+Enter 换行）'}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => { composingRef.current = true; setComposing(true); }}
          onCompositionEnd={() => { composingRef.current = false; setComposing(false); }}
        />
        <div className="composer-bottom">
          <span>{bottomHint}</span>
          {thisActive ? (
            <button className="stop-button" type="button" onClick={() => void onStop()}>■ 停止</button>
          ) : (
            <button className="send-button" type="button" disabled={busy || anyActive} onClick={() => void onSend()}>
              {busy ? <><Spinner size={11} />发送中…</> : <>发送<span aria-hidden="true">↵</span></>}
            </button>
          )}
        </div>
      </div>
      <p className="composer-footnote">模型可通过 Asteria 工具委派其他 CLI 代理。子代理共享本对话工作目录并受任务时限约束。</p>
    </footer>
  );
}
