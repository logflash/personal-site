// Typography measured from IanResume_v14.3.pdf. Content is authored in MDX;
// recurring layout lives here. No registry packages or absolute placement.
#let resume(body, locale: "en", title: "Resume") = {
  set document(title: "Ian Henriques – " + title, author: "Ian Henriques")
  set page("us-letter", margin: (left: 32.4pt, right: 32.4pt, top: 38.27pt, bottom: 36pt))
  set text(font: ("Avenir Next LT Pro", "Noto Sans JP"), weight: 300, size: 9pt,
    lang: locale, fallback: false, hyphenate: false, kerning: false, ligatures: false,
    top-edge: "cap-height", bottom-edge: "baseline")
  set par(leading: if locale == "ja" { 4pt } else { 4.548pt }, spacing: 0pt, justify: false, linebreaks: "simple")
  set block(spacing: 0pt)
  set list(indent: 4.56pt, body-indent: 8.94pt, spacing: if locale == "ja" { 4pt } else { 4.908pt },
    marker: ([•], [○]))
  // Word synthesized bold by stroking the Light face (0.257pt at 9pt).
  // Preserve those metrics instead of substituting the wider Regular face.
  show strong: it => text(weight: 300, stroke: 0.02857em, it.body)
  show heading: set text(size: 9.96pt, weight: 300, stroke: 0.02857em)
  show heading: it => block(above: 7.65pt, below: 8.75pt, sticky: true,
    underline(stroke: 0.48pt, offset: 0.72pt, it.body))
  body
}

// Small original raster marks, extracted losslessly from the supplied PDF.
#let icon(name, width: 7.4pt) = box(baseline: 0pt,
  pdf.artifact(image("assets/" + name + ".png", width: width)))

#let contact(icon-name, body) = [#icon(icon-name) #body]
#let separator = [#h(4pt)|#h(4pt)]
#let ulink(destination, body) = link(destination,
  underline(stroke: 0.48pt, offset: 0.72pt, body))

#let identity(name, contacts) = {
  v(1.9pt, weak: false)
  align(center, text(size: 15.96pt, weight: 300, stroke: 0.02857em, name))
  v(7.4pt)
  block(width: 100%, outset: (x: 1.44pt), stroke: (top: 1.44pt, bottom: 1.44pt),
    inset: (top: 6pt, bottom: 6pt), {
      set par(leading: 5.6pt)
      align(center, contacts)
    })
  v(7.19pt)
}

// Two columns are layout, not tabular data. Dates remain real text in the
// reading order and wrap independently instead of relying on space padding.
#let dated(primary, secondary) = grid(columns: (1fr, auto), column-gutter: 6pt,
  align: (left, right), primary, secondary)

#let school(name, date, degree, gpa, logo: none) = {
  block(above: 3pt, sticky: true, {
    dated([
      #if logo == "princeton" {
        link("https://www.princeton.edu/", icon(logo)); h(2pt)
      } else if logo != none { icon(logo); h(2pt) }
      #underline(strong(name))
    ], emph(strong(date)))
    v(4.548pt)
    dated(strong(degree), strong(gpa))
  })
  v(4.548pt)
}

#let role(body, date) = {
  block(above: 4.9pt, sticky: true,
    dated(strong(body), emph(strong(date))))
  v(4.908pt)
}

#let label(body) = {
  block(sticky: true, emph(body))
  v(4.908pt)
}

// Record the actual paragraph area for the Node PDF checker, including the
// narrower widths of nested bullets and project columns.
#let checked-paragraph(body) = layout(size => context {
  // Tiny print-only tracking adjustment for paragraphs that miss a single
  // line by at most 1%. Keep the font size, wording and margins unchanged.
  let natural-width = measure(body).width
  let fitted = if text.lang == "en" and natural-width > size.width and natural-width <= size.width * 1.01 {
    text(tracking: -0.005em, body)
  } else { body }
  let paragraph = par(fitted)
  let bounds = measure(paragraph, width: size.width)
  let position = here().position()
  [#metadata((page: position.page, x: position.x.pt(), y: position.y.pt(),
    width: size.width.pt(), height: bounds.height.pt())) <resume-paragraph>]
  paragraph
})

#let bullets(..items) = {
  list(..items.pos())
  v(4.548pt)
}

#let references(..items) = {
  set list(indent: 4.56pt, body-indent: 8.04pt, spacing: 4.548pt,
    marker: text(font: "Courier New", weight: 400)[o])
  list(..items.pos())
}

#let projects(rows, title: "Open-Source Software Projects") = context {
  block(above: 4.9pt, sticky: true, strong(title))
  v(4.908pt)
  // Keep multilingual dates on one line and allocate each project's full
  // wrapped height before starting the next row.
  let date-width = calc.max(92pt, ..rows.map(row => measure(emph(strong(row.at(2)))).width))
  grid(columns: (1fr, 90pt, date-width), column-gutter: 2pt,
    row-gutter: 4.908pt, align: (left + top, left + top, right + top),
    ..rows.map(row => (list(row.at(0)), emph(row.at(1)), emph(strong(row.at(2))))).flatten())
  v(4.908pt)
}

#let skill(body) = block(above: 9.3pt, body)
