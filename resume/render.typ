#import "template.typ": *

// Apply print punctuation to prose and entry fields alike; MDX keeps the
// website's punctuation. Date ranges also use spaced en dashes; compound
// hyphens stay intact.
#let print-copy(value) = value.replace(regex(" *[—–] *"), " – ").replace("'", "’")
#let print-text(value) = text(print-copy(value))

// JSON text is data, never eval'ed Typst source. Markdown formatting remains
// semantic text, emphasis, strong, links and nested lists in the output.
#let inline(nodes, reference: false) = nodes.map(node => {
  if node.kind == "text" { print-text(node.value) }
  else if node.kind == "strong" { strong(inline(node.children, reference: reference)) }
  else if node.kind == "emphasis" { emph(inline(node.children, reference: reference)) }
  else if node.kind == "link" {
    let body = inline(node.children, reference: reference)
    if reference { link(node.url, body) } else { ulink(node.url, body) }
  }
}).join()

#let checked-inline(nodes, reference: false) = checked-paragraph(inline(nodes, reference: reference))

#let blocks(nodes, nested: false) = {
  for (index, node) in nodes.enumerate() {
    if node.kind == "paragraph" {
      checked-inline(node.children, reference: nested)
    } else if node.kind == "list" {
      if index > 0 and nodes.at(index - 1).kind == "paragraph" { v(4.548pt) }
      let items = node.items.map(item => blocks(item, nested: true))
      if nested { references(..items) } else { bullets(..items) }
    }
  }
}

#let entry-body(body) = {
  for node in body {
    if node.kind == "paragraph" {
      // Standalone italic labels such as Research keep their original style.
      block(sticky: true, inline(node.children))
      v(4.908pt)
    } else { blocks((node,)) }
  }
}

#let render-resume(data) = {
  for section in data.sections {
    if section.kind == "projects" {
      projects(section.entries.map(entry => (
        blocks(entry.body), print-text(entry.languages), print-text(entry.date)
      )), title: print-copy(section.title))
    } else {
      heading(level: 1, upper(print-copy(section.title)))
      if section.kind == "summary" { entry-body(section.body) }
      for entry in section.at("entries", default: ()) {
        if section.kind == "education" {
          let logo = entry.logo.split("/").last().split(".").first()
          if logo == "seminole-high" { logo = "seminole" }
          // Short honors-only school entries read better inline in the PDF.
          // Every word still comes from the same MDX bullets used by the site.
          let compact = entry.body.len() == 1 and entry.body.first().kind == "list"
          if compact {
            compact = entry.body.first().items.all(item =>
              item.len() == 1 and item.first().kind == "paragraph" and
              item.first().children.len() == 1 and item.first().children.first().kind == "strong")
          }
          let fact = if compact { print-text(entry.fact) } else {
            checked-inline(((kind: "text", value: entry.fact),))
          }
          if compact {
            let honors = entry.body.first().items.map(item => inline(item.first().children))
            fact = [#fact – #honors.join([, ])]
          }
          school(print-text(entry.title), print-text(entry.date), fact,
            print-text(entry.at("gpa", default: "")), logo: logo)
          if not compact { entry-body(entry.body) }
        } else if section.kind == "experience" {
          role(checked-inline(((kind: "text", value: entry.title + " – " + entry.fact),)),
            print-text(entry.date))
          entry-body(entry.body)
        } else if section.kind == "skills" {
          let labels = entry.skills.map(item => item.label +
            if "pdfDetail" in item { " (" + item.pdfDetail + ")" } else { "" })
          skill(checked-inline((
            (kind: "strong", children: ((kind: "text", value: entry.title + ":"),)),
            (kind: "text", value: " " + labels.join(", ")),
          )))
        }
      }
    }
  }
}
