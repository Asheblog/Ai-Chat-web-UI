# Chat first-message spacing

User approved the Figma spacing study and requested implementation, local commit and merge to main, with no push. Reference: https://www.figma.com/design/HT9fauORjVnoES9mndVdsw/Untitled?node-id=2-2

## Contract

- Leave 24px below the header on narrow screens and 32px from the md breakpoint. The message viewport owns this space.
- Keep 32px between messages, owned by virtual rows. User bubbles use 12px vertical / 16px horizontal padding; actions remain 8px below content.
- Preserve current avatar visibility and full-width chat behavior, plus the approved single process progress entry. Do not restore redundant header badges or body waiting animation.
- Reuse the virtualized message list and existing Ink & Mist tokens. Long content must reflow, scroll and remain accessible.

## Execution

1. Adjust ChatMessageViewport, MessageList and MessageBubble spacing.
2. Verify the shared viewport in a development-only fixture at 1440px, 390px and 320px, plus the actual /main/1511 chat route at 1440px and 1920px with fixed API responses. Cover the desktop sidebar, conversation header, composer, process panel, long content, scrolling, empty and running/error states; retain narrow-screen dark mode coverage. Archive captures and measurements under docs/design/assets/chat-spacing; output/playwright/chat-spacing is the temporary browser output.
3. Run frontend tests and TypeScript checking, review the diff against the merge-base with origin/main, then commit and fast-forward merge into local main. No push.

## Review Focus

Check actual header-to-first-message distance, virtual row measurement and reading navigation, no cumulative margins, no clipping at narrow widths, current single progress behavior and clean staging limited to this task. Prior progress changes belong to this delivery; unrelated Figma exports and scratch artifacts remain outside the commit.

## Decisions

Ruling: retain the settled user-avatar omission — this study refines spacing, while the previous approved implementation explicitly removed the redundant avatar — restoring identity chrome would change the settled message interface.

Ruling: use the virtualizer's 32px gap — estimates and measured rows share the same spacing, with no trailing gap. The list's existing 16px end padding plus the pending indicator's 16px top padding already provide 32px before an assistant row exists. Preserve horizontal viewport padding.

Review disposition: adopted native virtual gap, preserved existing horizontal spacing, and removed trailing summary spacing when no answer follows. Kept independent status text and icon derivation because a warning icon can accompany a completed answer after stopping tools; their meanings differ. Existing icon/style tests guard the specific duplicate spinner and incorrect success-icon regressions. The streaming-only live region preserves the verified single-status contract. The preview measurement attribute is consumed by the browser scenario. Process/content naming refactors and extra comparison matrices do not affect this delivery. Shared bubble padding is intentional wherever MessageBubble is used; share and Battle process consumers retain their existing read-only behavior.

Ruling: restore a 56px desktop conversation header in normal flow — the actual /main route exposed an absolute account control overlapping the first user message, while the approved desktop frame has a distinct header. The header shows the current session title (falling back to 聊天), reserves account-control width, and is hidden below lg where the shell already owns the toolbar — leaving the overlay would invalidate the header-to-message spacing contract. Added regression coverage for occupied height, breakpoint visibility and title fallback.

## Acceptance

Frontend verification after the desktop-header fix: 162 test files / 975 tests passed; TypeScript passed. Real-browser measurements confirmed 32px top space at 1440px, 24px at 390px and 320px, and 32px between messages (31.6px measured at desktop due to subpixel text height). User bubble padding is 16px horizontal / 12px vertical. Long text reflows without horizontal overflow; the header remains fixed while the message viewport scrolls. Running has one spinner and an 8px gap before message actions; empty/error states render. No page exceptions or failed requests with actor and branding response fixtures.

Shared-component screenshots and exact scope are committed in [the acceptance record](../../design/assets/chat-spacing/acceptance.json), with [mobile](../../design/assets/chat-spacing/mobile390.png), [dark mode](../../design/assets/chat-spacing/mobile-dark.png) and [scrolling](../../design/assets/chat-spacing/mobile-scrolled.png) examples.

Actual desktop-route evidence is recorded separately in [desktop acceptance](../../design/assets/chat-spacing/desktop-acceptance.json), with [1440px](../../design/assets/chat-spacing/desktop-main-1440.png), [1920px](../../design/assets/chat-spacing/desktop-main-1920.png), [collapsed sidebar](../../design/assets/chat-spacing/desktop-main-collapsed.png), [long answer](../../design/assets/chat-spacing/desktop-main-long.png), [scrolled answer](../../design/assets/chat-spacing/desktop-main-scrolled.png), [focused composer](../../design/assets/chat-spacing/desktop-main-focus.png), [process panel](../../design/assets/chat-spacing/desktop-main-process.png), [running](../../design/assets/chat-spacing/desktop-main-running.png), [error](../../design/assets/chat-spacing/desktop-main-error.png) and [empty](../../design/assets/chat-spacing/desktop-main-empty.png) captures. Both desktop sizes reserve a 56px header and leave 32px before the first message. Sidebar collapse/expansion, composer focus/send enablement, scroll-stable header and a 440px process panel without overlap passed; no horizontal overflow, page exceptions or failed HTTP responses. Captures wait for Markdown rendering to finish. The final title fallback and breakpoint regression suite also passed (3 tests), along with TypeScript. API responses are fixed browser fixtures; live backend generation is not exercised.
