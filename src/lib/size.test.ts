import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { appendImageSizeParamsToPrompt, calculateImageSize, getImageSizePreset } from './size'

describe('calculateImageSize', () => {
  it('uses common 16:9 display resolutions for the built-in tiers', () => {
    expect(calculateImageSize('1K', '16:9')).toBe('1280x720')
    expect(calculateImageSize('2K', '16:9')).toBe('2560x1440')
    expect(calculateImageSize('4K', '16:9')).toBe('3840x2160')
  })

  it('uses matching portrait presets for common ratios', () => {
    expect(calculateImageSize('2K', '9:16')).toBe('1440x2560')
    expect(calculateImageSize('2K', '2:3')).toBe('1440x2160')
    expect(calculateImageSize('2K', '3:4')).toBe('1536x2048')
  })

  it('falls back to budget-based sizing for custom ratios', () => {
    expect(calculateImageSize('2K', '5:4')).toBe('2288x1824')
  })

  it('defaults to a 1K square and keeps the prompt suffix singular', () => {
    expect(DEFAULT_PARAMS.size).toBe('1024x1024')
    expect(getImageSizePreset(DEFAULT_PARAMS.size)).toEqual({ tier: '1K', ratio: '1:1' })
    expect(appendImageSizeParamsToPrompt(
      'product photo\n\n图片参数：比例16:9  1K',
      DEFAULT_PARAMS.size,
    )).toBe('product photo\n\n图片参数：比例1:1  1K')
  })
})
