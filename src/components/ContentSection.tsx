import { memo } from 'react'
import AboutContent from '../content/About.mdx'
import ContactContent from '../content/Contact.mdx'
import HomeContent from '../content/Home.mdx'
import ProjectsContent from '../content/Projects.mdx'
import ResearchContent from '../content/Research.mdx'
import { sharedMdxComponents } from './mdx/MdxContent'

const documents = {
  about: AboutContent,
  contact: ContactContent,
  home: HomeContent,
  projects: ProjectsContent,
  research: ResearchContent,
}

export type ContentSectionName = keyof typeof documents

export const ContentSection = memo(function ContentSection({ name }: { name: ContentSectionName }) {
  const Document = documents[name]
  return <Document components={sharedMdxComponents} />
})
