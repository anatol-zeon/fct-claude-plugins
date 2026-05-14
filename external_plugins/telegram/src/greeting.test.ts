import { describe, expect, test } from 'bun:test'
import { bootGreeting } from './greeting'

describe('bootGreeting', () => {
  test('full info renders all three fields', () => {
    expect(bootGreeting({
      botUsername: 'mybot',
      branch: 'main',
      sha: '9140d1a',
      pid: 1940691,
    })).toBe('🟢 Bridge online — @mybot\nmain@9140d1a · pid 1940691')
  })

  test('omits the build line when git info is unknown', () => {
    expect(bootGreeting({
      botUsername: 'mybot',
      branch: '',
      sha: '',
      pid: 1940691,
    })).toBe('🟢 Bridge online — @mybot\npid 1940691')
  })

  test('partial git info still shows what we have', () => {
    expect(bootGreeting({
      botUsername: 'mybot',
      branch: '',
      sha: '9140d1a',
      pid: 99,
    })).toBe('🟢 Bridge online — @mybot\n9140d1a · pid 99')
    expect(bootGreeting({
      botUsername: 'mybot',
      branch: 'main',
      sha: '',
      pid: 99,
    })).toBe('🟢 Bridge online — @mybot\nmain · pid 99')
  })
})
