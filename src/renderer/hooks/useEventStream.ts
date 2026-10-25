import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { ApprovalRequest, AsteriaEvent, BootstrapResult, Catalogs, Connections, Conversation, Message } from '../types';
import { EMPTY_CATALOGS, mergeConversation, upsertMessage } from '../lib/state';

/** State setters the stream needs; `useState` setters are stable, so this stays render-safe. */
export type StreamSetters = {
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
  setConversation: Dispatch<SetStateAction<Conversation | null>>;
  setConnections: Dispatch<SetStateAction<Connections>>;
  setCatalogs: Dispatch<SetStateAction<Catalogs>>;
  setApprovals: Dispatch<SetStateAction<ApprovalRequest[]>>;
};

export type EventStreamOptions = StreamSetters & {
  /** Runs once bootstrap resolves; `isDisposed()` guards the stray StrictMode pass. */
  onBootstrap(result: BootstrapResult, isDisposed: () => boolean): void | Promise<void>;
  onBootstrapError(failure: unknown): void;
};

/** Pure reducer for one pushed event, kept separate so the mapping is reviewable in one place. */
export function applyEvent(event: AsteriaEvent, state: StreamSetters) {
  if (event.kind === 'connections') {
    state.setConnections(event.connections || {});
    state.setCatalogs(event.catalogs || EMPTY_CATALOGS);
    return;
  }
  if (event.kind === 'approval') {
    const request: ApprovalRequest = {
      conversationId: event.conversationId,
      requestId: event.requestId,
      cli: event.cli,
      prompt: event.prompt,
      options: event.options,
    };
    state.setApprovals((items) => [...items.filter((item) => item.requestId !== request.requestId), request]);
    return;
  }
  if (event.kind === 'approval_expired') {
    state.setApprovals((items) => items.filter((item) => item.requestId !== event.requestId));
    return;
  }
  if (event.kind === 'conversation') {
    const item = event.conversation;
    state.setConversations((items) => mergeConversation(items, item));
    state.setConversation((current) => (current?.id === item.id ? { ...current, ...item } : current));
    return;
  }
  if (event.kind === 'message') {
    state.setConversation((current) => (current && current.id === event.conversationId ? upsertMessage(current, event.message) : current));
    return;
  }
  if (event.kind === 'event') {
    if (event.event.type === 'approval_decision') {
      const decided = event.event.requestId;
      state.setApprovals((items) => items.filter((item) => item.requestId !== decided));
    }
    state.setConversation((current) => {
      if (!current || current.id !== event.conversationId) return current;
      const previous = current.events || [];
      if (previous.some((item) => item.id === event.event.id)) return current;
      return { ...current, events: [...previous, event.event] };
    });
    return;
  }
  if (event.kind === 'turn_complete') {
    state.setApprovals((items) => items.filter((item) => item.conversationId !== event.conversationId));
  }
}

/** Subscribes to the main-process event stream for the lifetime of the app. */
export function useEventStream(options: EventStreamOptions) {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    let disposed = false;
    const isDisposed = () => disposed;
    const bridge = window.asteria;

    bridge.bootstrap()
      .then((result) => {
        if (disposed) return;
        return latest.current.onBootstrap(result, isDisposed);
      })
      .catch((failure: unknown) => {
        if (disposed) return;
        latest.current.onBootstrapError(failure);
      });

    // Message pushes arrive once per token. Hitting `setConversation` for every one of them makes
    // React re-render and re-parse Markdown hundreds of times a second, which looks like the reply
    // stalling and then landing all at once. Coalesce to one state write per animation frame.
    const pending = new Map<string, { conversationId: string; message: Message }>();
    let frame = 0;
    const flush = () => {
      frame = 0;
      if (!pending.size) return;
      const batch = [...pending.values()];
      pending.clear();
      latest.current.setConversation((current) => {
        if (!current) return current;
        let next = current;
        for (const item of batch) {
          if (next.id !== item.conversationId) continue;
          next = upsertMessage(next, item.message);
        }
        return next;
      });
    };

    const unsubscribe = bridge.onEvent((event) => {
      if (event.kind === 'message') {
        // Every delta carries the accumulated text, so the newest entry wins outright.
        pending.set(`${event.conversationId}:${event.message.id}`, { conversationId: event.conversationId, message: event.message });
        if (!frame) frame = requestAnimationFrame(flush);
        return;
      }
      applyEvent(event, latest.current);
    });

    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      pending.clear();
      unsubscribe();
    };
  }, []);
}
