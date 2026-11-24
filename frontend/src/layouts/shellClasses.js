// The app shell: a fixed-height flex row (menu + content) whose content area scrolls by itself.
// The scroller MUST be `relative`: `sr-only` elements are `position:absolute`, and without a positioned ancestor they anchor to the
// page (initial containing block) at their position inside the scrolled content, which makes the whole document scrollable
// (a second scrollbar, and the menu moving away with the wheel). Do not remove `relative`.
export const SHELL_ROOT = 'flex h-screen h-dvh bg-gray-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100';
export const SHELL_MAIN = 'relative min-w-0 flex-1 flex flex-col overflow-hidden pt-16 md:pt-0';
export const SHELL_SCROLLER = 'relative flex-1 overflow-y-auto p-4 md:p-8';
