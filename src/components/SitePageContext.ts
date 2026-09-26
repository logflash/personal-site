import { createContext } from 'react'

// Follow the mounted page, not the router's pending URL: morph destinations
// must not appear in an outgoing shell that is about to be removed.
export const SitePageContext = createContext('home')
