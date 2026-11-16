// Also embedded before hydration: keep this self-contained, valid JavaScript.
export function fitPublicationAuthors() {
  document.querySelectorAll('.publication-entry-authors').forEach((row) => {
    if (!(row instanceof HTMLElement)) return
    const available = row.getBoundingClientRect().width
    let selected = 0
    row.querySelectorAll('[data-author-option]').forEach((option, index) => {
      if (option.getBoundingClientRect().width <= available) selected = index
    })
    // Body state is included in gt-rrweb's replay document as well.
    document.body.style.setProperty(
      `--publication-authors-${row.dataset.authorKey}`,
      String(selected),
    )
  })
}
