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
// CALCULATION ENGINE (Multi-Court)
// ─────────────────────────────────────────────
/**
 * courts: [{ id, name, courtPricePerHour, sessionStart, sessionEnd, players: [...] }]
 * shuttle: { shuttleCount, shuttlePrice }
 *
 * ค่าสนาม: คำนวณแยกต่อ court (ราคา/เวลาต่างกันได้)
 * ค่าลูก:  pool รวมทุก court หารตาม shuttleStart–End
 */
function calculate(courts, shuttle) {
  const { shuttleCount, shuttlePrice } = shuttle
  const allPlayers = courts.flatMap((c) => c.players.map((p) => ({ ...p, courtId: c.id })))

  if (allPlayers.length === 0) return null

  // ── Court cost: per court ──
  const courtCosts = {}
  allPlayers.forEach((p) => (courtCosts[p.id] = 0))

  courts.forEach((court) => {
    const startMin = timeToMinutes(court.sessionStart)
    const endMin = timeToMinutes(court.sessionEnd)
    if (endMin <= startMin || court.players.length === 0) return

    const slots = []
    for (let t = startMin; t < endMin; t += 60) {
      slots.push({ start: t, end: Math.min(t + 60, endMin) })
    }

    slots.forEach((slot) => {
      const fraction = (slot.end - slot.start) / 60
      const inSlot = court.players.filter((p) => {
        const ps = timeToMinutes(p.startTime)
        const pe = timeToMinutes(p.endTime)
        return ps < slot.end && pe > slot.start
      })
      if (inSlot.length === 0) return
      const costPer = (court.courtPricePerHour * fraction) / inSlot.length
      inSlot.forEach((p) => (courtCosts[p.id] += costPer))
    })
  })

  // ── Shuttle cost: shared pool across all courts ──
  const shuttleCosts = {}
  allPlayers.forEach((p) => (shuttleCosts[p.id] = 0))

  for (let s = 1; s <= shuttleCount; s++) {
    const using = allPlayers.filter(
      (p) => Number(p.shuttleStart) <= s && Number(p.shuttleEnd) >= s,
    )
    if (using.length === 0) continue
    const costPer = shuttlePrice / using.length
    using.forEach((p) => (shuttleCosts[p.id] += costPer))
  }

  // ── Per-court results ──
  const courtResults = courts.map((court) => {
    const results = court.players.map((p) => ({
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
    return { courtId: court.id, courtName: court.name, results }
  })

  // ── Grand totals ──
  const allResults = courtResults.flatMap((c) => c.results)
  const totalCourt = allResults.reduce((s, r) => s + r.courtCost, 0)
  const totalShuttle = allResults.reduce((s, r) => s + r.shuttleCost, 0)
  const grandTotal = totalCourt + totalShuttle

  return { courtResults, totalCourt, totalShuttle, grandTotal }
}

// ─────────────────────────────────────────────
// VALIDATION (Multi-Court)
// ─────────────────────────────────────────────
function validate(courts, shuttle) {
  const errors = []
  const { shuttleCount, shuttlePrice } = shuttle

  if (shuttleCount < 1) errors.push('⚠️ จำนวนลูกแบดต้องอย่างน้อย 1 ลูก')
  if (shuttlePrice <= 0) errors.push('⚠️ ราคาลูกแบดต้องมากกว่า 0')

  courts.forEach((court, ci) => {
    const courtLabel = court.name || `สนาม ${ci + 1}`
    const sStart = timeToMinutes(court.sessionStart)
    const sEnd = timeToMinutes(court.sessionEnd)

    if (sEnd <= sStart)
      errors.push(`⚠️ [${courtLabel}] เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มเล่น`)
    if (court.courtPricePerHour <= 0)
      errors.push(`⚠️ [${courtLabel}] ค่าสนามต้องมากกว่า 0`)

    court.players.forEach((p, i) => {
      const label = p.name || `ผู้เล่นคนที่ ${i + 1}`
      const ps = timeToMinutes(p.startTime)
      const pe = timeToMinutes(p.endTime)
      if (!p.name) errors.push(`⚠️ [${courtLabel}] [${label}] กรุณากรอกชื่อ`)
      if (pe <= ps) errors.push(`⚠️ [${courtLabel}] [${label}] เวลาหยุดต้องมากกว่าเวลาเริ่ม`)
      if (ps < sStart || pe > sEnd)
        errors.push(
          `⚠️ [${courtLabel}] [${label}] เวลาเล่นต้องอยู่ในช่วง ${court.sessionStart}–${court.sessionEnd}`,
        )
      if (Number(p.shuttleStart) > Number(p.shuttleEnd))
        errors.push(`⚠️ [${courtLabel}] [${label}] ลูกเริ่มต้องน้อยกว่าหรือเท่ากับลูกสุดท้าย`)
      if (Number(p.shuttleEnd) > shuttleCount)
        errors.push(
          `⚠️ [${courtLabel}] [${label}] ลูกสุดท้ายเกินจำนวนลูกทั้งหมด (${shuttleCount})`,
        )
    })
  })

  return errors
}

// ─────────────────────────────────────────────
// FACTORY FUNCTIONS
// ─────────────────────────────────────────────
const makePlayer = (sessionStart = '18:00') => ({
  id: uid(),
  name: '',
  startTime: sessionStart,
  endTime: '',
  shuttleStart: 1,
  shuttleEnd: 1,
})

const makeCourt = (index = 0) => ({
  id: uid(),
  name: `สนาม ${index + 1}`,
  courtPricePerHour: 140,
  sessionStart: '18:00',
  sessionEnd: '21:00',
  players: [makePlayer('18:00')],
})

// ─────────────────────────────────────────────
// EXAMPLE DATA (Multi-Court)
// ─────────────────────────────────────────────
const EXAMPLE_COURTS = [
  {
    id: uid(),
    name: 'สนาม A',
    courtPricePerHour: 140,
    sessionStart: '18:00',
    sessionEnd: '21:00',
    players: [
      { id: uid(), name: 'ดิฟ', startTime: '18:00', endTime: '19:00', shuttleStart: 1, shuttleEnd: 4 },
      { id: uid(), name: 'นาย', startTime: '18:00', endTime: '19:00', shuttleStart: 1, shuttleEnd: 4 },
      { id: uid(), name: 'เอิท', startTime: '18:00', endTime: '21:00', shuttleStart: 2, shuttleEnd: 7 },
      { id: uid(), name: 'ดรอย', startTime: '18:00', endTime: '21:00', shuttleStart: 1, shuttleEnd: 7 },
    ],
  },
  {
    id: uid(),
    name: 'สนาม B',
    courtPricePerHour: 160,
    sessionStart: '18:00',
    sessionEnd: '20:00',
    players: [
      { id: uid(), name: 'มาชร์', startTime: '18:00', endTime: '20:00', shuttleStart: 1, shuttleEnd: 7 },
      { id: uid(), name: 'ปริ้น', startTime: '18:00', endTime: '20:00', shuttleStart: 1, shuttleEnd: 7 },
      { id: uid(), name: 'บิว', startTime: '18:00', endTime: '20:00', shuttleStart: 2, shuttleEnd: 7 },
      { id: uid(), name: 'ปิ่น', startTime: '19:00', endTime: '20:00', shuttleStart: 3, shuttleEnd: 7 },
    ],
  },
]

const EXAMPLE_SHUTTLE = { shuttleCount: 7, shuttlePrice: 80 }

// ─────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────
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

// Court Card — กล่องสนามแต่ละอัน
function CourtCard({ court, courtIndex, courtCount, shuttle, onUpdateCourt, onRemoveCourt }) {
  const updateField = (field, value) => onUpdateCourt(court.id, field, value)

  const updatePlayer = useCallback(
    (playerId, field, value) => {
      onUpdateCourt(court.id, 'players', (prevPlayers) =>
        prevPlayers.map((p) => (p.id === playerId ? { ...p, [field]: value } : p)),
      )
    },
    [court.id, onUpdateCourt],
  )

  const addPlayer = useCallback(() => {
    onUpdateCourt(court.id, 'players', (prevPlayers) => [
      ...prevPlayers,
      makePlayer(court.sessionStart),
    ])
  }, [court.id, court.sessionStart, onUpdateCourt])

  const removePlayer = useCallback((playerId) => {
    onUpdateCourt(court.id, 'players', (prevPlayers) =>
      prevPlayers.filter((p) => p.id !== playerId),
    )
  }, [court.id, onUpdateCourt])

  const courtColors = [
    { border: 'border-lime-400/40', badge: 'bg-lime-400 text-court-950', label: 'text-lime-400' },
    { border: 'border-cyan-400/40', badge: 'bg-cyan-400 text-court-950', label: 'text-cyan-400' },
    { border: 'border-orange-400/40', badge: 'bg-orange-400 text-court-950', label: 'text-orange-400' },
    { border: 'border-pink-400/40', badge: 'bg-pink-400 text-court-950', label: 'text-pink-400' },
  ]
  const color = courtColors[courtIndex % courtColors.length]

  return (
    <div className={`card ${color.border} border-2`}>
      {/* Court Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className={`${color.badge} font-display text-sm px-3 py-1 rounded-full tracking-wider`}>
            COURT {courtIndex + 1}
          </span>
          <input
            className="bg-transparent border-b border-court-600 focus:border-lime-400 focus:outline-none text-white font-semibold text-sm px-1 py-0.5 w-28 transition-colors"
            value={court.name}
            placeholder="ชื่อสนาม"
            onChange={(e) => updateField('name', e.target.value)}
          />
        </div>
        {courtCount > 1 && (
          <button
            onClick={() => onRemoveCourt(court.id)}
            className="text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded-lg px-3 py-1 text-xs font-semibold transition-all"
          >
            ✕ ลบสนาม
          </button>
        )}
      </div>

      {/* Court Settings */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5 pb-5 border-b border-court-700">
        <div className="col-span-2 sm:col-span-1">
          <label className="input-label">ค่าสนาม (บาท/ชม.)</label>
          <input
            type="number"
            className="input-field"
            min={0}
            value={court.courtPricePerHour}
            onChange={(e) => updateField('courtPricePerHour', Number(e.target.value))}
          />
        </div>
        <div>
          <label className="input-label">เวลาเริ่มเล่น</label>
          <input
            type="time"
            className="input-field"
            value={court.sessionStart}
            onChange={(e) => updateField('sessionStart', e.target.value)}
          />
        </div>
        <div>
          <label className="input-label">เวลาสิ้นสุด</label>
          <input
            type="time"
            className="input-field"
            value={court.sessionEnd}
            onChange={(e) => updateField('sessionEnd', e.target.value)}
          />
        </div>
      </div>

      {/* Players */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className={`font-display text-lg tracking-widest ${color.label}`}>
            PLAYERS <span className="text-green-600 text-sm">({court.players.length})</span>
          </h3>
          <button
            onClick={addPlayer}
            className="flex items-center gap-1 bg-lime-400 hover:bg-lime-300 text-court-950 text-xs px-3 py-1.5 rounded-lg font-bold transition-all active:scale-95"
          >
            + เพิ่มผู้เล่น
          </button>
        </div>

        {court.players.length === 0 && (
          <div className="text-center text-green-600 py-6 border border-dashed border-court-600 rounded-xl">
            <p className="text-2xl mb-1">👤</p>
            <p className="text-xs font-semibold">ยังไม่มีผู้เล่น กด "เพิ่มผู้เล่น" เพื่อเริ่ม</p>
          </div>
        )}

        {court.players.map((player, i) => (
          <PlayerRow
            key={player.id}
            player={player}
            index={i}
            sessionStart={court.sessionStart}
            sessionEnd={court.sessionEnd}
            shuttleCount={shuttle.shuttleCount}
            onChange={updatePlayer}
            onRemove={removePlayer}
          />
        ))}
      </div>
    </div>
  )
}

// Results Table — แสดงผลแบบ multi-court
function ResultsTable({ data, round, courts, shuttle }) {
  if (!data) return null
  const { courtResults, totalCourt, totalShuttle, grandTotal } = data

  return (
    <div className="fade-in space-y-4">
      {/* Grand Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
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

      {/* Session info per court */}
      <div className="flex flex-wrap gap-2 text-xs">
        {courts.map((c) => (
          <span key={c.id} className="bg-court-700 text-green-300 px-3 py-1 rounded-full">
            🏟️ {c.name}: {c.sessionStart}–{c.sessionEnd} · {c.courtPricePerHour}฿/ชม.
          </span>
        ))}
        <span className="bg-court-700 text-green-300 px-3 py-1 rounded-full">
          🏸 {shuttle.shuttleCount} ลูก × {shuttle.shuttlePrice} บาท
        </span>
      </div>

      {/* Table per court */}
      {courtResults.map((cr) => (
        <div key={cr.courtId}>
          <p className="text-green-400 text-xs font-bold uppercase tracking-wider mb-2">
            🏟️ {cr.courtName}
          </p>
          <div className="overflow-x-auto rounded-xl border border-court-600 mb-2">
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
                {cr.results.map((r, i) => (
                  <tr
                    key={r.id}
                    className={`border-t border-court-700 hover:bg-court-700/50 transition-colors ${
                      i % 2 === 0 ? 'bg-court-900/40' : 'bg-court-800/40'
                    }`}
                  >
                    <td className="px-4 py-3 font-semibold text-white">{r.name}</td>
                    <td className="px-4 py-3 text-right text-green-300 text-xs">{r.startTime}–{r.endTime}</td>
                    <td className="px-4 py-3 text-right text-green-300 text-xs">{r.shuttleStart}–{r.shuttleEnd}</td>
                    <td className="px-4 py-3 text-right text-green-200">{fmt(r.courtCost, round)}</td>
                    <td className="px-4 py-3 text-right text-green-200">{fmt(r.shuttleCost, round)}</td>
                    <td className="px-4 py-3 text-right font-bold text-lime-400">฿{fmt(r.total, round)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* Grand Total Footer */}
      <div className="overflow-x-auto rounded-xl border border-lime-400/30 lime-glow">
        <table className="w-full text-sm">
          <tfoot>
            <tr className="bg-court-700">
              <td colSpan={3} className="px-4 py-3 text-green-400 font-semibold text-xs uppercase tracking-wide">
                รวมทั้งหมด ({courts.length} สนาม)
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
  const [courts, setCourts] = useState([makeCourt(0)])
  const [shuttle, setShuttle] = useState({ shuttleCount: 7, shuttlePrice: 80 })
  const [round, setRound] = useState(false)
  const [errors, setErrors] = useState([])
  const [calcResult, setCalcResult] = useState(null)
  const [exporting, setExporting] = useState(false)
  const resultRef = useRef(null)

  // Auto-calculate on change
  useEffect(() => {
    const errs = validate(courts, shuttle)
    setErrors(errs)
    if (errs.length === 0) {
      setCalcResult(calculate(courts, shuttle))
    } else {
      setCalcResult(null)
    }
  }, [courts, shuttle])

  // ── Court actions ──
  const addCourt = useCallback(() => {
    setCourts((prev) => [...prev, makeCourt(prev.length)])
  }, [])

  const removeCourt = useCallback((courtId) => {
    setCourts((prev) => prev.filter((c) => c.id !== courtId))
  }, [])

  const updateCourt = useCallback((courtId, field, value) => {
    setCourts((prev) =>
      prev.map((c) => {
        if (c.id !== courtId) return c
        // รองรับทั้ง value ปกติ และ updater function (ป้องกัน stale closure ใน CourtCard)
        const newValue = typeof value === 'function' ? value(c[field]) : value
        return { ...c, [field]: newValue }
      }),
    )
  }, [])

  // ── Shuttle actions ──
  const updateShuttle = useCallback((field, value) => {
    setShuttle((prev) => ({ ...prev, [field]: value }))
  }, [])

  // ── Quick actions ──
  const loadExample = useCallback(() => {
    setCourts(
      EXAMPLE_COURTS.map((c) => ({
        ...c,
        id: uid(),
        players: c.players.map((p) => ({ ...p, id: uid() })),
      })),
    )
    setShuttle(EXAMPLE_SHUTTLE)
  }, [])

  const clearAll = useCallback(() => {
    setCourts([makeCourt(0)])
    setShuttle({ shuttleCount: 1, shuttlePrice: 0 })
  }, [])

  // ── Export image ──
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

  // ── Copy to clipboard ──
  const copyToClipboard = useCallback(async () => {
    if (!calcResult) return
    const { courtResults, totalCourt, totalShuttle, grandTotal } = calcResult
    const lines = [
      `🏸 Badminton Split — ${courts.length} สนาม`,
      `──────────────────────────`,
    ]
    courtResults.forEach((cr) => {
      lines.push(`🏟️ ${cr.courtName}`)
      cr.results.forEach((r) => {
        lines.push(
          `  ${r.name.padEnd(8)} ค่าสนาม: ${fmt(r.courtCost, round).padStart(7)} | ลูก: ${fmt(r.shuttleCost, round).padStart(7)} | รวม: ฿${fmt(r.total, round)}`,
        )
      })
    })
    lines.push(`──────────────────────────`)
    lines.push(`ค่าสนามรวม: ฿${fmt(totalCourt, round)}`)
    lines.push(`ค่าลูกรวม:  ฿${fmt(totalShuttle, round)}`)
    lines.push(`รวมทั้งหมด: ฿${fmt(grandTotal, round)}`)

    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      alert('คัดลอกสรุปค่าใช้จ่ายแล้ว! 📋')
    } catch {
      alert('ไม่สามารถคัดลอกได้ กรุณาลอง Export รูปภาพแทน')
    }
  }, [calcResult, round, courts])

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
              คำนวณค่าใช้จ่ายยุติธรรม · แบ่งตามเวลาจริง · รองรับหลายสนาม
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

        {/* ─── SHUTTLECOCK SECTION (Global) ─── */}
        <section className="card border-court-600">
          <h2 className="font-display text-2xl tracking-widest text-lime-400 mb-4">
            SHUTTLECOCK <span className="text-green-600 text-sm font-body normal-case tracking-normal">ใช้ร่วมกันทุกสนาม</span>
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="input-label">จำนวนลูกทั้งหมด</label>
              <input
                type="number"
                className="input-field"
                min={1}
                value={shuttle.shuttleCount}
                onChange={(e) => updateShuttle('shuttleCount', Number(e.target.value))}
              />
            </div>
            <div>
              <label className="input-label">ราคาต่อลูก (บาท)</label>
              <input
                type="number"
                className="input-field"
                min={0}
                value={shuttle.shuttlePrice}
                onChange={(e) => updateShuttle('shuttlePrice', Number(e.target.value))}
              />
            </div>
          </div>
          {shuttle.shuttleCount > 0 && shuttle.shuttlePrice > 0 && (
            <p className="mt-3 text-green-500 text-xs">
              💰 ค่าลูกรวม:{' '}
              <span className="text-lime-400 font-bold">
                {(shuttle.shuttleCount * shuttle.shuttlePrice).toLocaleString()} บาท
              </span>
            </p>
          )}
        </section>

        {/* ─── COURTS SECTION ─── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-2xl tracking-widest text-lime-400">
              COURTS <span className="text-green-600 text-lg">({courts.length})</span>
            </h2>
            <button
              onClick={addCourt}
              className="flex items-center gap-2 bg-lime-400 hover:bg-lime-300 text-court-950 text-sm px-4 py-2 rounded-lg font-bold transition-all active:scale-95"
            >
              + เพิ่มสนาม
            </button>
          </div>

          <div className="space-y-6">
            {courts.map((court, i) => (
              <CourtCard
                key={court.id}
                court={court}
                courtIndex={i}
                courtCount={courts.length}
                shuttle={shuttle}
                onUpdateCourt={updateCourt}
                onRemoveCourt={removeCourt}
              />
            ))}
          </div>
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
                {/* Round toggle */}
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
                {/* Copy */}
                <button
                  onClick={copyToClipboard}
                  className="flex items-center gap-2 bg-court-700 hover:bg-court-600 border border-court-600 hover:border-green-500 text-green-300 text-xs px-3 py-2 rounded-lg font-semibold transition-all"
                >
                  📋 คัดลอก
                </button>
                {/* Export */}
                <button
                  onClick={exportImage}
                  disabled={exporting}
                  className="flex items-center gap-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs px-3 py-2 rounded-lg font-semibold transition-all active:scale-95"
                >
                  {exporting ? '⏳ กำลัง Export...' : '📸 Export รูป'}
                </button>
              </div>
            </div>

            {/* Results card (captured for export) */}
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

              <ResultsTable
                data={calcResult}
                round={round}
                courts={courts}
                shuttle={shuttle}
              />
            </div>
          </section>
        )}

        {/* Empty state */}
        {!calcResult && errors.length === 0 && courts.every((c) => c.players.length > 0) && (
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