const DEFAULT_SCROLL_SELECTORS = [".panel-body", ".results-table-wrapper"] as const;

interface ScrollSnapshot {
  selector: string;
  index: number;
  top: number;
  left: number;
}

function captureScrollSnapshots(
  container: HTMLElement,
  selectors: readonly string[]
): ScrollSnapshot[] {
  const snapshots: ScrollSnapshot[] = [];

  for (const selector of selectors) {
    const elements = Array.from(container.querySelectorAll<HTMLElement>(selector));

    elements.forEach((element, index) => {
      if (element.scrollTop === 0 && element.scrollLeft === 0) {
        return;
      }

      snapshots.push({
        selector,
        index,
        top: element.scrollTop,
        left: element.scrollLeft,
      });
    });
  }

  return snapshots;
}

function restoreScrollSnapshots(
  container: HTMLElement,
  snapshots: readonly ScrollSnapshot[]
) {
  for (const snapshot of snapshots) {
    const element = container
      .querySelectorAll<HTMLElement>(snapshot.selector)
      .item(snapshot.index);

    if (!element) {
      continue;
    }

    element.scrollTop = snapshot.top;
    element.scrollLeft = snapshot.left;
  }
}

export function replaceHtmlPreservingScroll(
  container: HTMLElement,
  html: string,
  selectors: readonly string[] = DEFAULT_SCROLL_SELECTORS
) {
  const snapshots = captureScrollSnapshots(container, selectors);

  container.innerHTML = html;

  restoreScrollSnapshots(container, snapshots);
}
