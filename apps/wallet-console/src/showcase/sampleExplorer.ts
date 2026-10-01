/* The demos' transaction hashes are made up, so the receipt's explorer link
   opens the explorer's home page instead of a transaction that does not exist. */
export function sendExplorerLinksHome(root: HTMLElement, home: string): void {
  const point = (): void => {
    for (const link of root.querySelectorAll<HTMLAnchorElement>('a.seams-receipt-explorer')) {
      if (link.href !== home) link.href = home;
    }
  };
  new MutationObserver(point).observe(root, { childList: true, subtree: true });
}
