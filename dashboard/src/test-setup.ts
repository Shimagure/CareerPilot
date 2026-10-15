import '@testing-library/jest-dom/vitest'
import * as React from 'react'
import { act } from 'react'

if (act && !(React as any).act) {
  ;(React as any).act = act
}
