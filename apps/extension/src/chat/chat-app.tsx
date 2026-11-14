import * as React from 'react';
import { botAppAvatar, botById } from '@geld/review';
import { cn } from 'cn';
import { ICON_CHEVRON_DOWN, ICON_LINK_EXTERNAL, ICON_PAPER_AIRPLANE, ICON_SPARKLE_FILL, ICON_SQUARE_FILL, ICON_TRASH, ICON_X } from '../github/ui/icons';
import { Markdown } from './markdown';
import { Octicon } from './octicon';
import { PortalContainer } from './portal';
import { Bubble, BubbleContent } from './ui/bubble';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from './ui/empty';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from './ui/input-group';
import { Message, MessageContent, MessageFooter, MessageHeader } from './ui/message';
import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport } from './ui/message-scroller';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { Trace, TraceLine, TraceTitle } from './ui/trace';
import type { ChatActions, ChatBodyView, ChatComposerView, ChatTabView, ChatTurnView, ChatView } from './view';

/** Cursor's mark: the review bot registry's for Bugbot, Cursor's own GitHub App. */
const CURSOR_MARK = ((): string | null => {
  const bot = botById('bugbot');
  return bot === null ? null : botAppAvatar(bot, 40);
})();

function Mark({ kind }: { readonly kind: 'assistant' | 'cursor' }) {
  if (kind === 'cursor') return CURSOR_MARK === null ? <span className="size-4 shrink-0" /> : <img src={CURSOR_MARK} alt="" width={16} height={16} className="size-4 shrink-0 rounded-[4px]" />;
  return <Octicon markup={ICON_SPARKLE_FILL} className="inline-flex shrink-0 text-(--fgColor-done)" />;
}

function IconButton({ label, onClick, children }: { readonly label: string; readonly onClick: () => void; readonly children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} />}>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function Tabs({ tabs, active, actions }: { readonly tabs: readonly ChatTabView[]; readonly active: string; readonly actions: ChatActions }) {
  const list = React.useRef<HTMLDivElement>(null);
  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === active);
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    if (next === undefined) return;
    actions.selectThread(next.id);
    list.current?.querySelector<HTMLElement>(`[data-thread="${CSS.escape(next.id)}"]`)?.focus();
  };
  return (
    <div ref={list} role="tablist" aria-label="Conversations" className="no-scrollbar flex min-w-0 flex-1 gap-1 overflow-x-auto" onKeyDown={onKeyDown}>
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            data-thread={tab.id}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            title={tab.title}
            onClick={() => actions.selectThread(tab.id)}
            className={cn(
              'inline-flex h-7 max-w-48 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50',
              selected && 'bg-muted text-foreground',
            )}
          >
            <Mark kind={tab.kind} />
            <span className="truncate">{tab.label}</span>
            {tab.running && <span aria-label="Working" className="size-1.5 shrink-0 rounded-full bg-(--fgColor-attention)" />}
          </button>
        );
      })}
    </div>
  );
}

function Bar({ view }: { readonly view: ChatView }) {
  const { text, status, link } = view.bar;
  if (text === null && status === null && link === null) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-border px-4 py-2 text-xs text-muted-foreground">
      {status !== null && (
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <span className={cn('size-1.5 rounded-full', status.running ? 'bg-(--fgColor-attention)' : 'bg-muted-foreground')} />
          {status.words}
        </span>
      )}
      {text !== null && <span className="flex-1">{text}</span>}
      {link !== null && (
        <a href={link.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-(--fgColor-accent) hover:underline">
          {link.label}
          <Octicon markup={ICON_LINK_EXTERNAL} className="inline-flex shrink-0 [&_svg]:size-3" />
        </a>
      )}
    </div>
  );
}

function Turn({ turn }: { readonly turn: ChatTurnView }) {
  if (turn.role === 'user') {
    return (
      <Message align="end">
        <MessageContent>
          <Bubble align="end" variant="secondary">
            <BubbleContent className="max-h-80 overflow-y-auto whitespace-pre-wrap">{turn.text}</BubbleContent>
          </Bubble>
          {turn.error !== null && <MessageFooter className="text-destructive">{turn.error}</MessageFooter>}
          {turn.note !== null && <MessageFooter>{turn.note}</MessageFooter>}
        </MessageContent>
      </Message>
    );
  }
  const thinking = turn.streaming && turn.text === '' && turn.tools.length === 0;
  return (
    <Message>
      <MessageContent>
        <MessageHeader className="gap-1.5 px-0">
          <Mark kind={turn.author} />
          {turn.author === 'cursor' ? 'Cursor' : 'Assistant'}
        </MessageHeader>
        {(turn.tools.length > 0 || thinking) && (
          <Trace className="gap-1">
            {turn.tools.map((tool) => (
              <TraceLine key={tool.callId} {...(tool.done ? {} : { status: 'running' as const })} className="font-mono text-xs">
                <TraceTitle>{tool.line}</TraceTitle>
              </TraceLine>
            ))}
            {thinking && (
              <TraceLine status="running">
                <TraceTitle>Thinking</TraceTitle>
              </TraceLine>
            )}
          </Trace>
        )}
        {turn.text !== '' && <Markdown streaming={turn.streaming}>{turn.text}</Markdown>}
        {turn.error !== null && <p className="text-xs text-destructive">{turn.error}</p>}
        {turn.note !== null && <p className="text-xs text-muted-foreground">{turn.note}</p>}
      </MessageContent>
    </Message>
  );
}

function Body({ body, actions }: { readonly body: ChatBodyView; readonly actions: ChatActions }) {
  if (body.kind === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <Trace className="w-fit">
          <TraceLine status="running">
            <TraceTitle>{body.text}</TraceTitle>
          </TraceLine>
        </Trace>
      </div>
    );
  }
  if (body.kind === 'empty') {
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyTitle>{body.title}</EmptyTitle>
          <EmptyDescription>{body.text}</EmptyDescription>
        </EmptyHeader>
        {(body.actions.length > 0 || body.prompts.length > 0) && (
          <EmptyContent className="flex-row flex-wrap justify-center gap-2">
            {body.actions.map((action) =>
              action.kind === 'settings' ? (
                <Button key={action.label} variant="outline" size="sm" onClick={actions.openSettings}>
                  {action.label}
                </Button>
              ) : (
                <Button key={action.label} variant="outline" size="sm" render={<a href={action.href} target="_blank" rel="noreferrer" />}>
                  {action.label}
                </Button>
              ),
            )}
            {body.prompts.map((prompt) => (
              <Button key={prompt} variant="outline" size="xs" className="rounded-full font-normal" onClick={() => actions.sendPrompt(prompt)}>
                {prompt}
              </Button>
            ))}
          </EmptyContent>
        )}
      </Empty>
    );
  }
  return (
    <MessageScroller>
      <MessageScrollerViewport>
        <MessageScrollerContent className="gap-5 p-4">
          {body.turns.map((turn) => (
            <MessageScrollerItem key={turn.id} messageId={turn.id} scrollAnchor={turn.role === 'user'}>
              <Turn turn={turn} />
            </MessageScrollerItem>
          ))}
          {body.pending !== null && (
            <MessageScrollerItem messageId="pending">
              <Trace>
                <TraceLine status="running">
                  <TraceTitle>{body.pending}</TraceTitle>
                </TraceLine>
              </Trace>
            </MessageScrollerItem>
          )}
          {body.notices.map((notice) => (
            <MessageScrollerItem key={notice} messageId={`notice:${notice}`}>
              <p className="text-xs text-destructive">{notice}</p>
            </MessageScrollerItem>
          ))}
        </MessageScrollerContent>
      </MessageScrollerViewport>
      <MessageScrollerButton />
    </MessageScroller>
  );
}

function ModelMenu({ composer, onChoose }: { readonly composer: ChatComposerView; readonly onChoose: (value: string) => void }) {
  const current = composer.models.find((option) => option.value === composer.model)?.label ?? composer.model;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={composer.modelDisabled}
        title={composer.modelTitle}
        render={<InputGroupButton size="xs" className="max-w-56 min-w-0 font-normal text-muted-foreground" aria-label={`Model: ${current}`} />}
      >
        <span className="truncate">{current}</span>
        <Octicon markup={ICON_CHEVRON_DOWN} className="inline-flex shrink-0 [&_svg]:size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-64 max-w-[calc(100vw-2rem)]">
        <DropdownMenuRadioGroup value={composer.model} onValueChange={(value) => typeof value === 'string' && onChoose(value)}>
          <DropdownMenuLabel>Model for the next reply</DropdownMenuLabel>
          {composer.models.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <span className="truncate">{option.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Composer({ thread, composer, actions }: { readonly thread: string; readonly composer: ChatComposerView; readonly actions: ChatActions }) {
  // A draft per thread: switching tabs keeps what was typed for each conversation.
  const drafts = React.useRef(new Map<string, string>());
  const [draft, setDraft] = React.useState({ thread, text: '' });
  let text = draft.text;
  if (draft.thread !== thread) {
    drafts.current.set(draft.thread, draft.text);
    text = drafts.current.get(thread) ?? '';
    setDraft({ thread, text });
  }
  React.useEffect(() => actions.draftChanged(text.trim() === ''), [actions, text]);
  const update = (value: string): void => setDraft({ thread, text: value });
  const submitDraft = (): void => {
    if (composer.mode === 'stop' || text.trim() === '' || !composer.canSend) return;
    actions.submit(text);
    update('');
  };
  // Only the button stops a reply: Enter while drafting the next question must not cut the answer short.
  const send = (): void => {
    if (composer.mode === 'stop') actions.stop();
    else submitDraft();
  };
  const label = composer.mode === 'stop' ? 'Stop the reply' : composer.mode === 'steer' ? 'Send into the running turn' : 'Send';
  return (
    <form
      className="shrink-0 p-3 pt-0"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <InputGroup className="rounded-xl bg-background">
        <InputGroupTextarea
          value={text}
          onChange={(event) => update(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submitDraft();
            }
          }}
          placeholder={composer.placeholder}
          disabled={composer.disabled}
          aria-label="Message"
          className="max-h-52 min-h-12"
        />
        <InputGroupAddon align="block-end" className="justify-between">
          <ModelMenu composer={composer} onChoose={actions.chooseModel} />
          <Tooltip>
            <TooltipTrigger
              render={
                <InputGroupButton
                  type="submit"
                  size="icon-xs"
                  variant="default"
                  aria-label={label}
                  className="rounded-full"
                  disabled={composer.mode !== 'stop' && (!composer.canSend || text.trim() === '')}
                />
              }
            >
              <Octicon markup={composer.mode === 'stop' ? ICON_SQUARE_FILL : ICON_PAPER_AIRPLANE} className="inline-flex shrink-0 [&_svg]:size-3.5" />
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

/** The whole sidebar for one view: what the store says, nothing kept but the composer's draft. */
export function ChatPanel({ view, actions }: { readonly view: ChatView; readonly actions: ChatActions }) {
  return (
    <div
      className="flex h-full flex-col bg-background text-sm text-foreground"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) actions.close();
      }}
    >
      <header className="flex shrink-0 items-center gap-1 border-b border-border py-2 ps-3 pe-2">
        <Tabs tabs={view.tabs} active={view.active} actions={actions} />
        {view.canClear && (
          <IconButton label="Clear this chat" onClick={actions.clear}>
            <Octicon markup={ICON_TRASH} />
          </IconButton>
        )}
        <IconButton label="Close chat" onClick={actions.close}>
          <Octicon markup={ICON_X} />
        </IconButton>
      </header>
      <Bar view={view} />
      <MessageScrollerProvider autoScroll>
        <div className="flex min-h-0 flex-1 flex-col">
          <Body body={view.body} actions={actions} />
        </div>
      </MessageScrollerProvider>
      <Composer thread={view.active} composer={view.composer} actions={actions} />
    </div>
  );
}

/** What stands in the panel when the view failed, rather than an empty box. */
export function ChatCrashed({ onClose }: { readonly onClose: () => void }) {
  return (
    <Empty className="h-full bg-background text-foreground">
      <EmptyHeader>
        <EmptyTitle>The chat stopped working</EmptyTitle>
        <EmptyDescription>Close it and open it again. Geld noted the error.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" onClick={onClose}>
          Close chat
        </Button>
      </EmptyContent>
    </Empty>
  );
}

export function ChatApp({ subscribe, getView, actions, portal }: { readonly subscribe: (listener: () => void) => () => void; readonly getView: () => ChatView; readonly actions: ChatActions; readonly portal: HTMLElement }) {
  const view = React.useSyncExternalStore(subscribe, getView);
  return (
    <PortalContainer.Provider value={portal}>
      <TooltipProvider delay={400}>
        <ChatPanel view={view} actions={actions} />
      </TooltipProvider>
    </PortalContainer.Provider>
  );
}
