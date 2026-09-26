import { memo } from 'react'
import ContactContent from '../content/Contact.mdx'
import HomeContent from '../content/Home.mdx'
import HomeLinksContent from '../content/HomeLinks.mdx'
import { sharedMdxComponents } from './mdx/MdxContent'

const documents = {
  contact: ContactContent,
  home: HomeContent,
  homeLinks: HomeLinksContent,
}

export type ContentSectionName = keyof typeof documents

export const ContentSection = memo(function ContentSection({ name }: { name: ContentSectionName }) {
  const Document = documents[name]
  return <Document components={sharedMdxComponents} />
})
