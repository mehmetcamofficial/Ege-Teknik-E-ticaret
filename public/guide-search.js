/* Klima Rehberi hub local search (P2-C1): progressive enhancement only.
 *
 * Filters the guide cards that are already rendered in the document - no fetch,
 * no API, no database, no second dataset, no DOM rebuild. Without JavaScript
 * (or before this script runs) every guide stays visible and the field is inert.
 *
 * A guide appears twice on the hub (once in the featured row, once in its
 * category), so visibility is toggled per card while the announced count is
 * unique guides keyed by data-guide-slug: duplicates never inflate it.
 */
(() => {
  'use strict';
  /* Turkish-aware, search-friendly folding. toLocaleLowerCase('tr') gets the
   * dotted İ right; mapping the dotless ı onto i afterwards keeps an ASCII
   * "inverter" / "BAKIM" / "ISITMA" in step with Turkish text that uses ı. */
  const fold = (value) => String(value ?? '').toLocaleLowerCase('tr').replace(/\u0307/g, '').replace(/\u0131/g, 'i');
  const input = document.querySelector('[data-guide-search]');
  if (!input) return;
  const status = document.querySelector('[data-guide-search-status]');
  const empty = document.querySelector('[data-guide-search-empty]');
  const clear = document.querySelector('[data-guide-search-clear]');
  const groups = new Map();
  for (const card of document.querySelectorAll('[data-guide-card]')) {
    const slug = card.getAttribute('data-guide-slug') || '';
    if (!groups.has(slug)) groups.set(slug, []);
    groups.get(slug).push(card);
  }
  const total = groups.size;
  const textOf = (card) => {
    const title = card.querySelector('[data-guide-title]');
    const description = card.querySelector('[data-guide-description]');
    return `${title ? title.textContent : ''} ${description ? description.textContent : ''}`;
  };
  const haystacks = new Map([...groups].map(([slug, cards]) => [slug, fold(cards.map(textOf).join(' '))]));
  const sections = [...document.querySelectorAll('[data-guide-section]')];
  const apply = (raw) => {
    const q = fold(raw).trim();
    let shown = 0;
    for (const [slug, cards] of groups) {
      const match = q === '' || haystacks.get(slug).includes(q);
      if (match) shown += 1;
      for (const card of cards) card.hidden = !match;
    }
    /* A category whose every guide is filtered out would otherwise be left as a
     * heading over an empty grid; hide the whole group instead. */
    for (const section of sections) {
      section.hidden = [...section.querySelectorAll('[data-guide-card]')].every((card) => card.hidden);
    }
    if (status) status.textContent = `${total} rehberden ${shown} gösteriliyor`;
    if (empty) empty.hidden = shown !== 0;
  };
  const reset = () => {
    input.value = '';
    apply('');
  };
  /* The form must never navigate: the filter runs on the current document. */
  const form = input.form || input.closest('form');
  if (form) form.addEventListener('submit', (event) => event.preventDefault());
  input.addEventListener('input', () => apply(input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && input.value) {
      event.preventDefault();
      reset();
    }
    if (event.key === 'Enter') event.preventDefault();
  });
  if (clear) clear.addEventListener('click', () => {
    reset();
    input.focus();
  });
  apply(input.value || '');
})();

