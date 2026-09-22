import type { ApiProfile } from '../types'

// 对外提供的图片模型选项，供设置页和 OpenAI 兼容请求统一使用。
export const GPT_IMAGE_MODEL_OPTIONS = [
  { label: 'gpt-image-2', value: 'gpt-image-2' },
  { label: 'gpt-image-2.5-sunburst', value: 'gpt-image-2.5-sunburst' },
  { label: 'gpt-image-2.5-flare', value: 'gpt-image-2.5-flare' },
] as const

export const DEFAULT_IMAGES_MODEL = 'gpt-image-2.5-sunburst'

export function getImageGenerationModel(profile: ApiProfile) {
  return profile.provider === 'openai' && profile.apiMode === 'responses'
    ? profile.imageGenerationModel?.trim() ?? ''
    : profile.model
}

export function isGptImage25Model(model: string) {
  return model.trim().toLowerCase().includes('gpt-image-2.5')
}
