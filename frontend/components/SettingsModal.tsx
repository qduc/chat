'use client';
import React from 'react';
import { Cog, Database, Sliders, Zap } from 'lucide-react';
import Modal from './ui/Modal';
import ProvidersTab from './settings/ProvidersTab';
import SearchTab from './settings/SearchTab';
import AdvancedTab from './settings/AdvancedTab';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onProvidersChanged?: () => void;
  onSettingsChanged?: () => void;
  modelGroups: any[] | null;
  modelOptions: any[];
}

export default function SettingsModal({
  open,
  onClose,
  onProvidersChanged,
  onSettingsChanged,
  modelGroups,
  modelOptions,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = React.useState('providers');

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        maxWidthClassName="max-w-4xl"
        title={
          (
            <div className="flex items-center gap-2">
              <Cog className="w-4 h-4" /> Settings
            </div>
          ) as any
        }
      >
        <div className="flex flex-col gap-3">
          {/* Tab Navigation */}
          <div>
            <nav
              className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800/50 rounded-xl p-1"
              aria-label="Settings tabs"
            >
              <button
                onClick={() => setActiveTab('providers')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'providers'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-white/60 dark:hover:bg-zinc-800/60'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4" />
                  Providers
                </div>
              </button>
              <button
                onClick={() => setActiveTab('search')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'search'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-white/60 dark:hover:bg-zinc-800/60'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  Search Engines
                </div>
              </button>
              <button
                onClick={() => setActiveTab('advanced')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'advanced'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-white/60 dark:hover:bg-zinc-800/60'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4" />
                  Advanced
                </div>
              </button>
            </nav>
          </div>

          {/* Tab Content */}
          <ProvidersTab
            isVisible={activeTab === 'providers'}
            isOpen={open}
            onProvidersChanged={onProvidersChanged}
          />
          <SearchTab isVisible={activeTab === 'search'} isOpen={open} />
          <AdvancedTab
            isVisible={activeTab === 'advanced'}
            isOpen={open}
            modelGroups={modelGroups}
            modelOptions={modelOptions}
            onSettingsChanged={onSettingsChanged}
          />
        </div>
      </Modal>
    </>
  );
}
