/**
 * Behavioural sandbox for the hub's progressive-enhancement search (P2-C1).
 *
 * Parses the REAL generated hub markup (public/blog.html) into the minimal DOM
 * surface public/guide-search.js actually touches, then runs the REAL shipped
 * script in node:vm. The tests therefore assert the behaviour of shipped
 * artefacts instead of a re-implementation of the filter.
 *
 * Not a *.test.ts file, so the runner's glob does not execute it on its own.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

export const HUB_HTML = "public/blog.html";
export const GUIDE_SEARCH_JS = "public/guide-search.js";

export type FakeEvent = { type: string; key?: string; defaultPrevented: boolean; preventDefault: () => void };

export type FakeNode = {
  tag: string;
  attrs: Record<string, string>;
  hidden: boolean;
  textContent: string;
  value: string;
  focused: boolean;
  form: FakeNode | null;
  parent: FakeNode | null;
  children: FakeNode[];
  listeners: Map<string, ((event: FakeEvent) => void)[]>;
  append: (child: FakeNode) => FakeNode;
  addEventListener: (type: string, fn: (event: FakeEvent) => void) => void;
  fire: (type: string, extra?: { key?: string }) => FakeEvent;
  getAttribute: (name: string) => string | null;
  hasAttribute: (name: string) => boolean;
  querySelector: (selector: string) => FakeNode | null;
  querySelectorAll: (selector: string) => FakeNode[];
  closest: (selector: string) => FakeNode | null;
  focus: () => void;
  descendants: () => FakeNode[];
};

const own = (object: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(object, key);

/** The sandbox only ever asks for attribute-presence selectors, e.g. "[data-guide-card]". */
function matches(node: FakeNode, selector: string): boolean {
  const m = /^\[([A-Za-z0-9_-]+)\]$/.exec(selector.trim());
  if (!m) throw new Error(`guide-search sandbox: unsupported selector ${selector}`);
  return own(node.attrs, m[1]);
}

function fakeNode(tag: string, attrs: Record<string, string> = {}, textContent = ""): FakeNode {
  const node: FakeNode = {
    tag,
    attrs,
    hidden: own(attrs, "hidden"),
    textContent,
    value: "",
    focused: false,
    form: null,
    parent: null,
    children: [],
    listeners: new Map(),
    append: (child) => { child.parent = node; node.children.push(child); return child; },
    addEventListener: (type, fn) => {
      const list = node.listeners.get(type) ?? [];
      list.push(fn);
      node.listeners.set(type, list);
    },
    fire: (type, extra = {}) => {
      const event: FakeEvent = {
        type,
        key: extra.key,
        defaultPrevented: false,
        preventDefault: () => { event.defaultPrevented = true; },
      };
      for (const fn of node.listeners.get(type) ?? []) fn(event);
      return event;
    },
    getAttribute: (name) => (own(node.attrs, name) ? node.attrs[name] : null),
    hasAttribute: (name) => own(node.attrs, name),
    querySelector: (selector) => node.descendants().find((child) => matches(child, selector)) ?? null,
    querySelectorAll: (selector) => node.descendants().filter((child) => matches(child, selector)),
    closest: (selector) => {
      let current: FakeNode | null = node;
      while (current) {
        if (matches(current, selector)) return current;
        current = current.parent;
      }
      return null;
    },
    focus: () => { node.focused = true; },
    descendants: () => node.children.flatMap((child) => [child, ...child.descendants()]),
  };
  return node;
}

const ATTR = /([A-Za-z_:][-A-Za-z0-9_:.]*)(?:="([^"]*)")?/g;

/** Reads the attributes of an opening tag (a full element match is truncated at its first ">"). */
function attrsOf(tag: string): Record<string, string> {
  const end = tag.indexOf(">");
  const open = (end === -1 ? tag : tag.slice(0, end)).replace(/^<\s*[A-Za-z0-9-]+/, "");
  const attrs: Record<string, string> = {};
  for (const m of open.matchAll(ATTR)) attrs[m[1]] = m[2] ?? "";
  return attrs;
}

const decodeEntities = (text: string) => text
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");

/** The text a browser would expose as textContent for a markup fragment. */
const textOf = (fragment: string) => decodeEntities(fragment.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();

export type HubDom = {
  form: FakeNode;
  input: FakeNode;
  status: FakeNode;
  empty: FakeNode;
  clear: FakeNode;
  cards: FakeNode[];
  sections: FakeNode[];
};

/** Parses the shipped hub markup into the fake DOM the sandbox needs. */
export function parseHub(html: string = readFileSync(HUB_HTML, "utf8")): HubDom {
  const formTag = /<form[^>]*\bclass="g-search"[^>]*>/.exec(html);
  if (!formTag) throw new Error("hub has no g-search form");
  const form = fakeNode("form", attrsOf(formTag[0]));
  const formBody = html.slice(formTag.index + formTag[0].length, html.indexOf("</form>", formTag.index + formTag[0].length));
  const part = (pattern: RegExp, label: string): RegExpExecArray => {
    const found = pattern.exec(formBody);
    if (!found) throw new Error(`hub search form is missing ${label}`);
    return found;
  };
  const labelTag = part(/<label[^>]*>([\s\S]*?)<\/label>/, "<label>");
  const inputTag = part(/<input[^>]*>/, "<input>");
  const statusTag = part(/<p[^>]*\bdata-guide-search-status\b[^>]*>([\s\S]*?)<\/p>/, "[data-guide-search-status]");
  const emptyTag = part(/<p[^>]*\bdata-guide-search-empty\b[^>]*>([\s\S]*?)<\/p>/, "[data-guide-search-empty]");
  const clearTag = part(/<button[^>]*\bdata-guide-search-clear\b[^>]*>([\s\S]*?)<\/button>/, "[data-guide-search-clear]");
  form.append(fakeNode("label", attrsOf(labelTag[0]), textOf(labelTag[1])));
  const input = form.append(fakeNode("input", attrsOf(inputTag[0])));
  const status = form.append(fakeNode("p", attrsOf(statusTag[0]), textOf(statusTag[1])));
  const empty = form.append(fakeNode("p", attrsOf(emptyTag[0]), textOf(emptyTag[1])));
  /* The reset control is a child of the no-results notice, exactly as in the markup. */
  const clear = empty.append(fakeNode("button", attrsOf(clearTag[0]), textOf(clearTag[1])));
  /* A form control exposes its owning form exactly like the browser does. */
  input.form = form;
  /* A control's initial value comes from its value attribute, never from markup text. */
  input.value = input.getAttribute("value") ?? "";

  const sections: FakeNode[] = [];
  const cards: FakeNode[] = [];
  for (const open of html.matchAll(/<section[^>]*\bdata-guide-section\b[^>]*>/g)) {
    const start = open.index ?? 0;
    const sectionBody = html.slice(start + open[0].length, html.indexOf("</section>", start + open[0].length));
    const section = fakeNode("section", attrsOf(open[0]));
    sections.push(section);
    for (const cardOpen of sectionBody.matchAll(/<article[^>]*\bdata-guide-card\b[^>]*>/g)) {
      const cardStart = cardOpen.index ?? 0;
      const cardBody = sectionBody.slice(cardStart + cardOpen[0].length, sectionBody.indexOf("</article>", cardStart + cardOpen[0].length));
      const card = fakeNode("article", attrsOf(cardOpen[0]));
      const title = /<(h[1-6])[^>]*\bdata-guide-title\b[^>]*>([\s\S]*?)<\/\1>/.exec(cardBody);
      const description = /<p[^>]*\bdata-guide-description\b[^>]*>([\s\S]*?)<\/p>/.exec(cardBody);
      if (!title || !description) throw new Error(`card ${card.attrs["data-guide-slug"]} lost its title/description marker`);
      card.append(fakeNode(title[1], attrsOf(title[0]), textOf(title[2])));
      card.append(fakeNode("p", attrsOf(description[0]), textOf(description[1])));
      section.append(card);
      cards.push(card);
    }
  }
  return { form, input, status, empty, clear, cards, sections };
}

export type GuideSearchPage = HubDom & {
  /** Sets the field and fires the real `input` event, exactly as typing would. */
  type: (value: string) => void;
  /** Slugs that still have at least one visible card, in document order, deduplicated. */
  visibleSlugs: () => string[];
  hiddenSlugs: () => string[];
  hiddenSections: () => FakeNode[];
};

/** Runs the shipped script against the shipped markup and returns the live fake DOM. */
export function loadGuideSearch(html: string = readFileSync(HUB_HTML, "utf8"), source: string = readFileSync(GUIDE_SEARCH_JS, "utf8")): GuideSearchPage {
  const hub = parseHub(html);
  const all = [hub.form, ...hub.form.descendants(), ...hub.sections.flatMap((section) => [section, ...section.descendants()])];
  const document = {
    querySelector: (selector: string) => all.find((node) => matches(node, selector)) ?? null,
    querySelectorAll: (selector: string) => all.filter((node) => matches(node, selector)),
  };
  vm.runInContext(source, vm.createContext({ document }), { filename: GUIDE_SEARCH_JS });
  const slugsOf = (cards: FakeNode[]) => [...new Set(cards.map((card) => card.attrs["data-guide-slug"]))];
  return {
    ...hub,
    type: (value: string) => { hub.input.value = value; hub.input.fire("input"); },
    visibleSlugs: () => slugsOf(hub.cards.filter((card) => !card.hidden)),
    hiddenSlugs: () => slugsOf(hub.cards.filter((card) => card.hidden)),
    hiddenSections: () => hub.sections.filter((section) => section.hidden),
  };
}
