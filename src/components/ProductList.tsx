import React from 'react';
import { RefreshCw, TrendingUp, ExternalLink, Trash2, CheckCircle2, AlertTriangle, XCircle, Clock } from 'lucide-react';
import { TrackedProduct } from '../types';

interface ProductListProps {
  products: TrackedProduct[];
  activeScrapingId: number | null;
  onSelectProduct: (product: TrackedProduct) => void;
  onManualScrape: (productId: number) => Promise<void>;
  onUntrackProduct: (productId: number) => Promise<void>;
}

export function ProductList({
  products,
  activeScrapingId,
  onSelectProduct,
  onManualScrape,
  onUntrackProduct
}: ProductListProps) {
  if (products.length === 0) {
    return (
      <div id="tracked-products-empty" className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-sm">
        <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3 text-slate-400">
          <TrendingUp className="h-6 w-6" />
        </div>
        <h3 className="text-base font-semibold text-slate-900 mb-1">No products tracked yet</h3>
        <p className="text-sm text-slate-500 max-w-md mx-auto">
          Use the search bar above to look up products on the store and click &ldquo;Track&rdquo; to start monitoring price and stock.
        </p>
      </div>
    );
  }

  return (
    <div id="tracked-products-section" className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Tracked Products ({products.length})
          </h2>
          <p className="text-xs text-slate-500">
            Monitored by scheduled cron every 2 hours and on-demand manual triggers.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {products.map(product => {
          const isBusy = activeScrapingId === product.product_id;
          const status = product.latest_attempt_status;

          return (
            <div
              key={product.product_id}
              id={`product-card-${product.product_id}`}
              className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:border-slate-300 transition-all flex flex-col justify-between"
            >
              {/* Card Header */}
              <div>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">
                      {product.brand || 'Store Item'}
                    </span>
                    <h3 className="text-base font-bold text-slate-900 leading-snug line-clamp-1">
                      {product.name}
                    </h3>
                  </div>

                  <a
                    href={product.canonical_url}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-100 transition-colors"
                    title="View mock store page"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>

                <div className="text-xs text-slate-500 mb-4 font-mono">
                  ID: #{product.product_id} {product.sku && `• SKU: ${product.sku}`}
                </div>

                {/* Latest Price & Stock Display */}
                <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-100 mb-4">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <span className="text-xs text-slate-500 block mb-0.5">Latest Price</span>
                      {product.latest_price !== null && product.latest_price !== undefined ? (
                        <div className="text-2xl font-black text-slate-900 tracking-tight">
                          ₹{product.latest_price.toLocaleString('en-IN')}
                        </div>
                      ) : (
                        <div className="text-sm font-semibold text-slate-400 italic">
                          Awaiting first scrape
                        </div>
                      )}
                    </div>

                    <div className="text-right">
                      <span className="text-xs text-slate-500 block mb-0.5">Stock Status</span>
                      {product.latest_stock !== null && product.latest_stock !== undefined ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                          product.latest_stock > 0
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {product.latest_stock > 0 ? `${product.latest_stock} in stock` : 'Out of stock'}
                        </span>
                      ) : product.latest_is_in_stock ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                          In stock
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 font-medium">Unverified</span>
                      )}
                    </div>
                  </div>

                  {/* Observation metadata */}
                  {product.latest_observed_at && (
                    <div className="mt-2 pt-2 border-t border-slate-200/60 flex items-center justify-between text-[11px] text-slate-400">
                      <span>Observed: {new Date(product.latest_observed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      {product.latest_attempt_duration_ms && (
                        <span>Duration: {product.latest_attempt_duration_ms}ms</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Scrape Attempt Status Badge */}
                <div className="flex items-center justify-between text-xs mb-4">
                  <span className="text-slate-500">Last Scrape Attempt:</span>
                  {status === 'success' ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Success
                    </span>
                  ) : status === 'retried' ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-amber-600">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Retried
                    </span>
                  ) : status === 'failed' ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-red-600" title={product.latest_attempt_error || 'Failed'}>
                      <XCircle className="h-3.5 w-3.5" />
                      Failed
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-medium text-slate-400">
                      <Clock className="h-3.5 w-3.5" />
                      Not yet run
                    </span>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSelectProduct(product)}
                  className="flex-1 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-100 text-slate-800 hover:bg-slate-200 transition-colors text-center"
                >
                  History &amp; Logs
                </button>

                <button
                  type="button"
                  onClick={() => onManualScrape(product.product_id)}
                  disabled={isBusy}
                  className="px-3 py-2 rounded-xl text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-1 shadow-sm"
                  title="Scrape current price and stock now"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isBusy ? 'animate-spin' : ''}`} />
                  <span>{isBusy ? 'Scraping...' : 'Scrape'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Remove "${product.name}" from tracking?`)) {
                      onUntrackProduct(product.product_id);
                    }
                  }}
                  className="p-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  title="Untrack product"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
