import { createContext } from 'react'
import type { ProjectStarCounts } from '../lib/projectRepositories'

export const ProjectStarsContext = createContext<ProjectStarCounts>({})
