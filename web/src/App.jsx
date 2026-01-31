import { useEffect, useMemo, useState } from 'react'
import './App.css'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

function isoDate(d) {
  return d.toISOString().slice(0, 10)
}

function formatMoney(amount) {
  if (!Number.isFinite(amount)) return '0.00'
  // If it's a very small number but not zero, show more precision
  if (amount > 0 && amount < 0.01) return amount.toFixed(6)
  return amount.toFixed(2)
}

function sumBy(list, get) {
  let total = 0
  for (const item of list) total += get(item)
  return total
}


function App() {
  const [granularity, setGranularity] = useState('DAILY')
  const [groupBy, setGroupBy] = useState('SERVICE')
  const [start, setStart] = useState(() => isoDate(new Date(Date.now() - 30 * 86400000)))
  const [end, setEnd] = useState(() => isoDate(new Date()))

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)

  // Config: which metric to display
  // Config: which metric to display
  const [metricKey, setMetricKey] = useState("unblended"); // 'unblended', 'amortized', 'blended', 'netUnblended', 'netAmortized'

  async function fetchCosts() {
    setLoading(true)
    setError(null)
    try {
      // Sanitize dates: ensure we only send the first 10 chars (YYYY-MM-DD)
      // This handles cases where inputs might have concatenated values
      const cleanStart = start.slice(0, 10);
      const cleanEnd = end.slice(0, 10);

      const qs = new URLSearchParams({
        start: cleanStart,
        end: cleanEnd,
        granularity,
        groupBy,
      })
      const res = await fetch(`/api/costs?${qs.toString()}`)
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.message || json?.error || 'Request failed')
      }
      setData(json)
    } catch (e) {
      setError(e?.message || String(e))
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCosts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totalsSeries = useMemo(() => {
    if (!data?.results) return []
    return data.results.map((r) => {
      // Handle new nested structure
      let cost = 0;
      if (r.total?.[metricKey]) {
        cost = r.total[metricKey].amount;
      } else if (r.groups) {
        cost = sumBy(r.groups, (g) => g.metrics?.[metricKey]?.amount ?? 0)
      }
      return {
        date: r.start,
        cost
      }
    })
  }, [data])

  const totalCost = useMemo(() => sumBy(totalsSeries, (p) => p.cost), [totalsSeries])

  // Check for usage vs cost discrepancy
  const potentialPermissionIssue = useMemo(() => {
    if (!data?.results) return false;
    // Sum all usage vs all cost
    let totalUsage = 0;
    let totalCost = 0;
    for (const r of data.results) {
      // Calculation fix: if total usage is effectively 0, try to sum from groups
      let usageVal = r.total?.usage?.amount || 0;
      if (usageVal === 0 && r.groups) {
        usageVal = r.groups.reduce((acc, g) => acc + (g.metrics?.usage?.amount || 0), 0);
      }

      let costVal = r.total?.[metricKey]?.amount || 0;
      if (costVal === 0 && r.groups) {
        costVal = r.groups.reduce((acc, g) => acc + (g.metrics?.[metricKey]?.amount || 0), 0);
      }

      totalUsage += usageVal;
      totalCost += costVal;
    }
    // If we have significant usage but EXACTLY 0 cost (or negative).
    // If it is 0.000001, that is valid cost (Free Tier spillover), so NO warning.
    return totalUsage > 5 && totalCost <= 0;
  }, [data])


  const byService = useMemo(() => {
    if (!data?.results) return []
    const map = new Map()
    for (const r of data.results) {
      for (const g of r.groups ?? []) {
        const key = (g.keys && g.keys[0]) || 'Unknown'
        // Handle nested
        const amount = g.metrics?.[metricKey]?.amount ?? 0;
        map.set(key, (map.get(key) || 0) + amount)
      }
    }
    const rows = [...map.entries()]
      .map(([service, amount]) => ({ service, amount }))
      .sort((a, b) => b.amount - a.amount)
    return rows
  }, [data])

  return (
    <div className="page">
      <header className="header">
        <div>
          <div className="title">AWS Billing Dashboard</div>
          <div className="subtitle">Powered by Cost Explorer ({metricKey})</div>
        </div>
        <div className="actions">
          <button className="primary" onClick={fetchCosts} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </header>

      <section className="presets" style={{ display: 'flex', gap: '8px', padding: '0 20px', marginBottom: '10px' }}>
        <button onClick={() => {
          const now = new Date();
          const yest = new Date(now); yest.setDate(yest.getDate() - 1);
          setStart(isoDate(yest));
          setEnd(isoDate(now));
          setGranularity('DAILY');
        }}>Yesterday</button>

        <button onClick={() => {
          const now = new Date();
          const last7 = new Date(now); last7.setDate(last7.getDate() - 7);
          setStart(isoDate(last7));
          setEnd(isoDate(now));
          setGranularity('DAILY');
        }}>Last 7 Days</button>

        <button onClick={() => {
          const now = new Date();
          const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
          setStart(isoDate(startOfMonth));
          setEnd(isoDate(now));
          setGranularity('MONTHLY');
        }}>This Month</button>

        <button onClick={() => {
          const now = new Date();
          const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
          setStart(isoDate(startOfLastMonth));
          setEnd(isoDate(startOfThisMonth));
          setGranularity('MONTHLY');
        }}>Last Month</button>
      </section>

      <section className="panel">
        <div className="controls">
          <label className="field">
            <div className="label">Start (YYYY-MM-DD)</div>
            <input value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="field">
            <div className="label">End (exclusive)</div>
            <input value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
          <label className="field">
            <div className="label">Granularity</div>
            <select value={granularity} onChange={(e) => setGranularity(e.target.value)}>
              <option value="DAILY">DAILY</option>
              <option value="MONTHLY">MONTHLY</option>
            </select>
          </label>
          <label className="field">
            <div className="label">Group by</div>
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              <option value="SERVICE">SERVICE</option>
              <option value="NONE">NONE</option>
            </select>
          </label>
          <label className="field">
            <div className="label">Metric</div>
            <select value={metricKey} onChange={(e) => setMetricKey(e.target.value)}>
              <option value="unblended">Unblended Cost</option>
              <option value="amortized">Amortized Cost</option>
              <option value="blended">Blended Cost</option>
              <option value="netUnblended">Net Unblended</option>
              <option value="netAmortized">Net Amortized</option>
              <option value="usage">Usage Quantity</option>
            </select>
          </label>
        </div>

        {error ? (
          <div className="error">
            <div className="errorTitle">Backend error</div>
            <div className="errorBody">{error}</div>
            <div className="hint">
              Ensure Cost Explorer is enabled and your AWS identity has permission
              <code className="inline">ce:GetCostAndUsage</code>.
            </div>
          </div>
        ) : null}

        {potentialPermissionIssue && !error ? (
          <div className="error" style={{ borderColor: '#fab005', background: '#fff9db' }}>
            <div className="errorTitle" style={{ color: '#e67700' }}>⚠️ Data Discrepancy Detected</div>
            <div className="errorBody" style={{ color: '#d9480f' }}>
              AWS is returning <b>Usage Data</b> (e.g. running EC2/RDS hours) but reporting <b>$0.00 Cost</b>.
            </div>
            <div className="hint" style={{ color: '#d9480f' }}>
              This commonly happens if your IAM User is missing the <b>Billing</b> permission.
              <br />
              Please attach the policy <code className="inline">billing:ViewBilling</code> or <code className="inline">aws-portal:ViewBilling</code> to your IAM User.
            </div>
          </div>
        ) : null}

        <div className="stats" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
          <div className="stat">
            <div className="statLabel">Range</div>
            <div className="statValue" style={{ fontSize: '13px' }}>
              {data?.start || start} → {data?.end || end}
            </div>
          </div>
          <div className="stat">
            <div className="statLabel">Usage Cost</div>
            <div className="statValue" style={{ color: '#333' }}>
              ${formatMoney(data?.summary ? data.summary.usage : totalCost)}
            </div>
          </div>
          <div className="stat">
            <div className="statLabel">Credits</div>
            <div className="statValue" style={{ color: '#40c057' }}>
              ${formatMoney(data?.summary ? data.summary.credit : 0)}
            </div>
          </div>
          <div className="stat">
            <div className="statLabel">Tax</div>
            <div className="statValue" style={{ color: '#e67700' }}>
              ${formatMoney(data?.summary ? data.summary.tax : 0)}
            </div>
          </div>
          <div className="stat">
            <div className="statLabel">Net Bill</div>
            <div className="statValue" style={{ color: '#6d5efc' }}>
              ${formatMoney(data?.summary ? data.summary.total : totalCost)}
            </div>
          </div>
        </div>
      </section>

      <section className="grid">
        <div className="panel">
          <div className="panelTitle">Cost over time</div>
          <div className="chart">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={totalsSeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} minTickGap={16} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v) => [`$${formatMoney(Number(v))}`, 'Cost']} />
                <Bar dataKey="cost" fill="#6d5efc" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel">
          <div className="panelTitle">Top services</div>
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th className="num">{metricKey === 'usage' ? 'Units' : 'Cost (USD)'}</th>
                </tr>
              </thead>
              <tbody>
                {byService.slice(0, 12).map((r) => (
                  <tr key={r.service}>
                    <td>{r.service}</td>
                    <td className="num">${formatMoney(r.amount)}</td>
                  </tr>
                ))}
                {byService.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="muted">
                      No data yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>


    </div>
  )
}

export default App
