/**
 * Loads TypeScript for the operator script. Node strips types from an
 * entry file, but not from extensionless imports inside it.
 */
import { register } from 'node:module'

register('./ts-loader.mjs', import.meta.url)
