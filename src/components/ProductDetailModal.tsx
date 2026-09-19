import { useState, useEffect } from 'react';
import { X, RefreshCw, ExternalLink, Calendar, CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronUp, Layers } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { TrackedProduct, PriceStockObservation, ScrapeAttempt } from '../types';

interface ProductDetailModalProps {
  product: TrackedProduct | null;
  onClose: () => void;
  onManualScrape: (productId: number) => Promise<void>;
  isScraping: boolean;
}

export function ProductDetailModal({
  product,
  onClose,
  onManualScrape,
  isScraping
}: ProductDetailModalProps) {
  const [activeTab, setActiveTab] = useState<'history' | 'logs'>('history');
  const [history, setHistory] = useState<PriceStockObservation[]>([]);
  const [logs, setLogs] = useState<ScrapeAttempt[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);

  const productId = product?.product_id;

  const fetchDetails = async () => {
    if (!productId) return;
    setIsLoading(true);
    try {
      const [histRes, logsRes] = await Promise.all([
        fetch(`/api/products/${productId}/history`),
        fetch(`/api/products/${productId}/logs`)
      ]);

      if (histRes.ok) {
        const hData = await histRes.json();
        setHistory(hData.history || []);
      }
      if (logsRes.ok) {
        const lData = await logsRes.json();
        setLogs(lData.logs || []);
      }
    } catch (err) {
      console.error('Error fetching product details:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (productId) {
      fetchDetails();
    }
  }, [productId, isScraping]);

  if (!product) return null;

  // Format history data for chart
  const chartData = history.map(item => {
    const d = new Date(item.observed_at);
    return {
      timestamp: item.observed_at,
      dateFormatted: d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      price: item.price,
      stock: item.stock
    };
  });

  return (
    <div id="product-detail-modal" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="p-6 border-b border-slate-200 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider">
                {product.brand || 'INE Store'}
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">
                #{product.product_id}
              </span>
            </div>
            <h2 className="text-xl font-bold text-slate-900 mt-1">
              {product.name}
            </h2>
            <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
              <a
                href={product.canonical_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-indigo-600 hover:underline font-medium"
              >
                <span>View on Storefront</span>
                <ExternalLink className="h-3 w-3" />
              </a>
              {product.category && <span>Category: {product.category}</span>}
              {product.sku && <span>SKU: {product.sku}</span>}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onManualScrape(product.product_id)}
              disabled={isScraping}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isScraping ? 'animate-spin' : ''}`} />
              <span>{isScraping ? 'Scraping...' : 'Scrape Now'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Observation vs Attempt Distinction Banner */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="bg-white p-3 rounded-xl border border-slate-200">
            <span className="text-slate-500 font-medium block mb-1">Latest Verified Observation</span>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-black text-slate-900">
                {product.latest_price !== null && product.latest_price !== undefined
                  ? `₹${product.latest_price.toLocaleString('en-IN')}`
                  : 'Pending'}
              </span>
              {product.latest_stock !== null && (
                <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded">
                  {product.latest_stock} units in stock
                </span>
              )}
            </div>
            <div className="text-slate-400 mt-1">
              Observed at: {product.latest_observed_at ? new Date(product.latest_observed_at).toLocaleString() : 'N/A'}
            </div>
          </div>

          <div className="bg-white p-3 rounded-xl border border-slate-200">
            <span className="text-slate-500 font-medium block mb-1">Latest Scrape Attempt Status</span>
            <div className="flex items-center gap-2">
              {product.latest_attempt_status === 'success' ? (
                <span className="inline-flex items-center gap-1 font-bold text-emerald-700 text-sm">
                  <CheckCircle2 className="h-4 w-4" /> Success
                </span>
              ) : product.latest_attempt_status === 'retried' ? (
                <span className="inline-flex items-center gap-1 font-bold text-amber-600 text-sm">
                  <AlertTriangle className="h-4 w-4" /> Retried
                </span>
              ) : product.latest_attempt_status === 'failed' ? (
                <span className="inline-flex items-center gap-1 font-bold text-red-600 text-sm">
                  <XCircle className="h-4 w-4" /> Failed
                </span>
              ) : (
                <span className="text-slate-400 font-medium">None</span>
              )}
              {product.latest_attempt_duration_ms && (
                <span className="text-slate-500 font-mono text-xs">({product.latest_attempt_duration_ms}ms)</span>
              )}
            </div>
            <div className="text-slate-400 mt-1 truncate">
              {product.latest_attempt_error ? `Error: ${product.latest_attempt_error}` : `Attempted: ${product.latest_attempt_at ? new Date(product.latest_attempt_at).toLocaleTimeString() : 'N/A'}`}
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 border-b border-slate-200 flex items-center gap-6">
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`py-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'history'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            Price &amp; Stock History ({history.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('logs')}
            className={`py-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'logs'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            Scrape Audit Logs ({logs.length})
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading && history.length === 0 && logs.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">Loading product metrics...</div>
          ) : activeTab === 'history' ? (
            <div className="space-y-6">
              {/* Interactive Chart */}
              {chartData.length > 1 ? (
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200">
                  <div className="text-xs font-semibold text-slate-700 mb-3 flex items-center justify-between">
                    <span>Price Trend (INR) Over Time</span>
                    <span className="text-slate-400 font-normal">X-axis: Observed Time • Y-axis: ₹</span>
                  </div>
                  <div className="h-60 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="dateFormatted" tick={{ fontSize: 11, fill: '#64748b' }} />
                        <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11, fill: '#64748b' }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#0f172a', borderRadius: '12px', color: '#fff', fontSize: '12px' }}
                          formatter={(value: any) => [`₹${Number(value).toLocaleString('en-IN')}`, 'Price']}
                        />
                        <Line
                          type="monotone"
                          dataKey="price"
                          stroke="#4f46e5"
                          strokeWidth={2.5}
                          dot={{ r: 4, fill: '#4f46e5' }}
                          activeDot={{ r: 6 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : null}

              {/* History Table */}
              <div>
                <h4 className="text-sm font-bold text-slate-900 mb-3">Recorded Observations</h4>
                {history.length === 0 ? (
                  <div className="text-center py-8 text-sm text-slate-400 bg-slate-50 rounded-xl">
                    No verified observations recorded yet. Click &ldquo;Scrape Now&rdquo; to fetch the latest price.
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-slate-200 rounded-xl">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                        <tr>
                          <th className="py-2.5 px-4">Observed At</th>
                          <th className="py-2.5 px-4">Price</th>
                          <th className="py-2.5 px-4">Stock Units</th>
                          <th className="py-2.5 px-4">Availability</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {history.slice().reverse().map(obs => (
                          <tr key={obs.id} className="hover:bg-slate-50">
                            <td className="py-2.5 px-4 text-slate-700 font-mono">
                              {new Date(obs.observed_at).toLocaleString()}
                            </td>
                            <td className="py-2.5 px-4 font-bold text-slate-900">
                              ₹{obs.price.toLocaleString('en-IN')}
                            </td>
                            <td className="py-2.5 px-4 text-slate-700">
                              {obs.stock !== null ? `${obs.stock} units` : 'Not specified'}
                            </td>
                            <td className="py-2.5 px-4">
                              <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-bold ${
                                obs.is_in_stock
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-red-100 text-red-800'
                              }`}>
                                {obs.is_in_stock ? 'In Stock' : 'Out of Stock'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Audit Logs Tab */
            <div className="space-y-4">
              <h4 className="text-sm font-bold text-slate-900">Scrape Attempt Logs</h4>
              {logs.length === 0 ? (
                <div className="text-center py-8 text-sm text-slate-400 bg-slate-50 rounded-xl">
                  No scrape attempts recorded yet.
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-200">
                  {logs.map(log => {
                    const isExpanded = expandedLogId === log.id;

                    return (
                      <div key={log.id} className="p-3.5 hover:bg-slate-50/80 transition-colors">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            {log.status === 'success' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Success
                              </span>
                            ) : log.status === 'retried' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                                <AlertTriangle className="h-3.5 w-3.5" /> Retried
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800">
                                <XCircle className="h-3.5 w-3.5" /> Failed
                              </span>
                            )}

                            <span className="text-xs font-medium text-slate-700">
                              Attempt #{log.attempt_number}
                            </span>

                            <span className="text-xs text-slate-400 font-mono">
                              {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                          </div>

                          <div className="flex items-center gap-4 text-xs">
                            <span className="font-mono text-slate-500">{log.duration_ms}ms</span>
                            {log.extracted_price && (
                              <span className="font-bold text-slate-900">₹{log.extracted_price.toLocaleString('en-IN')}</span>
                            )}
                            {log.diagnostics && (
                              <button
                                type="button"
                                onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                                className="text-indigo-600 hover:text-indigo-800 flex items-center gap-0.5 text-xs font-medium"
                              >
                                <span>Diagnostics</span>
                                {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                              </button>
                            )}
                          </div>
                        </div>

                        {log.error_message && (
                          <div className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded-lg font-mono">
                            {log.error_message}
                          </div>
                        )}

                        {isExpanded && log.diagnostics && (
                          <div className="mt-3 p-3 bg-slate-900 text-slate-200 rounded-xl text-xs font-mono overflow-x-auto">
                            <div className="text-slate-400 text-[10px] mb-1">RAW DIAGNOSTICS &amp; SELECTOR LOG</div>
                            <pre>{JSON.stringify(log.diagnostics, null, 2)}</pre>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
