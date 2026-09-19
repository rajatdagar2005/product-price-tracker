import { RefreshCw, Activity } from 'lucide-react';
import { SystemHealth } from '../types';

interface HeaderProps {
  health: SystemHealth | null;
  onTriggerCron: () => void;
  isCronRunning: boolean;
}

export function Header({ health, onTriggerCron, isCronRunning }: HeaderProps) {
  return (
    <header id="app-header" className="bg-white border-b border-slate-200 sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-slate-900 flex items-center justify-center text-white font-bold shadow-sm">
            <Activity className="h-5 w-5 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 tracking-tight">
              Product Price Tracker
            </h1>
            <p className="text-xs text-slate-500 font-medium">
              Automated price & stock intelligence
            </p>
          </div>
        </div>

        {/* System Health Indicators & Action Buttons */}
        <div className="flex items-center flex-wrap gap-2.5">
          {/* Status Indicator */}
          <div
            id="status-system-pill"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span>Active Monitoring</span>
          </div>

          {/* Trigger Scheduled Batch Scraping */}
          <button
            id="btn-trigger-refresh"
            type="button"
            onClick={onTriggerCron}
            disabled={isCronRunning}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 transition-colors shadow-sm cursor-pointer"
            title="Refresh prices and stock for all tracked products"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-indigo-400 ${isCronRunning ? 'animate-spin' : ''}`} />
            <span>{isCronRunning ? 'Checking All Prices...' : 'Check All Prices'}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
