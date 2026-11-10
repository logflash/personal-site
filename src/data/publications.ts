// Bibliographic metadata verified against https://arxiv.org/abs/2512.03471.
// Keep citations in the publication's language, independent of site locale.
const sweetdeepAuthors = [
  'Ian Henriques',
  'Lynda Elhassar',
  'Sarvesh Relekar',
  'Denis Walrave',
  'Shayan Hassantabar',
  'Vishu Ghanakota',
  'Adel Laoui',
  'Mahmoud Aich',
  'Rafia Tir',
  'Mohamed Zerguine',
  'Samir Louafi',
  'Moncef Kimouche',
  'Emmanuel Cosson',
  'Niraj K Jha',
] as const

export const publications = {
  sweetdeep: {
    authors: sweetdeepAuthors,
    authorPreview: [...sweetdeepAuthors.slice(0, 3), '…', ...sweetdeepAuthors.slice(-1)],
    citation:
      'Henriques, I., Elhassar, L., Relekar, S., Walrave, D., Hassantabar, S., Ghanakota, V., Laoui, A., Aich, M., Tir, R., Zerguine, M., Louafi, S., Kimouche, M., Cosson, E., & Jha, N. K. (2025). SweetDeep: A Wearable AI Solution for Real-Time Non-Invasive Diabetes Screening. arXiv. https://doi.org/10.48550/arXiv.2512.03471',
    bibtex: `@misc{henriques2025sweetdeep,
  title = {{SweetDeep}: A Wearable {AI} Solution for Real-Time Non-Invasive Diabetes Screening},
  author = {${sweetdeepAuthors.join(' and ')}},
  year = {2025},
  eprint = {2512.03471},
  archivePrefix = {arXiv},
  primaryClass = {cs.LG},
  doi = {10.48550/arXiv.2512.03471},
  url = {https://arxiv.org/abs/2512.03471}
}`,
  },
} as const
