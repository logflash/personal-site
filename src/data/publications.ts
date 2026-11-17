// Bibliographic metadata verified against https://arxiv.org/abs/2512.03471.
// Keep citations in the publication's language, independent of site locale.
// Authors are supplied by Publications.mdx in given-name / family-name order.
function citationAuthors(authors: readonly string[]): string {
  const names = authors.map((author) => {
    const parts = author.trim().split(/\s+/)
    const family = parts.pop()
    return `${family}, ${parts.map((part) => `${part[0]}.`).join(' ')}`
  })
  return names.length > 1 ? `${names.slice(0, -1).join(', ')}, & ${names.at(-1)}` : (names[0] ?? '')
}

export const publications = {
  sweetdeep: {
    citation: (authors: readonly string[]) =>
      `${citationAuthors(authors)} (2025). SweetDeep: A Wearable AI Solution for Real-Time Non-Invasive Diabetes Screening. arXiv. https://doi.org/10.48550/arXiv.2512.03471`,
    bibtex: (authors: readonly string[]) => `@misc{henriques2025sweetdeep,
  title = {{SweetDeep}: A Wearable {AI} Solution for Real-Time Non-Invasive Diabetes Screening},
  author = {${authors.join(' and ')}},
  year = {2025},
  eprint = {2512.03471},
  archivePrefix = {arXiv},
  primaryClass = {cs.LG},
  doi = {10.48550/arXiv.2512.03471},
  url = {https://arxiv.org/abs/2512.03471}
}`,
  },
} as const
