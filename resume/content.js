import { createProcessor } from '@mdx-js/mdx'

// Parse MDX as data; never evaluate its JavaScript or turn prose into Typst code.
function attributes(node) {
  const result = {}
  for (const attribute of node.attributes ?? []) {
    if (
      attribute.type !== 'mdxJsxAttribute' ||
      (attribute.value !== null && typeof attribute.value !== 'string')
    ) {
      throw new Error(`${node.name}: résumé attributes must be literal strings`)
    }
    result[attribute.name] = attribute.value ?? true
  }
  return result
}

function inline(node) {
  if (node.type === 'text' || node.type === 'inlineCode') {
    // Markdown soft line breaks are spaces, including formatter-wrapped prose.
    return { kind: 'text', value: node.value.replace(/\r?\n/g, ' ') }
  }
  if (['strong', 'emphasis', 'link'].includes(node.type)) {
    return {
      kind: node.type,
      ...(node.type === 'link' ? { url: node.url } : {}),
      children: node.children.map(inline),
    }
  }
  throw new Error(`Unsupported résumé inline content: ${node.type}`)
}

function block(node) {
  if (node.type === 'paragraph') {
    return { kind: 'paragraph', children: node.children.map(inline) }
  }
  if (node.type === 'list' && !node.ordered) {
    return { kind: 'list', items: node.children.map((item) => item.children.map(block)) }
  }
  throw new Error(`Unsupported résumé block: ${node.type}`)
}

function headingText(node) {
  if (node.type !== 'heading' || node.children.some((child) => child.type !== 'text')) {
    throw new Error('Résumé section headings must be plain text')
  }
  return node.children.map((child) => child.value).join('')
}

export function parseResume(source) {
  const tree = createProcessor().parse(source)
  const sections = []
  function visit(node, pdfOnly = false) {
    if (node.name === 'ResumePdfOnly') {
      for (const child of node.children) visit(child, true)
      return
    }
    if (pdfOnly && node.type === 'heading') {
      sections.push({ kind: 'summary', title: headingText(node), body: [] })
      return
    }
    if (pdfOnly && node.type === 'list') {
      const summary = sections.at(-1)
      if (summary?.kind !== 'summary') throw new Error('PDF-only lists need a heading')
      summary.body.push(block(node))
      return
    }
    if (node.name === 'ResumeProjects') {
      if (!pdfOnly) throw new Error('ResumeProjects must be inside ResumePdfOnly')
      const { title } = attributes(node)
      const entries = node.children.map((child) => {
        if (child.name !== 'ResumeProject') throw new Error('Expected ResumeProject')
        return { ...attributes(child), body: child.children.map(block) }
      })
      sections.push({ kind: 'projects', title, entries })
      return
    }
    if (node.name === 'MdxSection') {
      const { id } = attributes(node)
      const [heading, ...children] = node.children
      const title = headingText(heading)
      if (!['education', 'experience', 'skills'].includes(id)) {
        throw new Error(`Unsupported résumé section: ${id}`)
      }
      const entries = children.map((child) => {
        if (id === 'skills') {
          if (child.name !== 'ResumeSkillCard') throw new Error('Expected ResumeSkillCard')
          return {
            title: attributes(child).title,
            skills: child.children.map((skill) => {
              if (skill.name !== 'ResumeSkill') throw new Error('Expected ResumeSkill')
              const { label, pdfDetail } = attributes(skill)
              return pdfDetail ? `${label} (${pdfDetail})` : label
            }),
          }
        }
        if (child.name !== 'ResumeEntry') throw new Error('Expected ResumeEntry')
        const fields = attributes(child)
        for (const required of ['title', 'date', 'fact']) {
          if (!fields[required]) throw new Error(`ResumeEntry requires ${required}`)
        }
        return { ...fields, body: child.children.map(block) }
      })
      sections.push({ kind: id, title, entries })
      return
    }
    if (node.type === 'root' || node.name === 'ResumeCopy') {
      for (const child of node.children) visit(child, pdfOnly)
      return
    }
    // These are website navigation / PDF-download UI, not résumé content.
    if (node.name === 'TransitionHeading' || node.name === 'Stack') return
    throw new Error(`Unsupported résumé node: ${node.name ?? node.type}`)
  }
  visit(tree)
  return { sections }
}

export function plainInline(nodes) {
  return nodes
    .map((node) => (node.kind === 'text' ? node.value : plainInline(node.children)))
    .join('')
}

export function expectedContent(data) {
  const text = []
  const dates = []
  const urls = []
  function walkInline(nodes) {
    for (const node of nodes) {
      if (node.kind === 'link') urls.push(node.url)
      if (node.children) walkInline(node.children)
    }
  }
  function walkBody(body) {
    for (const item of body) {
      if (item.kind === 'paragraph') {
        text.push(plainInline(item.children))
        walkInline(item.children)
      } else item.items.forEach(walkBody)
    }
  }
  for (const section of data.sections) {
    text.push(section.title)
    if (section.body) walkBody(section.body)
    for (const entry of section.entries ?? []) {
      for (const field of ['title', 'date', 'fact', 'gpa', 'languages']) {
        // Experience language chips are intentionally website-only.
        if (field === 'languages' && section.kind === 'experience') continue
        if (entry[field]) text.push(entry[field])
      }
      if (entry.date) dates.push(entry.date)
      if (entry.body) walkBody(entry.body)
      if (entry.skills) text.push(...entry.skills)
    }
  }
  return { text, dates, urls }
}
