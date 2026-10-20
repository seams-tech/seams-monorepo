/* An embedded demo plays on a page the visitor is reading. In a frame that
   does not hold focus, element.focus(), dialog.show() and dialog.showModal()
   all take focus from the page, and the SDK's modals call them when they
   mount. So until the visitor moves focus into the demo (a click or Tab),
   script focus here does nothing and a dialog opens without moving focus.
   A demo opened on its own, as the top page, is left alone. Import this module
   first, so it is in place before any demo code runs. */

// The frame that the host page embeds; a nested demo frame looks through it,
// because focus anywhere in the demo counts as focus in the demo.
function demoRoot(): Window {
  let root: Window = window;
  while (root.parent !== window.top) root = root.parent;
  return root;
}

function demoHasFocus(): boolean {
  return demoRoot().document.hasFocus();
}

function guardDemoFocus(): void {
  const focus = HTMLElement.prototype.focus;
  const show = HTMLDialogElement.prototype.show;
  const showModal = HTMLDialogElement.prototype.showModal;
  HTMLElement.prototype.focus = function focusInsideDemo(options?: FocusOptions): void {
    if (demoHasFocus()) focus.call(this, options);
  };
  HTMLDialogElement.prototype.show = function showInsideDemo(): void {
    if (demoHasFocus()) show.call(this);
    else this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.showModal = function showModalInsideDemo(): void {
    if (demoHasFocus()) showModal.call(this);
    else this.setAttribute('open', '');
  };
}

if (window !== window.top) guardDemoFocus();
