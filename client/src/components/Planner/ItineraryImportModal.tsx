import type React from 'react'
import { createPortal } from 'react-dom'
import { FileText, Loader2, Sparkles, Upload, X } from 'lucide-react'
import type { ItineraryImportCategory } from '@trek/shared'
import ToggleSwitch from '../Settings/ToggleSwitch'
import { useItineraryImport, type ItineraryImportState, type PreviewDay } from './useItineraryImport'

const ACCEPT = '.docx,.xlsx,.pdf,.txt,.md,.csv,.html,.htm,.eml'

const CATEGORY_EMOJI: Record<ItineraryImportCategory, string> = {
  restaurant: '🍽️', cafe: '☕', attraction: '🏛️', shopping: '🛍️', hotel: '🏨',
  nature: '🌿', activity: '🎯', transport: '🚌', other: '📍',
}

const caption = { fontSize: 'calc(11px * var(--fs-scale-caption, 1))' }
const body = { fontSize: 'calc(13px * var(--fs-scale-body, 1))' }

function dayLabel(d: PreviewDay): string {
  const date = d.date ? ` · ${d.date.slice(5).replace('-', '/')}` : ''
  return `Day ${d.day_number}${date}`
}

export default function ItineraryImportModal({ tripId, onClose }: { tripId: number; onClose: () => void }) {
  const S = useItineraryImport(tripId, onClose)
  const busy = S.step === 'analyzing' || S.step === 'importing'
  return createPortal(
    <div
      role="presentation"
      onClick={() => { if (!busy) onClose() }}
      className="bg-[rgba(0,0,0,0.4)]"
      style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
        className="bg-surface-card"
        style={{
          borderRadius: 16, width: '100%', maxWidth: S.step === 'preview' || S.step === 'importing' ? 720 : 480,
          maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '20px 24px 8px' }}>
          <Sparkles size={16} className="text-accent" />
          <div className="text-content" style={{ fontSize: 'calc(15px * var(--fs-scale-subtitle, 1))', fontWeight: 700, flex: 1 }}>
            {S.t('itineraryImport.title')}
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label={S.t('common.close')}
            className="text-content-faint" style={{ background: 'none', border: 'none', cursor: busy ? 'default' : 'pointer', padding: 4 }}>
            <X size={16} />
          </button>
        </div>
        {S.step === 'input' && <InputStep S={S} onClose={onClose} />}
        {S.step === 'analyzing' && <AnalyzingStep S={S} />}
        {(S.step === 'preview' || S.step === 'importing') && <PreviewStep S={S} />}
      </div>
    </div>,
    document.body,
  )
}

function Footer({ children }: { children: React.ReactNode }) {
  return <div className="border-t border-edge" style={{ display: 'flex', gap: 8, padding: '12px 24px', justifyContent: 'flex-end', alignItems: 'center' }}>{children}</div>
}

function Button({ primary, disabled, onClick, children }: { primary?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  const cls = primary ? (disabled ? 'bg-surface-tertiary text-content-faint' : 'bg-accent text-accent-text') : 'text-content'
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}
      style={{
        ...body, padding: '8px 16px', borderRadius: 10, fontWeight: 500, fontFamily: 'inherit',
        border: primary ? 'none' : '1px solid var(--border-primary)', background: primary ? undefined : 'none',
        cursor: disabled ? 'default' : 'pointer',
      }}>
      {children}
    </button>
  )
}

function InputStep({ S, onClose }: { S: ItineraryImportState; onClose: () => void }) {
  return (
    <>
      <div style={{ padding: '0 24px 16px', overflowY: 'auto' }}>
        <div className="text-content-faint" style={{ ...caption, marginBottom: 14, lineHeight: 1.5 }}>{S.t('itineraryImport.hint')}</div>
        {!S.aiEnabled && (
          <div className="bg-surface-tertiary text-content-muted" style={{ ...caption, borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
            {S.t('itineraryImport.notConfigured')}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {(['file', 'text'] as const).map(m => (
            <button type="button" key={m} onClick={() => S.setMode(m)}
              className={S.mode === m ? 'bg-accent text-accent-text' : 'bg-surface-tertiary text-content-muted'}
              style={{ ...caption, padding: '6px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' }}>
              {S.t(m === 'file' ? 'itineraryImport.tabFile' : 'itineraryImport.tabText')}
            </button>
          ))}
        </div>
        {S.mode === 'file' ? (
          <label className="border border-dashed border-edge text-content-muted"
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '24px 12px', borderRadius: 12, cursor: 'pointer', textAlign: 'center' }}>
            {S.file ? <FileText size={22} /> : <Upload size={22} />}
            <span className="text-content" style={{ ...body, fontWeight: 600, wordBreak: 'break-all' }}>{S.file ? S.file.name : S.t('itineraryImport.chooseFile')}</span>
            <span className="text-content-faint" style={caption}>{S.t('itineraryImport.fileTypes')}</span>
            <input type="file" accept={ACCEPT} style={{ display: 'none' }} onChange={e => S.setFile(e.target.files?.[0] ?? null)} />
          </label>
        ) : (
          <textarea value={S.text} onChange={e => S.setText(e.target.value)} rows={10}
            placeholder={S.t('itineraryImport.textPlaceholder')}
            className="bg-surface-tertiary text-content"
            style={{ ...body, width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border-primary)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }} />
        )}
        {S.error && <div className="text-danger" style={{ ...caption, marginTop: 10 }}>{S.error}</div>}
      </div>
      <Footer>
        <Button onClick={onClose}>{S.t('common.cancel')}</Button>
        <Button primary disabled={!S.canAnalyze || !S.aiEnabled} onClick={S.analyze}>{S.t('itineraryImport.analyze')}</Button>
      </Footer>
    </>
  )
}

function AnalyzingStep({ S }: { S: ItineraryImportState }) {
  return (
    <>
      <div className="text-content-muted" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '32px 24px', textAlign: 'center' }}>
        <Loader2 size={28} className="animate-spin text-accent" />
        <div style={body}>{S.t('itineraryImport.analyzing')}</div>
      </div>
      <Footer><Button onClick={S.cancelAnalyze}>{S.t('itineraryImport.cancelAnalyze')}</Button></Footer>
    </>
  )
}

function Badge({ children, tone }: { children: React.ReactNode; tone: 'amber' | 'red' | 'neutral' }) {
  const cls = tone === 'amber' ? 'bg-warning-soft text-warning' : tone === 'red' ? 'bg-danger-soft text-danger' : 'bg-surface-tertiary text-content-muted'
  return <span className={cls} style={{ ...caption, padding: '1px 7px', borderRadius: 999, fontWeight: 600, whiteSpace: 'nowrap' }}>{children}</span>
}

function PreviewStep({ S }: { S: ItineraryImportState }) {
  const p = S.preview!
  const located = p.places.filter(x => x.lat != null).length
  const importing = S.step === 'importing'
  return (
    <>
      <div style={{ padding: '0 24px 12px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
        <div className="text-content-muted" style={{ ...caption, marginBottom: 8 }}>
          {S.t('itineraryImport.summary', { count: p.places.length, located })}
        </div>
        {p.warnings.map(w => <div key={w} className="text-warning" style={{ ...caption, marginBottom: 4 }}>{w}</div>)}

        <Section title={S.t('itineraryImport.planTitle')}>
          {S.plan.length === 0 ? (
            <div className="text-content-faint" style={caption}>{S.t('itineraryImport.planEmpty')}</div>
          ) : (
            <>
              {S.plan.map(d => (
                <div key={d.day_id} style={{ display: 'flex', gap: 10, padding: '5px 0', alignItems: 'baseline' }}>
                  <span className="text-accent" style={{ ...caption, fontWeight: 700, minWidth: 82, whiteSpace: 'nowrap' }}>{dayLabel(d)}</span>
                  <span className="text-content" style={{ ...caption, lineHeight: 1.6 }}>
                    {d.place_keys.map(k => S.byKey.get(k)?.name).filter(Boolean).join(' → ')}
                  </span>
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                <ToggleSwitch on={S.applyPlan} onToggle={() => S.setApplyPlan(!S.applyPlan)} />
                <span className="text-content" style={{ ...caption, fontWeight: 600 }}>{S.t('itineraryImport.applyPlan')}</span>
              </div>
            </>
          )}
        </Section>

        <Section
          title={`${S.t('itineraryImport.placesTitle')} (${S.selected.size}/${p.places.length})`}
          action={
            <span style={{ display: 'flex', gap: 10 }}>
              <LinkButton onClick={() => S.selectAll(true)}>{S.t('itineraryImport.selectAll')}</LinkButton>
              <LinkButton onClick={() => S.selectAll(false)}>{S.t('itineraryImport.selectNone')}</LinkButton>
            </span>
          }
        >
          {p.places.map(place => {
            const on = S.selected.has(place.key)
            const meta = [place.area || place.city, place.rating].filter(Boolean).join(' · ')
            return (
              <div key={place.key} className="border-b border-edge" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', opacity: on ? 1 : 0.45 }}>
                <input type="checkbox" checked={on} onChange={() => S.toggle(place.key)} style={{ flexShrink: 0, cursor: 'pointer' }} />
                <span aria-hidden style={{ flexShrink: 0 }}>{CATEGORY_EMOJI[place.category]}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="text-content" style={{ ...body, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={place.notes ?? undefined}>
                    {place.name}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', marginTop: 2 }}>
                    {meta && <span className="text-content-faint" style={caption}>{meta}</span>}
                    {place.meal && <Badge tone="neutral">{S.t(`itineraryImport.meal.${place.meal}`)}</Badge>}
                    {place.tentative && <Badge tone="amber">{S.t('itineraryImport.tentative')}</Badge>}
                    {place.lat == null && <Badge tone="red">{S.t('itineraryImport.noLocation')}</Badge>}
                  </div>
                </div>
                {S.days.length > 0 && place.category !== 'hotel' && (
                  <select value={S.dayOf.get(place.key) ?? ''} disabled={!on}
                    onChange={e => S.moveToDay(place.key, e.target.value ? Number(e.target.value) : null)}
                    className="bg-surface-tertiary text-content"
                    style={{ ...caption, flexShrink: 0, maxWidth: 130, padding: '4px 6px', borderRadius: 8, border: '1px solid var(--border-primary)', fontFamily: 'inherit' }}>
                    <option value="">{S.t('itineraryImport.unplanned')}</option>
                    {S.days.map(d => <option key={d.day_id} value={d.day_id}>{dayLabel(d)}</option>)}
                  </select>
                )}
              </div>
            )
          })}
        </Section>

        {p.todos.length > 0 && (
          <Section title={`${S.t('itineraryImport.todosTitle')} (${S.selectedTodos.size}/${p.todos.length})`}>
            <div className="text-content-faint" style={{ ...caption, marginBottom: 4 }}>{S.t('itineraryImport.todosHint')}</div>
            {p.todos.map((todo, i) => (
              <label key={`${i}-${todo}`} className="text-content" style={{ ...caption, display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0', lineHeight: 1.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={S.selectedTodos.has(i)} onChange={() => S.toggleTodo(i)} style={{ marginTop: 2, flexShrink: 0 }} />
                <span>{todo}</span>
              </label>
            ))}
          </Section>
        )}
      </div>
      <Footer>
        <Button onClick={S.back} disabled={importing}>{S.t('itineraryImport.back')}</Button>
        <Button primary disabled={importing || S.selected.size === 0} onClick={S.confirm}>
          {importing ? S.t('itineraryImport.importing') : S.t('itineraryImport.import', { count: S.selected.size })}
        </Button>
      </Footer>
    </>
  )
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <div className="text-content-secondary" style={{ ...caption, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, flex: 1 }}>{title}</div>
        {action}
      </div>
      {children}
    </div>
  )
}

function LinkButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-accent"
      style={{ ...caption, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600, fontFamily: 'inherit' }}>
      {children}
    </button>
  )
}
