import { describe, expect, it } from "vitest";
import { replaceHtmlPreservingScroll } from "../../src/content/render-utils";

describe("replaceHtmlPreservingScroll", () => {
  it("preserves panel and nested table scroll positions across rerenders", () => {
    const container = document.createElement("div");

    container.innerHTML = `
      <div class="panel-body">
        <div class="results-table-wrapper">old content</div>
      </div>
    `;

    const panelBody = container.querySelector<HTMLElement>(".panel-body");
    const tableWrapper = container.querySelector<HTMLElement>(".results-table-wrapper");

    expect(panelBody).not.toBeNull();
    expect(tableWrapper).not.toBeNull();

    panelBody!.scrollTop = 240;
    tableWrapper!.scrollLeft = 36;

    replaceHtmlPreservingScroll(
      container,
      `
        <div class="panel-body">
          <div class="results-table-wrapper">new content</div>
        </div>
      `
    );

    expect(container.querySelector<HTMLElement>(".panel-body")?.scrollTop).toBe(240);
    expect(container.querySelector<HTMLElement>(".results-table-wrapper")?.scrollLeft).toBe(36);
  });

  it("renders normally when there is no saved scroll position", () => {
    const container = document.createElement("div");

    replaceHtmlPreservingScroll(container, `<div class="panel-body">fresh content</div>`);

    expect(container.querySelector(".panel-body")?.textContent).toContain("fresh content");
  });
});
