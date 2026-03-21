import { useState, useEffect, useRef, useCallback } from 'react'
import html2canvas from 'html2canvas'

// ─────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────
const timeToMinutes = (t) => {
  if (!t || !t.includes(':')) return 0
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

const fmt = (n, round) =>
  round ? Math.round(n).toLocaleString() : n.toFixed(2).replace(/\.?0+$/, '')

const uid = () => Math.random().toString(36).slice(2, 9)

// ─────────────────────────────────────────────
// CALCULATION ENGINE  (multi-court)
// ─────────────────────────────────────────────
function calculate(settings, players) {
  const { courts, sessionStart, sessionEnd, shuttleCount, shuttlePrice } = settings

  const sessionStartMin = timeToMinutes(sessionStart)
  const sessionEndMin   = timeToMinutes(sessionEnd)

  if (sessionEndMin <= sessionStartMin) return null
  if (players.length === 0) return null
  if (courts.length === 0) return null

  // รวมราคาทุก court ต่อชั่วโมง
  const totalCourtPricePerHour = courts.reduce((sum, c) => sum + (Number(c.price) || 0), 0)

  // Generate time slots (full-hour buckets)
  const slots = []
  for (let t = sessionStartMin; t < sessionEndMin; t += 60) {
    slots.push({ start: t, end: Math.min(t + 60, sessionEndMin) })
  }

  // ── Court cost per player ──
  const courtCosts = {}
  players.forEach((p) => (courtCosts[p.id] = 0))

  slots.forEach((slot) => {
    const slotFraction = (slot.end - slot.start) / 60
    const inSlot = players.filter((p) => {
      const ps = timeToMinutes(p.startTime)
      const pe = timeToMinutes(p.endTime)
      return ps < slot.end && pe > slot.start
    })
    if (inSlot.length === 0) return
    // รวมค่าทุก court แล้วหารด้วยจำนวนคนในช่วงนั้น
    const costPerPerson = (totalCourtPricePerHour * slotFraction) / inSlot.length
    inSlot.forEach((p) => (courtCosts[p.id] += costPerPerson))
  })

  // ── Shuttle cost per player ──
  const shuttleCosts = {}
  players.forEach((p) => (shuttleCosts[p.id] = 0))

  for (let shuttle = 1; shuttle <= shuttleCount; shuttle++) {
    const usingShuttle = players.filter(
      (p) => Number(p.shuttleStart) <= shuttle && Number(p.shuttleEnd) >= shuttle,
    )
    if (usingShuttle.length === 0) continue
    const costPerPerson = shuttlePrice / usingShuttle.length
    usingShuttle.forEach((p) => (shuttleCosts[p.id] += costPerPerson))
  }

  // ── Combine ──
  const results = players.map((p) => ({
    id: p.id,
    name: p.name,
    startTime: p.startTime,
    endTime: p.endTime,
    shuttleStart: p.shuttleStart,
    shuttleEnd: p.shuttleEnd,
    courtCost: courtCosts[p.id] || 0,
    shuttleCost: shuttleCosts[p.id] || 0,
    total: (courtCosts[p.id] || 0) + (shuttleCosts[p.id] || 0),
  }))

  const totalCourt   = results.reduce((s, r) => s + r.courtCost, 0)
  const totalShuttle = results.reduce((s, r) => s + r.shuttleCost, 0)
  const grandTotal   = totalCourt + totalShuttle

  return { results, totalCourt, totalShuttle, grandTotal, totalCourtPricePerHour }
}

// ─────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────
function validate(settings, players) {
  const errors = []
  const sStart = timeToMinutes(settings.sessionStart)
  const sEnd   = timeToMinutes(settings.sessionEnd)

  if (sEnd <= sStart) errors.push('⚠️ เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มเล่น')

  if (settings.courts.length === 0) {
    errors.push('⚠️ ต้องมีสนามอย่างน้อย 1 สนาม')
  } else {
    settings.courts.forEach((c, i) => {
      if (!c.name) errors.push(`⚠️ [สนามที่ ${i + 1}] กรุณากรอกชื่อสนาม`)
      if (Number(c.price) <= 0) errors.push(`⚠️ [${c.name || `สนามที่ ${i + 1}`}] ค่าสนามต้องมากกว่า 0`)
    })
  }

  if (settings.shuttleCount < 1)   errors.push('⚠️ จำนวนลูกแบดต้องอย่างน้อย 1 ลูก')
  if (settings.shuttlePrice <= 0)  errors.push('⚠️ ราคาลูกแบดต้องมากกว่า 0')

  players.forEach((p, i) => {
    const label = p.name || `ผู้เล่นคนที่ ${i + 1}`
    const ps = timeToMinutes(p.startTime)
    const pe = timeToMinutes(p.endTime)
    if (!p.name) errors.push(`⚠️ [${label}] กรุณากรอกชื่อ`)
    if (pe <= ps) errors.push(`⚠️ [${label}] เวลาหยุดต้องมากกว่าเวลาเริ่ม`)
    if (ps < sStart || pe > sEnd)
      errors.push(`⚠️ [${label}] เวลาเล่นต้องอยู่ในช่วง ${settings.sessionStart}–${settings.sessionEnd}`)
    if (Number(p.shuttleStart) > Number(p.shuttleEnd))
      errors.push(`⚠️ [${label}] ลูกเริ่มต้องน้อยกว่าหรือเท่ากับลูกสุดท้าย`)
    if (Number(p.shuttleEnd) > settings.shuttleCount)
      errors.push(`⚠️ [${label}] ลูกสุดท้ายเกินจำนวนลูกทั้งหมด (${settings.shuttleCount})`)
  })

  return errors
}

// ─────────────────────────────────────────────
// DEFAULT DATA
// ─────────────────────────────────────────────
const EXAMPLE_COURTS = [
  { id: uid(), name: 'Court A', price: 140 },
  { id: uid(), name: 'Court B', price: 200 },
]

const EXAMPLE_PLAYERS = [
  { id: uid(), name: 'ดิฟ',   startTime: '18:00', endTime: '19:00', shuttleStart: 1, shuttleEnd: 4 },
  { id: uid(), name: 'นาย',   startTime: '18:00', endTime: '19:00', shuttleStart: 1, shuttleEnd: 4 },
  { id: uid(), name: 'เอิท',  startTime: '18:00', endTime: '21:00', shuttleStart: 2, shuttleEnd: 7 },
  { id: uid(), name: 'ดรอย',  startTime: '18:00', endTime: '21:00', shuttleStart: 1, shuttleEnd: 7 },
  { id: uid(), name: 'มาชร์', startTime: '18:00', endTime: '21:00', shuttleStart: 1, shuttleEnd: 7 },
  { id: uid(), name: 'ปริ้น', startTime: '18:00', endTime: '21:00', shuttleStart: 1, shuttleEnd: 7 },
  { id: uid(), name: 'บิว',   startTime: '18:00', endTime: '21:00', shuttleStart: 2, shuttleEnd: 7 },
  { id: uid(), name: 'ปิ่น',  startTime: '19:00', endTime: '21:00', shuttleStart: 3, shuttleEnd: 7 },
]

const EXAMPLE_SETTINGS = {
  courts: EXAMPLE_COURTS,
  sessionStart: '18:00',
  sessionEnd: '21:00',
  shuttleCount: 7,
  shuttlePrice: 80,
}

const makeCourt = () => ({ id: uid(), name: '', price: 0 })
const makePlayer = (sessionStart = '18:00') => ({
  id: uid(),
  name: '',
  startTime: sessionStart,
  endTime: '',
  shuttleStart: 1,
  shuttleEnd: 1,
})

// ─────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────

// ── Court Row ──
function CourtRow({ court, index, onChange, onRemove, canRemove }) {
  return (
    <div className="slide-in flex items-center gap-3 bg-court-900 border border-court-600 rounded-xl px-4 py-3 mb-2">
      {/* Badge */}
      <span className="text-lime-400 font-display text-lg tracking-wide w-8 shrink-0">
        #{String(index + 1).padStart(2, '0')}
      </span>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <label className="input-label">ชื่อสนาม</label>
        <input
          className="input-field"
          placeholder="เช่น Court A"
          value={court.name}
          onChange={(e) => onChange(court.id, 'name', e.target.value)}
        />
      </div>

      {/* Price */}
      <div className="w-36 shrink-0">
        <label className="input-label">ราคา (บาท/ชม.)</label>
        <input
          type="number"
          className="input-field"
          min={0}
          placeholder="0"
          value={court.price}
          onChange={(e) => onChange(court.id, 'price', Number(e.target.value))}
        />
      </div>

      {/* Remove */}
      {canRemove && (
        <button
          onClick={() => onRemove(court.id)}
          className="shrink-0 mt-4 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded-lg px-2 py-1 text-xs font-semibold transition-all"
        >
          ✕
        </button>
      )}
    </div>
  )
}

// ── Player Row ──
function PlayerRow({ player, index, sessionStart, sessionEnd, shuttleCount, onChange, onRemove }) {
  return (
    <div className="slide-in card border-court-700 mb-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-lime-400 font-display text-xl tracking-wide">
          #{String(index + 1).padStart(2, '0')}
        </span>
        <button
          onClick={() => onRemove(player.id)}
          className="text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded-lg px-2 py-1 text-xs font-semibold transition-all"
        >
          ✕ ลบ
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="col-span-2 sm:col-span-1">
          <label className="input-label">ชื่อผู้เล่น</label>
          <input
            className="input-field"
            placeholder="ชื่อ..."
            value={player.name}
            onChange={(e) => onChange(player.id, 'name', e.target.value)}
          />
        </div>

        <div>
          <label className="input-label">เวลาเริ่ม</label>
          <input
            type="time"
            className="input-field"
            value={player.startTime}
            min={sessionStart}
            max={sessionEnd}
            onChange={(e) => onChange(player.id, 'startTime', e.target.value)}
          />
        </div>

        <div>
          <label className="input-label">เวลาหยุด</label>
          <input
            type="time"
            className="input-field"
            value={player.endTime}
            min={sessionStart}
            max={sessionEnd}
            onChange={(e) => onChange(player.id, 'endTime', e.target.value)}
          />
        </div>

        <div>
          <label className="input-label">ลูกที่เริ่มใช้</label>
          <input
            type="number"
            className="input-field"
            min={1}
            max={shuttleCount}
            value={player.shuttleStart}
            onChange={(e) => onChange(player.id, 'shuttleStart', Number(e.target.value))}
          />
        </div>

        <div>
          <label className="input-label">ลูกสุดท้าย</label>
          <input
            type="number"
            className="input-field"
            min={1}
            max={shuttleCount}
            value={player.shuttleEnd}
            onChange={(e) => onChange(player.id, 'shuttleEnd', Number(e.target.value))}
          />
        </div>
      </div>
    </div>
  )
}

// ── Results Table ──
function ResultsTable({ data, round, settings }) {
  if (!data) return null
  const { results, totalCourt, totalShuttle, grandTotal, totalCourtPricePerHour } = data

  return (
    <div className="fade-in">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="card text-center border-green-800">
          <p className="text-green-500 text-xs font-semibold uppercase tracking-wider mb-1">ค่าสนามรวม</p>
          <p className="text-white font-display text-2xl">{fmt(totalCourt, round)}</p>
          <p className="text-green-600 text-xs">บาท</p>
        </div>
        <div className="card text-center border-green-800">
          <p className="text-green-500 text-xs font-semibold uppercase tracking-wider mb-1">ค่าลูกรวม</p>
          <p className="text-white font-display text-2xl">{fmt(totalShuttle, round)}</p>
          <p className="text-green-600 text-xs">บาท</p>
        </div>
        <div className="card text-center border-lime-400/30 lime-glow">
          <p className="text-lime-400 text-xs font-semibold uppercase tracking-wider mb-1">รวมทั้งหมด</p>
          <p className="text-lime-400 font-display text-2xl">{fmt(grandTotal, round)}</p>
          <p className="text-lime-500 text-xs">บาท</p>
        </div>
      </div>

      {/* Session Info Banner */}
      <div className="flex flex-wrap gap-2 mb-4 text-xs">
        <span className="bg-court-700 text-green-300 px-3 py-1 rounded-full">
          🕐 {settings.sessionStart} – {settings.sessionEnd}
        </span>
        {settings.courts.map((c) => (
          <span key={c.id} className="bg-court-700 text-green-300 px-3 py-1 rounded-full">
            🏟️ {c.name} {c.price} บาท/ชม.
          </span>
        ))}
        <span className="bg-lime-400/10 text-lime-400 border border-lime-400/20 px-3 py-1 rounded-full font-semibold">
          Σ {totalCourtPricePerHour} บาท/ชม.
        </span>
        <span className="bg-court-700 text-green-300 px-3 py-1 rounded-full">
          🏸 {settings.shuttleCount} ลูก × {settings.shuttlePrice} บาท
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-court-600">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-court-700 text-green-400 text-xs uppercase tracking-wider">
              <th className="text-left px-4 py-3 font-semibold">ชื่อ</th>
              <th className="text-right px-4 py-3 font-semibold">ช่วงเวลา</th>
              <th className="text-right px-4 py-3 font-semibold">ลูกที่ใช้</th>
              <th className="text-right px-4 py-3 font-semibold">ค่าสนาม</th>
              <th className="text-right px-4 py-3 font-semibold">ค่าลูก</th>
              <th className="text-right px-4 py-3 font-semibold text-lime-400">รวม</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr
                key={r.id}
                className={`border-t border-court-700 transition-colors hover:bg-court-700/50 ${
                  i % 2 === 0 ? 'bg-court-900/40' : 'bg-court-800/40'
                }`}
              >
                <td className="px-4 py-3 font-semibold text-white">{r.name}</td>
                <td className="px-4 py-3 text-right text-green-300 text-xs">
                  {r.startTime}–{r.endTime}
                </td>
                <td className="px-4 py-3 text-right text-green-300 text-xs">
                  {r.shuttleStart}–{r.shuttleEnd}
                </td>
                <td className="px-4 py-3 text-right text-green-200">{fmt(r.courtCost, round)}</td>
                <td className="px-4 py-3 text-right text-green-200">{fmt(r.shuttleCost, round)}</td>
                <td className="px-4 py-3 text-right font-bold text-lime-400">
                  ฿{fmt(r.total, round)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-lime-400/30 bg-court-700">
              <td colSpan={3} className="px-4 py-3 text-green-400 font-semibold text-xs uppercase tracking-wide">
                รวมทั้งหมด
              </td>
              <td className="px-4 py-3 text-right font-bold text-white">{fmt(totalCourt, round)}</td>
              <td className="px-4 py-3 text-right font-bold text-white">{fmt(totalShuttle, round)}</td>
              <td className="px-4 py-3 text-right font-bold text-lime-400 text-base">
                ฿{fmt(grandTotal, round)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────
export default function App() {
  const [settings, setSettings] = useState({
    courts: [{ id: uid(), name: 'Court A', price: 140 }],
    sessionStart: '18:00',
    sessionEnd: '21:00',
    shuttleCount: 7,
    shuttlePrice: 80,
  })
  const [players, setPlayers]     = useState([makePlayer('18:00')])
  const [round, setRound]         = useState(false)
  const [errors, setErrors]       = useState([])
  const [calcResult, setCalcResult] = useState(null)
  const [exporting, setExporting] = useState(false)
  const resultRef = useRef(null)

  // Auto-calculate on change
  useEffect(() => {
    const errs = validate(settings, players)
    setErrors(errs)
    if (errs.length === 0) {
      setCalcResult(calculate(settings, players))
    } else {
      setCalcResult(null)
    }
  }, [settings, players])

  // ── Settings handlers ──
  const updateSetting = useCallback((key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }, [])

  // ── Court handlers ──
  const addCourt = useCallback(() => {
    setSettings((prev) => ({ ...prev, courts: [...prev.courts, makeCourt()] }))
  }, [])

  const updateCourt = useCallback((id, field, value) => {
    setSettings((prev) => ({
      ...prev,
      courts: prev.courts.map((c) => (c.id === id ? { ...c, [field]: value } : c)),
    }))
  }, [])

  const removeCourt = useCallback((id) => {
    setSettings((prev) => ({
      ...prev,
      courts: prev.courts.filter((c) => c.id !== id),
    }))
  }, [])

  // ── Player handlers ──
  const updatePlayer = useCallback((id, field, value) => {
    setPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)))
  }, [])

  const addPlayer = useCallback(() => {
    setPlayers((prev) => [...prev, makePlayer(settings.sessionStart)])
  }, [settings.sessionStart])

  const removePlayer = useCallback((id) => {
    setPlayers((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const loadExample = useCallback(() => {
    setSettings({
      ...EXAMPLE_SETTINGS,
      courts: EXAMPLE_SETTINGS.courts.map((c) => ({ ...c, id: uid() })),
    })
    setPlayers(EXAMPLE_PLAYERS.map((p) => ({ ...p, id: uid() })))
  }, [])

  const clearAll = useCallback(() => {
    setSettings({
      courts: [{ id: uid(), name: 'Court A', price: 0 }],
      sessionStart: '18:00',
      sessionEnd: '21:00',
      shuttleCount: 1,
      shuttlePrice: 0,
    })
    setPlayers([makePlayer('18:00')])
  }, [])

  const exportImage = useCallback(async () => {
    if (!resultRef.current) return
    setExporting(true)
    try {
      const canvas = await html2canvas(resultRef.current, {
        backgroundColor: '#0a1a0f',
        scale: 2,
        useCORS: true,
        logging: false,
      })
      const link = document.createElement('a')
      link.download = `badminton-split-${new Date().toLocaleDateString('th-TH').replace(/\//g, '-')}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    } catch (err) {
      console.error('Export failed:', err)
    } finally {
      setExporting(false)
    }
  }, [])

  const copyToClipboard = useCallback(async () => {
    if (!calcResult) return
    const { results, totalCourt, totalShuttle, grandTotal } = calcResult
    const courtList = settings.courts.map((c) => `${c.name} ${c.price} บาท/ชม.`).join(', ')
    const lines = [
      `🏸 Badminton Split — ${settings.sessionStart}–${settings.sessionEnd}`,
      `🏟️ ${courtList}`,
      `──────────────────────────`,
      ...results.map(
        (r) =>
          `${r.name.padEnd(8)} ค่าสนาม: ${fmt(r.courtCost, round).padStart(7)} | ลูก: ${fmt(r.shuttleCost, round).padStart(7)} | รวม: ฿${fmt(r.total, round)}`,
      ),
      `──────────────────────────`,
      `ค่าสนามรวม: ฿${fmt(totalCourt, round)}`,
      `ค่าลูกรวม:  ฿${fmt(totalShuttle, round)}`,
      `รวมทั้งหมด: ฿${fmt(grandTotal, round)}`,
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      alert('คัดลอกสรุปค่าใช้จ่ายแล้ว! 📋')
    } catch {
      alert('ไม่สามารถคัดลอกได้ กรุณาลอง Export รูปภาพแทน')
    }
  }, [calcResult, round, settings])

  // คำนวณ total court price per hour สำหรับแสดงใน UI
  const totalCourtRate = settings.courts.reduce((sum, c) => sum + (Number(c.price) || 0), 0)

  return (
    <div className="min-h-screen bg-court-900 font-body text-white pb-12">
      {/* ─── HEADER ─── */}
      <header className="relative overflow-hidden bg-court-950 border-b border-court-700 px-4 py-6">
        <div className="absolute inset-0 opacity-5 pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-full bg-lime-400" />
          <div className="absolute top-1/2 left-0 w-full h-px bg-lime-400" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full border border-lime-400" />
        </div>
        <div className="relative max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-display text-4xl sm:text-5xl text-white tracking-widest leading-none">
              BADMINTON<span className="text-lime-400">.</span>SPLIT
            </h1>
            <p className="text-green-500 text-xs sm:text-sm mt-1 font-medium">
              คำนวณค่าใช้จ่ายยุติธรรม · แบ่งตามเวลาจริง
            </p>
          </div>
          <div className="text-5xl opacity-80">🏸</div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 pt-6 space-y-6">
        {/* ─── QUICK ACTIONS ─── */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={loadExample}
            className="flex items-center gap-2 bg-court-700 hover:bg-court-600 border border-court-600 hover:border-lime-400/50 text-green-300 hover:text-lime-400 text-sm px-4 py-2 rounded-lg font-semibold transition-all"
          >
            🧪 โหลดตัวอย่าง
          </button>
          <button
            onClick={clearAll}
            className="flex items-center gap-2 bg-court-800 hover:bg-court-700 border border-court-600 text-green-500 hover:text-green-300 text-sm px-4 py-2 rounded-lg font-semibold transition-all"
          >
            🗑️ เคลียร์ทั้งหมด
          </button>
        </div>

        {/* ─── COURT SETTINGS SECTION ─── */}
        <section className="card border-court-600">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display text-2xl tracking-widest text-lime-400">
                COURTS{' '}
                <span className="text-green-600 text-lg">({settings.courts.length})</span>
              </h2>
              {settings.courts.length > 0 && totalCourtRate > 0 && (
                <p className="text-xs text-green-500 mt-0.5">
                  รวมค่าสนามทั้งหมด{' '}
                  <span className="text-lime-400 font-bold">{totalCourtRate.toLocaleString()} บาท/ชม.</span>
                </p>
              )}
            </div>
            <button
              onClick={addCourt}
              className="flex items-center gap-2 bg-lime-400 hover:bg-lime-300 text-court-950 text-sm px-4 py-2 rounded-lg font-bold transition-all active:scale-95"
            >
              + เพิ่มสนาม
            </button>
          </div>

          {/* Court rows */}
          {settings.courts.length === 0 ? (
            <div className="text-center text-green-600 py-6 border border-dashed border-court-600 rounded-xl">
              <p className="text-2xl mb-1">🏟️</p>
              <p className="text-sm font-semibold">ยังไม่มีสนาม กด "เพิ่มสนาม" เพื่อเริ่ม</p>
            </div>
          ) : (
            settings.courts.map((court, i) => (
              <CourtRow
                key={court.id}
                court={court}
                index={i}
                onChange={updateCourt}
                onRemove={removeCourt}
                canRemove={settings.courts.length > 1}
              />
            ))
          )}
        </section>

        {/* ─── SESSION TIME SECTION ─── */}
        <section className="card border-court-600">
          <h2 className="font-display text-2xl tracking-widest text-lime-400 mb-4">
            SESSION TIME
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="input-label">เวลาเริ่มเล่น</label>
              <input
                type="time"
                className="input-field"
                value={settings.sessionStart}
                onChange={(e) => updateSetting('sessionStart', e.target.value)}
              />
            </div>
            <div>
              <label className="input-label">เวลาสิ้นสุด</label>
              <input
                type="time"
                className="input-field"
                value={settings.sessionEnd}
                onChange={(e) => updateSetting('sessionEnd', e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* ─── SHUTTLE SECTION ─── */}
        <section className="card border-court-600">
          <h2 className="font-display text-2xl tracking-widest text-lime-400 mb-4">
            SHUTTLECOCK
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="input-label">จำนวนลูกทั้งหมด</label>
              <input
                type="number"
                className="input-field"
                min={1}
                value={settings.shuttleCount}
                onChange={(e) => updateSetting('shuttleCount', Number(e.target.value))}
              />
            </div>
            <div>
              <label className="input-label">ราคาต่อลูก (บาท)</label>
              <input
                type="number"
                className="input-field"
                min={0}
                value={settings.shuttlePrice}
                onChange={(e) => updateSetting('shuttlePrice', Number(e.target.value))}
              />
            </div>
          </div>
          {settings.shuttleCount > 0 && settings.shuttlePrice > 0 && (
            <p className="mt-3 text-green-500 text-xs">
              💰 ค่าลูกรวม:{' '}
              <span className="text-lime-400 font-bold">
                {(settings.shuttleCount * settings.shuttlePrice).toLocaleString()} บาท
              </span>
            </p>
          )}
        </section>

        {/* ─── PLAYERS SECTION ─── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-2xl tracking-widest text-lime-400">
              PLAYERS{' '}
              <span className="text-green-600 text-lg">({players.length})</span>
            </h2>
            <button
              onClick={addPlayer}
              className="flex items-center gap-2 bg-lime-400 hover:bg-lime-300 text-court-950 text-sm px-4 py-2 rounded-lg font-bold transition-all active:scale-95"
            >
              + เพิ่มผู้เล่น
            </button>
          </div>

          {players.length === 0 && (
            <div className="card text-center text-green-600 py-10 border-dashed border-court-600">
              <p className="text-3xl mb-2">👤</p>
              <p className="font-semibold">ยังไม่มีผู้เล่น กด "เพิ่มผู้เล่น" เพื่อเริ่ม</p>
            </div>
          )}

          {players.map((player, i) => (
            <PlayerRow
              key={player.id}
              player={player}
              index={i}
              sessionStart={settings.sessionStart}
              sessionEnd={settings.sessionEnd}
              shuttleCount={settings.shuttleCount}
              onChange={updatePlayer}
              onRemove={removePlayer}
            />
          ))}
        </section>

        {/* ─── ERROR PANEL ─── */}
        {errors.length > 0 && (
          <div className="card border-red-800/60 bg-red-950/20">
            <p className="text-red-400 font-semibold text-sm mb-2">ตรวจพบข้อผิดพลาด:</p>
            <ul className="space-y-1">
              {errors.map((e, i) => (
                <li key={i} className="text-red-300 text-xs">{e}</li>
              ))}
            </ul>
          </div>
        )}

        {/* ─── RESULTS SECTION ─── */}
        {calcResult && (
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="font-display text-2xl tracking-widest text-lime-400">RESULTS</h2>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setRound((r) => !r)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold border transition-all ${
                    round
                      ? 'bg-lime-400 text-court-950 border-lime-400'
                      : 'bg-court-800 text-green-400 border-court-600 hover:border-lime-400/50'
                  }`}
                >
                  {round ? '✓ ปัดเศษแล้ว' : '  ปัดเศษ'}
                </button>
                <button
                  onClick={copyToClipboard}
                  className="flex items-center gap-2 bg-court-700 hover:bg-court-600 border border-court-600 hover:border-green-500 text-green-300 text-xs px-3 py-2 rounded-lg font-semibold transition-all"
                >
                  📋 คัดลอก
                </button>
                <button
                  onClick={exportImage}
                  disabled={exporting}
                  className="flex items-center gap-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs px-3 py-2 rounded-lg font-semibold transition-all active:scale-95"
                >
                  {exporting ? '⏳ กำลัง Export...' : '📸 Export รูป'}
                </button>
              </div>
            </div>

            <div ref={resultRef} className="card border-court-600 p-4 sm:p-6">
              <div className="flex items-center justify-between mb-5 pb-4 border-b border-court-600">
                <div>
                  <p className="font-display text-2xl text-white tracking-widest">
                    BADMINTON<span className="text-lime-400">.</span>SPLIT
                  </p>
                  <p className="text-green-500 text-xs">
                    สรุปค่าใช้จ่าย — วันที่{' '}
                    {new Date().toLocaleDateString('th-TH', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </p>
                </div>
                <span className="text-3xl">🏸</span>
              </div>
              <ResultsTable data={calcResult} round={round} settings={settings} />
            </div>
          </section>
        )}

        {!calcResult && errors.length === 0 && players.length > 0 && (
          <div className="card text-center py-10 border-dashed border-court-600">
            <p className="text-green-600 text-sm">กรอกข้อมูลให้ครบเพื่อดูผลลัพธ์</p>
          </div>
        )}
      </main>

      {/* ─── FOOTER ─── */}
      <footer className="max-w-4xl mx-auto px-4 mt-10 text-center text-green-800 text-xs">
        คำนวณตามเวลาจริงและลูกแบดที่ใช้จริง · ยุติธรรมกับทุกคน 🏸
      </footer>
    </div>
  )
}