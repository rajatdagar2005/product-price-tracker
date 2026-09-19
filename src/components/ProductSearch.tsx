// import { useState, useEffect, useRef } from 'react';
// import { Search, Plus, Check, Loader2, ExternalLink, Sparkles } from 'lucide-react';
// import { StoreCatalogItem, TrackedProduct } from '../types';

// interface ProductSearchProps {
//   trackedProducts: TrackedProduct[];
//   onTrackProduct: (item: StoreCatalogItem) => Promise<void>;
// }

// export function ProductSearch({ trackedProducts, onTrackProduct }: ProductSearchProps) {
//   const [query, setQuery] = useState('');
//   const [results, setResults] = useState<StoreCatalogItem[]>([]);
//   const [isLoading, setIsLoading] = useState(false);
//   const [trackingId, setTrackingId] = useState<number | null>(null);
//   const [isDropdownOpen, setIsDropdownOpen] = useState(false);
//   const searchContainerRef = useRef<HTMLDivElement>(null);

//   // Quick picks from the mock store catalog
//   const popularPicks = [
//     { id: 550, name: 'Helix Blender Two', brand: 'Helix' },
//     { id: 461, name: 'Echo Earbuds Pro', brand: 'Echo' },
//     { id: 948, name: 'Pulse Smartwatch', brand: 'Pulse' },
//     { id: 592, name: 'Aero Blender Active', brand: 'Aero' }
//   ];

//   const trackedIds = new Set(trackedProducts.map(p => p.product_id));

//   // Search API call with debounce
//   useEffect(() => {
//     if (!query.trim()) {
//       setResults([]);
//       setIsDropdownOpen(false);
//       return;
//     }

//     const timer = setTimeout(async () => {
//       setIsLoading(true);
//       try {
//         const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(query)}`);
//         if (res.ok) {
//           const data = await res.json();
//           setResults(data.items || []);
//           setIsDropdownOpen(true);
//         }
//       } catch (err) {
//         console.error('Catalog search error:', err);
//       } finally {
//         setIsLoading(false);
//       }
//     }, 250);

//     return () => clearTimeout(timer);
//   }, [query]);

//   // Click outside listener
//   useEffect(() => {
//     function handleClickOutside(event: MouseEvent) {
//       if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
//         setIsDropdownOpen(false);
//       }
//     }
//     document.addEventListener('mousedown', handleClickOutside);
//     return () => document.removeEventListener('mousedown', handleClickOutside);
//   }, []);

//   const handleTrack = async (item: StoreCatalogItem) => {
//     setTrackingId(item.id);
//     try {
//       await onTrackProduct(item);
//     } finally {
//       setTrackingId(null);
//     }
//   };

//   const handleQuickPick = (pick: { id: number; name: string; brand: string }) => {
//     setQuery(pick.name);
//   };

//   return (
//     <div id="product-search-section" className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
//       <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
//         <div>
//           <h2 className="text-base font-semibold text-slate-900">
//             Search Storefront Products
//           </h2>
//           <p className="text-xs text-slate-500">
//             Search by full or partial product name, brand, SKU, or numeric product ID.
//           </p>
//         </div>

//         {/* Quick Picks */}
//         <div className="flex items-center gap-1.5 flex-wrap">
//           <span className="text-xs text-slate-500 flex items-center gap-1">
//             <Sparkles className="h-3 w-3 text-amber-500" />
//             Quick picks:
//           </span>
//           {popularPicks.map(pick => (
//             <button
//               key={pick.id}
//               type="button"
//               onClick={() => handleQuickPick(pick)}
//               className="text-xs px-2.5 py-1 rounded-md bg-slate-50 text-slate-700 hover:bg-slate-100 hover:text-indigo-600 border border-slate-200 transition-colors"
//             >
//               {pick.name} (#{pick.id})
//             </button>
//           ))}
//         </div>
//       </div>

//       {/* Search Input Container */}
//       <div ref={searchContainerRef} className="relative">
//         <div className="relative">
//           <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
//             {isLoading ? (
//               <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
//             ) : (
//               <Search className="h-4 w-4" />
//             )}
//           </div>
//           <input
//             id="input-product-search"
//             type="text"
//             value={query}
//             onChange={e => setQuery(e.target.value)}
//             onFocus={() => query.trim() && setIsDropdownOpen(true)}
//             placeholder="Type product name (e.g. Helix, Blender, Earbuds, 550)..."
//             className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all placeholder:text-slate-400"
//           />
//         </div>

//         {/* Search Results Dropdown */}
//         {isDropdownOpen && results.length > 0 && (
//           <div
//             id="search-results-dropdown"
//             className="absolute left-0 right-0 mt-2 bg-white rounded-xl border border-slate-200 shadow-xl max-h-80 overflow-y-auto z-40 divide-y divide-slate-100"
//           >
//             {results.map(item => {
//               const isTracked = trackedIds.has(item.id);
//               const isBusy = trackingId === item.id;

//               return (
//                 <div
//                   key={item.id}
//                   className="p-3.5 hover:bg-slate-50 flex items-center justify-between gap-4 transition-colors"
//                 >
//                   <div className="min-w-0 flex-1">
//                     <div className="flex items-center gap-2">
//                       <span className="font-semibold text-sm text-slate-900 truncate">
//                         {item.name}
//                       </span>
//                       <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">
//                         #{item.id}
//                       </span>
//                     </div>
//                     <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
//                       <span>Brand: <strong className="text-slate-700">{item.brand}</strong></span>
//                       <span>Category: <strong className="text-slate-700">{item.category}</strong></span>
//                       {item.sku && <span>SKU: {item.sku}</span>}
//                     </div>
//                   </div>

//                   <div className="flex items-center gap-2 flex-shrink-0">
//                     <a
//                       href={item.canonicalUrl}
//                       target="_blank"
//                       rel="noreferrer"
//                       className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
//                       title="View on INE storefront"
//                     >
//                       <ExternalLink className="h-4 w-4" />
//                     </a>

//                     {isTracked ? (
//                       <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
//                         <Check className="h-3.5 w-3.5" />
//                         Tracked
//                       </span>
//                     ) : (
//                       <button
//                         type="button"
//                         onClick={() => handleTrack(item)}
//                         disabled={isBusy}
//                         className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
//                       >
//                         {isBusy ? (
//                           <Loader2 className="h-3.5 w-3.5 animate-spin" />
//                         ) : (
//                           <Plus className="h-3.5 w-3.5" />
//                         )}
//                         <span>Track</span>
//                       </button>
//                     )}
//                   </div>
//                 </div>
//               );
//             })}
//           </div>
//         )}

//         {isDropdownOpen && !isLoading && query.trim() && results.length === 0 && (
//           <div className="absolute left-0 right-0 mt-2 bg-white rounded-xl border border-slate-200 p-6 text-center text-sm text-slate-500 shadow-xl z-40">
//             No products found matching &ldquo;{query}&rdquo; in the storefront catalog.
//           </div>
//         )}
//       </div>
//     </div>
//   );
// }

import { useState, useEffect, useRef } from 'react';
import {
  Search,
  Plus,
  Check,
  Loader2,
  ExternalLink,
  Sparkles
} from 'lucide-react';
import { StoreCatalogItem, TrackedProduct } from '../types';

interface ProductSearchProps {
  trackedProducts: TrackedProduct[];
  onTrackProduct: (item: StoreCatalogItem) => Promise<void>;
}

export function ProductSearch({
  trackedProducts,
  onTrackProduct
}: ProductSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StoreCatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [trackingId, setTrackingId] = useState<number | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Used to make sure an older search response
  // can never overwrite the latest search.
  const searchRequestIdRef = useRef(0);

  // Quick picks from the mock store catalog.
  const popularPicks = [
    { id: 550, name: 'Helix Blender Two', brand: 'Helix' },
    { id: 461, name: 'Echo Earbuds Pro', brand: 'Echo' },
    { id: 948, name: 'Pulse Smartwatch', brand: 'Pulse' },
    { id: 592, name: 'Aero Blender Active', brand: 'Aero' }
  ];

  const trackedIds = new Set(
    trackedProducts.map(product => product.product_id)
  );

  // Search with debounce + stale-request protection.
  useEffect(() => {
    const trimmedQuery = query.trim();

    // Invalidate any previous request immediately.
    searchRequestIdRef.current += 1;
    const requestId = searchRequestIdRef.current;

    if (!trimmedQuery) {
      setResults([]);
      setIsLoading(false);
      setIsDropdownOpen(false);
      return;
    }

    setIsLoading(true);
    setIsDropdownOpen(true);

    const controller = new AbortController();

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/catalog/search?q=${encodeURIComponent(trimmedQuery)}`,
          {
            signal: controller.signal
          }
        );

        if (!response.ok) {
          throw new Error(
            `Search request failed: HTTP ${response.status}`
          );
        }

        const data = await response.json();

        // Ignore this response if a newer search has started.
        if (requestId !== searchRequestIdRef.current) {
          return;
        }

        const items: StoreCatalogItem[] = Array.isArray(data.items)
          ? data.items
          : [];

        setResults(items.slice(0, 20));
        setIsDropdownOpen(true);
      } catch (error: any) {
        // AbortError is expected when the user types a new query.
        if (error?.name === 'AbortError') {
          return;
        }

        // Never let an old failed request affect the current search.
        if (requestId !== searchRequestIdRef.current) {
          return;
        }

        console.error('Catalog search error:', error);
        setResults([]);
        setIsDropdownOpen(true);
      } finally {
        if (requestId === searchRequestIdRef.current) {
          setIsLoading(false);
        }
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // Click outside listener.
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleTrack = async (item: StoreCatalogItem) => {
    setTrackingId(item.id);

    try {
      await onTrackProduct(item);
    } finally {
      setTrackingId(null);
    }
  };

  const handleQuickPick = (pick: {
    id: number;
    name: string;
    brand: string;
  }) => {
    setQuery(pick.name);
    setIsDropdownOpen(true);
  };

  return (
    <div
      id="product-search-section"
      className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Search Storefront Products
          </h2>

          <p className="text-xs text-slate-500">
            Search by full or partial product name, brand, SKU, or numeric
            product ID.
          </p>
        </div>

        {/* Quick Picks */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-amber-500" />
            Quick picks:
          </span>

          {popularPicks.map(pick => (
            <button
              key={pick.id}
              type="button"
              onClick={() => handleQuickPick(pick)}
              className="text-xs px-2.5 py-1 rounded-md bg-slate-50 text-slate-700 hover:bg-slate-100 hover:text-indigo-600 border border-slate-200 transition-colors"
            >
              {pick.name} (#{pick.id})
            </button>
          ))}
        </div>
      </div>

      {/* Search Input Container */}
      <div ref={searchContainerRef} className="relative">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </div>

          <input
            id="input-product-search"
            type="text"
            value={query}
            onChange={event => setQuery(event.target.value)}
            onFocus={() => {
              if (query.trim()) {
                setIsDropdownOpen(true);
              }
            }}
            placeholder="Type product name (e.g. Helix, Blender, Earbuds, 550)..."
            className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all placeholder:text-slate-400"
          />
        </div>

        {/* Search Results Dropdown */}
        {isDropdownOpen && results.length > 0 && (
          <div
            id="search-results-dropdown"
            className="absolute left-0 right-0 mt-2 bg-white rounded-xl border border-slate-200 shadow-xl max-h-80 overflow-y-auto z-40 divide-y divide-slate-100"
          >
            {results.map(item => {
              const isTracked = trackedIds.has(item.id);
              const isBusy = trackingId === item.id;

              return (
                <div
                  key={item.id}
                  className="p-3.5 hover:bg-slate-50 flex items-center justify-between gap-4 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-slate-900 truncate">
                        {item.name}
                      </span>

                      <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">
                        #{item.id}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                      <span>
                        Brand:{' '}
                        <strong className="text-slate-700">
                          {item.brand}
                        </strong>
                      </span>

                      <span>
                        Category:{' '}
                        <strong className="text-slate-700">
                          {item.category}
                        </strong>
                      </span>

                      {item.sku && (
                        <span>SKU: {item.sku}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <a
                      href={item.canonicalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                      title="View on INE storefront"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>

                    {isTracked ? (
                      <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <Check className="h-3.5 w-3.5" />
                        Tracked
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleTrack(item)}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
                      >
                        {isBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Plus className="h-3.5 w-3.5" />
                        )}

                        <span>Track</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* No results */}
        {isDropdownOpen &&
          !isLoading &&
          query.trim() &&
          results.length === 0 && (
            <div className="absolute left-0 right-0 mt-2 bg-white rounded-xl border border-slate-200 p-6 text-center text-sm text-slate-500 shadow-xl z-40">
              No products found matching &ldquo;{query}&rdquo; in the
              storefront catalog.
            </div>
          )}
      </div>
    </div>
  );
}