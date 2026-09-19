import { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { ProductSearch } from './components/ProductSearch';
import { ProductList } from './components/ProductList';
import { ProductDetailModal } from './components/ProductDetailModal';
import { TrackedProduct, StoreCatalogItem, SystemHealth } from './types';

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || ''
).trim().replace(/\/+$/, '');

const apiUrl = (path: string) => `${API_BASE_URL}${path}`;

export default function App() {
  const [products, setProducts] = useState<TrackedProduct[]>([]);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<TrackedProduct | null>(null);
  const [activeScrapingId, setActiveScrapingId] = useState<number | null>(null);
  const [isCronRunning, setIsCronRunning] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  const fetchProducts = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/products'));
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products || []);
      }
    } catch (err) {
      console.error('Failed to fetch tracked products:', err);
    }
  }, []);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/health'));
      if (res.ok) {
        const data = await res.json();
        setHealth({
          status: data.status,
          dbType: data.database?.type === 'supabase-postgresql' ? 'supabase' : 'in-memory-fallback',
          dbConnected: data.database?.connected ?? true,
          uptimeSeconds: data.uptimeSeconds,
          activeTrackedCount: data.database?.activeTrackedProducts || 0,
          cronSecretConfigured: data.cron?.cronSecretConfigured ?? false,
          targetStoreUrl: data.targetStoreUrl
        });
      }
    } catch (err) {
      console.error('Failed to fetch system health:', err);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
    fetchHealth();
  }, [fetchProducts, fetchHealth]);

  // Keep selected product in sync with fresh data
  useEffect(() => {
    if (selectedProduct) {
      const updated = products.find(p => p.product_id === selectedProduct.product_id);
      if (updated) setSelectedProduct(updated);
    }
  }, [products]);

  const handleTrackProduct = async (item: StoreCatalogItem) => {
    try {
      const res = await fetch(apiUrl('/api/products/track'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: item.id,
          name: item.name,
          slug: item.slug,
          brand: item.brand,
          category: item.category,
          sku: item.sku,
          canonicalUrl: item.canonicalUrl
        })
      });

      if (res.ok) {
        await fetchProducts();
        showToast(`Started tracking "${item.name}"!`, 'success');
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to track product', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error tracking product', 'error');
    }
  };

  const handleUntrackProduct = async (productId: number) => {
    try {
      const res = await fetch(apiUrl(`/api/products/${productId}`), { method: 'DELETE' });
      if (res.ok) {
        await fetchProducts();
        if (selectedProduct?.product_id === productId) {
          setSelectedProduct(null);
        }
        showToast('Product removed from tracking', 'info');
      }
    } catch (err: any) {
      showToast(err.message || 'Error untracking product', 'error');
    }
  };

  const handleManualScrape = async (productId: number) => {
    setActiveScrapingId(productId);
    try {
      const res = await fetch(apiUrl(`/api/products/${productId}/scrape`), { method: 'POST' });
      const data = await res.json();

      if (res.ok && data.result?.success) {
        showToast(`Scraped successfully! Price: ₹${data.result.price?.toLocaleString('en-IN')}`, 'success');
      } else {
        showToast(data.result?.errorMessage || data.error || 'Scrape failed', 'error');
      }
      await fetchProducts();
    } catch (err: any) {
      showToast(err.message || 'Scrape request failed', 'error');
    } finally {
      setActiveScrapingId(null);
    }
  };

  // const handleTriggerCron = async () => {
  //   setIsCronRunning(true);
  //   showToast('Starting scheduled cron batch scrape...', 'info');
  //   try {
  //     const res = await fetch('/api/cron/scrape', {
  //       method: 'POST',
  //       headers: {
  //         
  //       }
  //     });
  //     const data = await res.json();

  //     if (res.ok) {
  //       const summary = data.summary;
  //       showToast(
  //         `Cron batch finished: ${summary.successCount} succeeded, ${summary.failCount} failed (${data.durationMs}ms)`,
  //         summary.failCount > 0 ? 'info' : 'success'
  //       );
  //     } else {
  //       showToast(data.error || 'Cron batch execution failed', 'error');
  //     }
  //     await fetchProducts();
  //   } catch (err: any) {
  //     showToast(err.message || 'Cron error', 'error');
  //   } finally {
  //     setIsCronRunning(false);
  //   }
  // };

  const handleTriggerCron = async () => {
  setIsCronRunning(true);
  showToast('Starting batch scrape...', 'info');

  try {
    const res = await fetch(apiUrl('/api/products/scrape-all'), {
      method: 'POST'
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Batch scrape failed');
    }

    showToast(
      `Batch complete: ${data.summary.successCount} succeeded, ${data.summary.failCount} failed.`,
      'success'
    );

    await fetchProducts();
    await fetchHealth();
  } catch (err: any) {
    showToast(err?.message || 'Batch scrape failed', 'error');
  } finally {
    setIsCronRunning(false);
  }
};

  return (
    <div id="app-root" className="min-h-screen bg-slate-100/70 text-slate-900 font-sans flex flex-col">
      <Header
        health={health}
        onTriggerCron={handleTriggerCron}
        isCronRunning={isCronRunning}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <ProductSearch
          trackedProducts={products}
          onTrackProduct={handleTrackProduct}
        />

        <ProductList
          products={products}
          activeScrapingId={activeScrapingId}
          onSelectProduct={setSelectedProduct}
          onManualScrape={handleManualScrape}
          onUntrackProduct={handleUntrackProduct}
        />
      </main>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div
            className={`px-4 py-3 rounded-2xl shadow-xl border text-sm font-semibold flex items-center gap-2 ${
              toastMessage.type === 'success'
                ? 'bg-slate-900 text-emerald-400 border-emerald-500/30'
                : toastMessage.type === 'error'
                ? 'bg-slate-900 text-red-400 border-red-500/30'
                : 'bg-slate-900 text-indigo-300 border-indigo-500/30'
            }`}
          >
            <span>{toastMessage.text}</span>
          </div>
        </div>
      )}

      {/* Product Detail Modal */}
      {selectedProduct && (
        <ProductDetailModal
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onManualScrape={handleManualScrape}
          isScraping={activeScrapingId === selectedProduct.product_id}
        />
      )}
    </div>
  );
}
