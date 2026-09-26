import { useMemo, useRef, useState } from 'react'
import type { ItineraryImportPlace, ItineraryImportPreviewResponse } from '@trek/shared'
import { useTranslation } from '../../i18n'
import { useToast } from '../shared/Toast'
import { itineraryImportApi } from '../../api/itineraryImport'
import { useTripStore } from '../../store/tripStore'
import { useAddonStore } from '../../store/addonStore'

export type ItineraryImportStep = 'input' | 'analyzing' | 'preview' | 'importing'

export interface PreviewDay {
  day_id: number
  day_number: number
  date: string | null
  title: string | null
}

/**
 * State for the AI itinerary import dialog: pick a document (or paste text),
 * ask the server for a preview, let the traveller untick places and move them
 * between days, then confirm. The preview is the server's; the edits live here
 * until the confirm call writes them.
 */
export function useItineraryImport(tripId: number, onClose: () => void) {
  const { t } = useTranslation()
  const toast = useToast()
  const loadTrip = useTripStore((s) => s.loadTrip)
  const tripDays = useTripStore((s) => s.days)
  const aiEnabled = useAddonStore((s) => s.isEnabled('llm_parsing'))

  const [step, setStep] = useState<ItineraryImportStep>('input')
  const [mode, setMode] = useState<'file' | 'text'>('file')
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<ItineraryImportPreviewResponse | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  /** key → day_id, or null for "not planned". */
  const [dayOf, setDayOf] = useState<Map<string, number | null>>(new Map())
  const [applyPlan, setApplyPlan] = useState(true)
  const abortRef = useRef<AbortController | null>(null)

  /** Every trip day is a target, not only the ones the AI used. */
  const days: PreviewDay[] = useMemo(
    () =>
      (tripDays ?? [])
        .map((d, i) => ({ day_id: d.id, day_number: d.day_number ?? i + 1, date: d.date ?? null, title: d.title ?? null }))
        .sort((a, b) => a.day_number - b.day_number),
    [tripDays],
  )

  const canAnalyze = mode === 'file' ? !!file : text.trim().length > 0

  const analyze = async () => {
    if (!canAnalyze) return
    setError(null)
    setStep('analyzing')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const result = await itineraryImportApi.preview(tripId, mode === 'file' ? { file: file! } : { text }, controller.signal)
      setPreview(result)
      setSelected(new Set(result.places.map((p) => p.key)))
      const map = new Map<string, number | null>(result.places.map((p) => [p.key, null]))
      for (const d of result.plan) for (const k of d.place_keys) map.set(k, d.day_id)
      setDayOf(map)
      setApplyPlan(result.plan.length > 0)
      setStep('preview')
    } catch (err: unknown) {
      if (controller.signal.aborted) {
        setStep('input')
        return
      }
      const e = err as { response?: { data?: { error?: string } }; message?: string }
      setError(e.response?.data?.error || e.message || t('itineraryImport.error'))
      setStep('input')
    } finally {
      abortRef.current = null
    }
  }

  const cancelAnalyze = () => abortRef.current?.abort()

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const selectAll = (on: boolean) => setSelected(on ? new Set(preview?.places.map((p) => p.key)) : new Set())
  const moveToDay = (key: string, dayId: number | null) => setDayOf((prev) => new Map(prev).set(key, dayId))

  /**
   * The plan as it now stands: the AI's order for the places it planned, then
   * anything the traveller moved onto a day, in document order. Unticked places
   * drop out.
   */
  const plan = useMemo(() => {
    if (!preview) return []
    return days
      .map((day) => {
        const original = preview.plan.find((p) => p.day_id === day.day_id)?.place_keys ?? []
        const kept = original.filter((k) => dayOf.get(k) === day.day_id && selected.has(k))
        const added = preview.places
          .map((p) => p.key)
          .filter((k) => dayOf.get(k) === day.day_id && selected.has(k) && !original.includes(k))
        return { ...day, place_keys: [...kept, ...added] }
      })
      .filter((d) => d.place_keys.length > 0)
  }, [preview, days, dayOf, selected])

  const byKey = useMemo(() => new Map((preview?.places ?? []).map((p) => [p.key, p])), [preview])

  const confirm = async () => {
    if (!preview || selected.size === 0) return
    setStep('importing')
    try {
      const places: ItineraryImportPlace[] = preview.places.filter((p) => selected.has(p.key))
      const result = await itineraryImportApi.confirm(tripId, {
        places,
        plan: applyPlan ? plan.map((d) => ({ day_id: d.day_id, place_keys: d.place_keys })) : [],
        tentative_tag_name: t('itineraryImport.tentativeTag'),
      })
      await loadTrip(tripId)
      toast.success(
        t('itineraryImport.success', { created: result.created, assigned: result.assigned }) +
          (result.skipped ? ` · ${t('itineraryImport.skipped', { skipped: result.skipped })}` : ''),
      )
      onClose()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string }
      toast.error(e.response?.data?.error || e.message || t('itineraryImport.error'))
      setStep('preview')
    }
  }

  const back = () => {
    setPreview(null)
    setStep('input')
  }

  return {
    t, step, mode, setMode, file, setFile, text, setText, error, aiEnabled,
    canAnalyze, analyze, cancelAnalyze,
    preview, days, selected, toggle, selectAll, dayOf, moveToDay, plan, byKey,
    applyPlan, setApplyPlan, confirm, back,
  }
}

export type ItineraryImportState = ReturnType<typeof useItineraryImport>
