import { useState } from 'react'
import { calculateImageSize, type SizeTier } from '../lib/size'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'

const TIERS: SizeTier[] = ['1K', '2K', '4K']
const RATIOS = [
  { label: '1:1', value: '1:1' },
  { label: '3:2', value: '3:2' },
  { label: '2:3', value: '2:3' },
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' },
  { label: '21:9', value: '21:9' },
]

function findPreset(size: string) {
  for (const tier of TIERS) {
    for (const ratio of RATIOS) {
      if (calculateImageSize(tier, ratio.value) === size) return { tier, ratio: ratio.value }
    }
  }
  return { tier: '1K' as SizeTier, ratio: '1:1' }
}

interface Props {
  currentSize: string
  onSelect: (size: string) => void
  onClose: () => void
  allowAuto?: boolean
}

export default function SizePickerModal({ currentSize, onSelect, onClose }: Props) {
  usePreventBackgroundScroll(true)

  const current = findPreset(currentSize)
  const [tier, setTier] = useState<SizeTier>(current.tier)
  const [ratio, setRatio] = useState(current.ratio)

  const applySize = () => {
    const size = calculateImageSize(tier, ratio)
    if (!size) return
    onSelect(size)
    onClose()
  }

  const buttonClass = (active: boolean) => `rounded-xl border px-3 py-2.5 text-sm transition ${active
    ? 'border-blue-400 bg-blue-50 text-blue-600 dark:border-blue-500/50 dark:bg-blue-500/10 dark:text-blue-300'
    : 'border-gray-200/70 bg-white/60 text-gray-600 hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-300 dark:hover:bg-white/[0.06]'
  }`

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-md rounded-3xl border border-white/50 bg-white/95 p-5 shadow-2xl ring-1 ring-black/5 dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">尺寸与比例</h3>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">选择生成图像的清晰度和画面比例</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
            aria-label="关闭"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-5">
          <section>
            <div className="mb-2 text-xs font-medium text-gray-400 dark:text-gray-500">分辨率</div>
            <div className="grid grid-cols-3 gap-2">
              {TIERS.map((item) => (
                <button key={item} type="button" className={buttonClass(tier === item)} onClick={() => setTier(item)}>
                  {item}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 text-xs font-medium text-gray-400 dark:text-gray-500">图像比例</div>
            <div className="grid grid-cols-4 gap-2">
              {RATIOS.map((item) => (
                <button key={item.value} type="button" className={buttonClass(ratio === item.value)} onClick={() => setRatio(item.value)}>
                  {item.label}
                </button>
              ))}
            </div>
          </section>

          <button type="button" onClick={applySize} className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700">
            应用设置
          </button>
        </div>
      </div>
    </div>
  )
}
