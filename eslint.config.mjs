import antfu from '@antfu/eslint-config'

export default antfu({
  type: 'app',
  // Skills and ADRs are prose. The hook formats code with ESLint.
  ignores: ['.agents/**', 'docs/**', '*.md'],
})
